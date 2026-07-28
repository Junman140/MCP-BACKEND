import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Role } from "../models/roles.js";
import type {
  BiometricEnrollmentLean,
  ExamLean,
  ExamRosterEntryLean,
  StudentLean,
  VerificationEventLean,
} from "../models/lean.js";
import {
  BiometricEnrollment,
  CourseRegistration,
  Exam,
  ExamRosterEntry,
  Student,
  VerificationEvent,
} from "../models/schemas.js";
import { requireRole } from "../lib/auth.js";
import { resolveTenantId, type JwtUser } from "../lib/tenantScope.js";
import { decryptTemplate } from "../lib/crypto.js";
import { extractTemplate, isMatchingUnreachable, matchTemplates, matchingServiceUrl } from "../lib/matchingClient.js";
import {
  extractFaceEmbedding,
  faceServiceUrl,
  embeddingB64ToBuffer,
  bufferToFloat32Array,
  cosineSimilarity,
  isFaceUnreachable,
} from "../lib/faceClient.js";
import { authenticateDevice } from "../lib/deviceAuth.js";
import { resolveAcademicYearLabel } from "../lib/resolveAcademicYear.js";
import { notifyMismatch } from "../lib/notifications.js";

const VerifyBody = z.object({
  matricNo: z.string().min(1),
  examId: z.string().optional(),
  /** If set, must equal the exam's course (tag for auditing). */
  courseId: z.string().optional(),
  /** If set, must equal the exam's academic session (when exam uses sessions). */
  academicSessionId: z.string().optional(),
  imageBase64: z.string().min(1),
  width: z.coerce.number().int().positive(),
  height: z.coerce.number().int().positive(),
  dpi: z.coerce.number().int().positive().default(500),
  format: z.enum(["png", "raw_gray8"]),
  matchThreshold: z.coerce.number().optional(),
});

const IdentifyBody = z.object({
  examId: z.string().optional(),
  courseId: z.string().optional(),
  academicSessionId: z.string().optional(),
  imageBase64: z.string().min(1),
  width: z.coerce.number().int().positive(),
  height: z.coerce.number().int().positive(),
  dpi: z.coerce.number().int().positive().default(500),
  format: z.enum(["png", "raw_gray8"]),
  matchThreshold: z.coerce.number().optional(),
});

function tplBuf(enc: any): Buffer {
  if (!enc) return Buffer.alloc(0);
  if (Buffer.isBuffer(enc)) return enc;
  if (enc instanceof Uint8Array) return Buffer.from(enc);
  if (enc && typeof enc === "object") {
    // Handle Mongoose Binary / MongoDB Binary
    if (enc.buffer instanceof ArrayBuffer) return Buffer.from(enc.buffer);
    if (enc.buffer && Buffer.isBuffer(enc.buffer)) return enc.buffer;
    if (enc._bsontype === "Binary" && enc.buffer) return Buffer.from(enc.buffer);
    if (typeof enc.value === 'function') {
      const val = enc.value(true);
      return Buffer.isBuffer(val) ? val : Buffer.from(val);
    }
  }
  try {
    return Buffer.from(enc);
  } catch (e) {
    console.error("[tplBuf] Failed to convert to buffer:", enc);
    return Buffer.alloc(0);
  }
}

async function runIdentify(args: {
  tenantId: string;
  examId?: string;
  courseId?: string;
  deviceId?: string;
  body: z.infer<typeof IdentifyBody>;
}) {
  const { tenantId, examId, courseId: courseTag, deviceId, body } = args;
  const sessionTag = body.academicSessionId;

  console.log(`[Identify] Start identification for tenant: ${tenantId}, Exam: ${examId || 'None'}`);

  let exam: ExamLean | null = null;
  let resolvedSessionYear: string | null = null;

  if (examId) {
    exam = await Exam.findOne({ _id: examId, tenantId }).lean<ExamLean | null>();
    if (!exam) {
      console.warn(`[Identify] Exam ${examId} not found for tenant ${tenantId}`);
      return { result: "exam_not_found", matchScore: null, student: null };
    }

    resolvedSessionYear = await resolveAcademicYearLabel(tenantId, exam.academicSessionId, exam.academicYear);
    if (!exam.courseId || !resolvedSessionYear || exam.semester == null) {
      const missing = [];
      if (!exam.courseId) missing.push("Course");
      if (!resolvedSessionYear) missing.push("Academic Year/Session");
      if (exam.semester == null) missing.push("Semester");
      console.warn(`[Identify] Exam ${examId} misconfigured: missing ${missing.join(', ')}`);
      return { 
        result: "exam_not_configured", 
        matchScore: null, 
        student: null, 
        detail: `Exam misconfigured: Missing ${missing.join(", ")}` 
      };
    }
    // ... rest of the exam checks ...
  }

  // IDENTIFY: Search ALL enrollments in the tenant
  const enrollments = await BiometricEnrollment.find({ tenantId }).lean<BiometricEnrollmentLean[]>();
  if (!enrollments.length) {
    console.info(`[Identify] No enrollments found in tenant ${tenantId}`);
    return { result: "not_enrolled", matchScore: null, student: null, detail: "No students have enrolled fingerprints in this system yet." };
  }

  console.log(`[Identify] Extracing probe template. Image Format: ${body.format}, Size: ${body.width}x${body.height}`);
  let probe: { template_base64: string };
  try {
    probe = await extractTemplate({
      imageBase64: body.imageBase64,
      width: body.width,
      height: body.height,
      dpi: body.dpi,
      format: body.format,
    });
  } catch (e: unknown) {
    console.error(`[Identify] Feature extraction failed:`, e);
    if (isMatchingUnreachable(e)) throw Object.assign(new Error("MATCHING_UNAVAILABLE"), { cause: e });
    throw e;
  }

  if (!probe.template_base64) {
    console.warn(`[Identify] Extraction returned empty template`);
    return { result: "no_match", matchScore: 0, student: null, detail: "Failed to extract features from the fingerprint. Please ensure your finger is clean and pressed firmly." };
  }

  const threshold = body.matchThreshold ?? 20; // Lowered for better initial success
  let bestScoreFound = -1;
  let bestStudentId: string | null = null;

  console.log(`[Identify] Probe template size: ${Buffer.from(probe.template_base64, 'base64').length} bytes. Checking ${enrollments.length} enrollments.`);

  for (const e of enrollments) {
    let raw: Buffer;
    try {
      const buf = tplBuf(e.templateEnc);
      if (buf.length === 0) {
         console.warn(`[Identify] Enrollment ${e._id} has empty templateEnc`);
         continue;
      }
      raw = decryptTemplate(buf);
    } catch (err) {
      console.error(`[Identify] Decryption failed for student ${e.studentId} (Enrollment: ${e._id}):`, err);
      continue;
    }
    
    const candB64 = raw.toString("base64");
    try {
      const m = await matchTemplates(probe.template_base64, candB64, threshold);
      console.log(`[Identify] Comparing probe with student ${e.studentId} (Enrollment: ${e._id}). Score: ${m.score}, Matched: ${m.matched}`);
      if (m.score > bestScoreFound) {
        bestScoreFound = m.score;
        if (m.matched) {
          bestStudentId = e.studentId;
        }
      }
    } catch (err: unknown) {
      console.error(`[Identify] Match error for student ${e.studentId}:`, err);
    }
  }

  console.log(`[Identify] Identification finished. Best score found: ${bestScoreFound}, Matched Student: ${bestStudentId || 'NONE'}`);

  if (!bestStudentId) {
    let detail = "Fingerprint does not match any enrolled student.";
    if (bestScoreFound > 0) {
      if (bestScoreFound < 5) {
        detail = "Record does not exist. No biometric data found matching this fingerprint.";
      } else {
        detail = `Closest match score was ${bestScoreFound.toFixed(1)}, but required threshold is ${threshold}. Try cleaning the scanner glass and pressing more firmly.`;
      }
    }
    return { result: "no_match", matchScore: bestScoreFound, student: null, detail };
  }

  const student = await Student.findOne({ _id: bestStudentId, tenantId }).lean<StudentLean | null>();
  if (!student) {
    return { result: "no_match", matchScore: bestScoreFound, student: null, detail: "Matched biometric data, but student profile not found." };
  }

  // NOW check against EXAM ROSTER if exam selected
  if (examId && exam) {
    console.log(`[Identify] Checking roster for Student: ${student._id}, Exam: ${examId}`);
    // Use both student._id and its string representation to be safe
    const onRoster = await ExamRosterEntry.findOne({ 
      examId, 
      $or: [
        { studentId: student._id },
        { studentId: student._id.toString() }
      ]
    }).lean();

    if (!onRoster) {
      console.warn(`[Identify] Student ${student.matricNo} NOT found on roster for Exam ${examId}`);
      return { 
        result: "not_on_roster", 
        matchScore: bestScoreFound, 
        student: { id: student._id, matricNo: student.matricNo, fullName: student.fullName, photoUrl: student.photoUrl },
        detail: "This student is identified, but NOT on the roster for this exam. Please verify they are added to the exam roster."
      };
    }

    console.log(`[Identify] Student ${student.matricNo} found on roster. Checking course registration...`);
    const registration = await CourseRegistration.findOne({
      tenantId,
      $or: [
        { studentId: student._id },
        { studentId: student._id.toString() }
      ],
      courseId: exam.courseId,
      academicYear: resolvedSessionYear,
      semester: exam.semester,
    }).lean();
    if (!registration) {
      return {
        result: "not_registered_for_course",
        matchScore: bestScoreFound,
        student: { id: student._id, matricNo: student.matricNo, fullName: student.fullName, photoUrl: student.photoUrl },
        detail: "Student identified and on roster, but NOT registered for the course offering."
      };
    }

    const priorMatch = await VerificationEvent.findOne({
      tenantId,
      studentId: student._id,
      examId,
      result: "match",
    }).lean<VerificationEventLean | null>();
    if (priorMatch) {
      return {
        result: "already_verified",
        matchScore: bestScoreFound,
        student: { id: student._id, matricNo: student.matricNo, fullName: student.fullName, photoUrl: student.photoUrl },
        examId, courseId: exam.courseId, academicYear: resolvedSessionYear, academicSessionId: exam.academicSessionId, semester: exam.semester,
      };
    }
  }

  const eventMeta = {
    tenantId,
    deviceId,
    studentId: student._id,
    examId,
    courseId: exam?.courseId,
    academicSessionId: exam?.academicSessionId,
    academicYear: resolvedSessionYear ?? exam?.academicYear ?? undefined,
    semester: exam?.semester,
  };

  try {
    await VerificationEvent.create({ ...eventMeta, result: "match", matchScore: bestScoreFound });
  } catch (e: unknown) {
    if ((e as { code?: number }).code === 11000 && examId) {
       return { result: "already_verified", matchScore: bestScoreFound, student: { id: student._id, matricNo: student.matricNo, fullName: student.fullName, photoUrl: student.photoUrl } };
    }
    throw e;
  }

  return {
    result: "match",
    matchScore: bestScoreFound,
    student: {
      id: student._id,
      matricNo: student.matricNo,
      fullName: student.fullName,
      photoUrl: student.photoUrl,
    },
    examId,
    courseId: exam?.courseId,
    academicYear: resolvedSessionYear ?? exam?.academicYear,
    academicSessionId: exam?.academicSessionId,
    semester: exam?.semester,
  };
}

async function runVerify(args: {
  tenantId: string;
  matricNo: string;
  examId?: string;
  courseId?: string;
  deviceId?: string;
  body: z.infer<typeof VerifyBody>;
}) {
  const { tenantId, matricNo, examId, courseId: courseTag, deviceId, body } = args;
  const sessionTag = body.academicSessionId;
  const student = await Student.findOne({ tenantId, matricNo }).lean<StudentLean | null>();
  if (!student) {
    return { result: "no_student", matchScore: null as number | null, student: null };
  }

  let exam: ExamLean | null = null;
  let resolvedSessionYear: string | null = null;
  if (examId) {
    exam = await Exam.findOne({ _id: examId, tenantId }).lean<ExamLean | null>();
    if (!exam) {
      return {
        result: "exam_not_found",
        matchScore: null as number | null,
        student: { id: student._id, matricNo: student.matricNo },
      };
    }
    const sessionYear = await resolveAcademicYearLabel(tenantId, exam.academicSessionId, exam.academicYear);
    resolvedSessionYear = sessionYear;
    if (!exam.courseId || !sessionYear || exam.semester == null) {
      const missing = [];
      if (!exam.courseId) missing.push("Course");
      if (!sessionYear) missing.push("Academic Year/Session");
      if (exam.semester == null) missing.push("Semester");
      return {
        result: "exam_not_configured",
        matchScore: null as number | null,
        student: { id: student._id, matricNo: student.matricNo },
        detail: `Exam misconfigured: Missing ${missing.join(", ")}`,
      };
    }
    if (sessionTag && exam.academicSessionId && sessionTag !== exam.academicSessionId) {
      return {
        result: "session_mismatch",
        matchScore: null as number | null,
        student: { id: student._id, matricNo: student.matricNo },
        expectedAcademicSessionId: exam.academicSessionId,
      };
    }
    if (courseTag && courseTag !== exam.courseId) {
      return {
        result: "course_mismatch",
        matchScore: null as number | null,
        student: { id: student._id, matricNo: student.matricNo },
        expectedCourseId: exam.courseId,
      };
    }

    const priorMatch = await VerificationEvent.findOne({
      tenantId,
      studentId: student._id,
      examId,
      result: "match",
    }).lean<VerificationEventLean | null>();
    if (priorMatch) {
      return {
        result: "already_verified",
        matchScore: priorMatch.matchScore ?? null,
        student: {
          id: student._id,
          matricNo: student.matricNo,
          fullName: student.fullName,
          photoUrl: student.photoUrl,
        },
        examId,
        courseId: exam.courseId,
        academicYear: sessionYear,
        academicSessionId: exam.academicSessionId,
        semester: exam.semester,
      };
    }

    const onRoster = await ExamRosterEntry.findOne({ examId, studentId: student._id }).lean<ExamRosterEntryLean | null>();
    if (!onRoster) {
      return { result: "not_on_roster", matchScore: null, student: { id: student._id, matricNo } };
    }

    const registration = await CourseRegistration.findOne({
      tenantId,
      studentId: student._id,
      courseId: exam.courseId,
      academicYear: sessionYear,
      semester: exam.semester,
    }).lean();
    if (!registration) {
      return {
        result: "not_registered_for_course",
        matchScore: null as number | null,
        student: { id: student._id, matricNo: student.matricNo },
        courseId: exam.courseId,
        academicYear: sessionYear,
        academicSessionId: exam.academicSessionId,
        semester: exam.semester,
      };
    }
  }

  const enrollments = await BiometricEnrollment.find({ studentId: student._id }).lean<BiometricEnrollmentLean[]>();
  if (!enrollments.length) {
    return { result: "not_enrolled", matchScore: null, student: { id: student._id, matricNo } };
  }

  let probe: { template_base64: string };
  try {
    probe = await extractTemplate({
      imageBase64: body.imageBase64,
      width: body.width,
      height: body.height,
      dpi: body.dpi,
      format: body.format,
    });
  } catch (e: unknown) {
    if (isMatchingUnreachable(e)) {
      throw Object.assign(new Error("MATCHING_UNAVAILABLE"), {
        cause: e,
      });
    }
    throw e;
  }

  const threshold = body.matchThreshold ?? 20;
  let best = -1;
  let matched = false;
  for (const e of enrollments) {
    let raw: Buffer;
    try {
      const buf = tplBuf(e.templateEnc);
      raw = decryptTemplate(buf);
    } catch (err) {
      console.error(`Decryption failed for enrollment ${e._id}:`, err);
      continue;
    }
    const candB64 = raw.toString("base64");
    let m: { score: number; matched: boolean };
    try {
      m = await matchTemplates(probe.template_base64, candB64, threshold);
    } catch (err: unknown) {
      if (isMatchingUnreachable(err)) {
        throw Object.assign(new Error("MATCHING_UNAVAILABLE"), { cause: err });
      }
      throw err;
    }
    if (m.score > best) best = m.score;
    if (m.matched) matched = true;
  }

  const eventMeta = {
    tenantId,
    deviceId,
    studentId: student._id,
    examId,
    courseId: exam?.courseId,
    academicSessionId: exam?.academicSessionId,
    academicYear: resolvedSessionYear ?? exam?.academicYear ?? undefined,
    semester: exam?.semester,
  };

  if (matched) {
    // ... verified block ...
  }

  // IF NO MATCH for the claimed student, perform IDENTIFY (1-to-many) to see if it's someone else (impersonation)
  const allEnrollments = await BiometricEnrollment.find({ tenantId }).lean<BiometricEnrollmentLean[]>();
  let mismatchStudentId: string | null = null;
  let mismatchScore = -1;

  for (const e of allEnrollments) {
    if (e.studentId === student._id.toString()) continue; // skip already checked
    try {
      const buf = tplBuf(e.templateEnc);
      const raw = decryptTemplate(buf);
      const m = await matchTemplates(probe.template_base64, raw.toString("base64"), threshold);
      if (m.matched && m.score > mismatchScore) {
        mismatchScore = m.score;
        mismatchStudentId = e.studentId;
      }
    } catch (err) { continue; }
  }

  if (mismatchStudentId) {
    await VerificationEvent.create({
      ...eventMeta,
      result: "mismatch",
      matchScore: mismatchScore,
      mismatchStudentId,
    });
    
    // Trigger notifications
    notifyMismatch({
      tenantId,
      claimedStudentId: student._id,
      actualStudentId: mismatchStudentId,
      deviceId,
      examId,
    }).catch(err => console.error("Notification failed:", err));

    const actualStudent = await Student.findById(mismatchStudentId).lean<StudentLean | null>();

    return {
      result: "mismatch",
      matchScore: mismatchScore,
      student: {
        id: student._id,
        matricNo: student.matricNo,
        fullName: student.fullName,
        photoUrl: student.photoUrl,
      },
      actualStudent: actualStudent ? {
        id: actualStudent._id,
        matricNo: actualStudent.matricNo,
        fullName: actualStudent.fullName,
      } : null,
      detail: `Mismatch detected! This fingerprint belongs to ${actualStudent?.fullName || 'another student'} (${actualStudent?.matricNo || 'unknown'}).`,
      examId,
      courseId: exam?.courseId,
    };
  }

  await VerificationEvent.create({
    ...eventMeta,
    result: "no_match",
    matchScore: best,
  });

  return {
    result: "no_match",
    matchScore: best,
    student: {
      id: student._id,
      matricNo: student.matricNo,
      fullName: student.fullName,
      photoUrl: student.photoUrl,
    },
    detail: best > 0 && best < 5 ? "Record does not exist." : "Fingerprint does not match the claimed student profile.",
    examId,
    courseId: exam?.courseId,
    academicYear: resolvedSessionYear ?? exam?.academicYear,
    academicSessionId: exam?.academicSessionId,
    semester: exam?.semester,
  };
}

async function runFaceIdentify(args: {
  tenantId: string;
  examId?: string;
  courseId?: string;
  deviceId?: string;
  matchThreshold?: number;
  imageBase64: string;
}) {
  const { tenantId, examId, courseId: courseTag, deviceId, matchThreshold, imageBase64 } = args;
  const threshold = matchThreshold ?? 0.55;

  let exam: ExamLean | null = null;
  let resolvedSessionYear: string | null = null;

  if (examId) {
    exam = await Exam.findOne({ _id: examId, tenantId }).lean<ExamLean | null>();
    if (!exam) return { result: "exam_not_found", matchScore: null, student: null };
    resolvedSessionYear = await resolveAcademicYearLabel(
      tenantId, exam.academicSessionId, exam.academicYear
    );
    if (!exam.courseId || !resolvedSessionYear || exam.semester == null) {
      return { result: "exam_not_configured", matchScore: null, student: null };
    }
  }

  const enrollments = await BiometricEnrollment.find({
    tenantId,
    modality: "face",
  }).lean<BiometricEnrollmentLean[]>();

  if (!enrollments.length) {
    return { result: "not_enrolled", matchScore: null, student: null };
  }

  let faceResult;
  try {
    faceResult = await extractFaceEmbedding(imageBase64);
  } catch (e: unknown) {
    console.error("[FaceIdentify] Extraction failed:", e);
    if (isFaceUnreachable(e))
      throw Object.assign(new Error("FACE_UNAVAILABLE"), { cause: e });
    throw e;
  }

  if (!faceResult.embeddings.length) {
    return { result: "no_face_detected", matchScore: null, student: null };
  }

  const probeBuf = embeddingB64ToBuffer(faceResult.embeddings[0].embedding_b64);
  const probeVec = bufferToFloat32Array(probeBuf);

  let bestScore = -1;
  let bestStudentId: string | null = null;

  for (const e of enrollments) {
    if (!e.faceEmbedding) continue;
    let raw: Buffer;
    try {
      const buf = tplBuf(e.faceEmbedding);
      if (buf.length === 0) continue;
      raw = decryptTemplate(buf);
    } catch (err) {
      console.error(`[FaceIdentify] Decrypt failed for student ${e.studentId}:`, err);
      continue;
    }
    const candVec = bufferToFloat32Array(raw);
    if (probeVec.length !== candVec.length) continue;
    const sim = cosineSimilarity(probeVec, candVec);
    if (sim > bestScore) {
      bestScore = sim;
      if (sim >= threshold) bestStudentId = e.studentId;
    }
  }

  if (!bestStudentId) {
    return { result: "no_match", matchScore: Math.round(bestScore * 100) / 100, student: null };
  }

  const student = await Student.findOne({ _id: bestStudentId, tenantId }).lean<StudentLean | null>();
  if (!student) {
    return { result: "no_match", matchScore: Math.round(bestScore * 100) / 100, student: null };
  }

  if (examId && exam) {
    const onRoster = await ExamRosterEntry.findOne({
      examId,
      $or: [{ studentId: student._id }, { studentId: student._id.toString() }],
    }).lean();
    if (!onRoster) {
      return {
        result: "not_on_roster",
        matchScore: Math.round(bestScore * 100) / 100,
        student: { id: student._id, matricNo: student.matricNo, fullName: student.fullName, photoUrl: student.photoUrl },
      };
    }

    const registration = await CourseRegistration.findOne({
      tenantId,
      $or: [{ studentId: student._id }, { studentId: student._id.toString() }],
      courseId: exam.courseId,
      academicYear: resolvedSessionYear,
      semester: exam.semester,
    }).lean();
    if (!registration) {
      return {
        result: "not_registered_for_course",
        matchScore: Math.round(bestScore * 100) / 100,
        student: { id: student._id, matricNo: student.matricNo, fullName: student.fullName, photoUrl: student.photoUrl },
      };
    }

    const priorMatch = await VerificationEvent.findOne({
      tenantId,
      studentId: student._id,
      examId,
      result: "match",
    }).lean<VerificationEventLean | null>();
    if (priorMatch) {
      return {
        result: "already_verified",
        matchScore: Math.round(bestScore * 100) / 100,
        student: { id: student._id, matricNo: student.matricNo, fullName: student.fullName, photoUrl: student.photoUrl },
      };
    }
  }

  const eventMeta = {
    tenantId,
    deviceId,
    studentId: student._id,
    examId,
    courseId: exam?.courseId,
    academicSessionId: exam?.academicSessionId,
    academicYear: resolvedSessionYear ?? exam?.academicYear ?? undefined,
    semester: exam?.semester,
    modality: "face" as const,
  };

  try {
    await VerificationEvent.create({ ...eventMeta, result: "match", matchScore: Math.round(bestScore * 100) / 100 });
  } catch (e: unknown) {
    if ((e as { code?: number }).code === 11000 && examId) {
      return {
        result: "already_verified",
        matchScore: Math.round(bestScore * 100) / 100,
        student: { id: student._id, matricNo: student.matricNo, fullName: student.fullName, photoUrl: student.photoUrl },
      };
    }
    throw e;
  }

  return {
    result: "match",
    matchScore: Math.round(bestScore * 100) / 100,
    student: {
      id: student._id,
      matricNo: student.matricNo,
      fullName: student.fullName,
      photoUrl: student.photoUrl,
    },
    examId,
    courseId: exam?.courseId,
    academicYear: resolvedSessionYear ?? exam?.academicYear,
    academicSessionId: exam?.academicSessionId,
    semester: exam?.semester,
  };
}

async function runFaceVerify(args: {
  tenantId: string;
  matricNo: string;
  examId?: string;
  courseId?: string;
  deviceId?: string;
  matchThreshold?: number;
  imageBase64: string;
}) {
  const { tenantId, matricNo, examId, courseId: courseTag, deviceId, matchThreshold, imageBase64 } = args;
  const threshold = matchThreshold ?? 0.55;

  const student = await Student.findOne({ tenantId, matricNo }).lean<StudentLean | null>();
  if (!student) return { result: "no_student", matchScore: null, student: null };

  let exam: ExamLean | null = null;
  let resolvedSessionYear: string | null = null;
  if (examId) {
    exam = await Exam.findOne({ _id: examId, tenantId }).lean<ExamLean | null>();
    if (!exam) return { result: "exam_not_found", matchScore: null, student: { id: student._id, matricNo: student.matricNo } };
    resolvedSessionYear = await resolveAcademicYearLabel(tenantId, exam.academicSessionId, exam.academicYear);
    if (!exam.courseId || !resolvedSessionYear || exam.semester == null) {
      return { result: "exam_not_configured", matchScore: null, student: { id: student._id, matricNo: student.matricNo } };
    }
    const priorMatch = await VerificationEvent.findOne({
      tenantId, studentId: student._id, examId, result: "match",
    }).lean<VerificationEventLean | null>();
    if (priorMatch) {
      return {
        result: "already_verified",
        matchScore: priorMatch.matchScore ?? null,
        student: { id: student._id, matricNo: student.matricNo, fullName: student.fullName, photoUrl: student.photoUrl },
      };
    }
    const onRoster = await ExamRosterEntry.findOne({ examId, studentId: student._id }).lean();
    if (!onRoster) return { result: "not_on_roster", matchScore: null, student: { id: student._id, matricNo } };
    const registration = await CourseRegistration.findOne({
      tenantId, studentId: student._id, courseId: exam.courseId, academicYear: resolvedSessionYear, semester: exam.semester,
    }).lean();
    if (!registration) {
      return {
        result: "not_registered_for_course",
        matchScore: null,
        student: { id: student._id, matricNo: student.matricNo },
      };
    }
  }

  const faceEnrollment = await BiometricEnrollment.findOne({
    studentId: student._id,
    modality: "face",
  }).lean<BiometricEnrollmentLean | null>();

  if (!faceEnrollment || !faceEnrollment.faceEmbedding) {
    return { result: "not_enrolled", matchScore: null, student: { id: student._id, matricNo } };
  }

  let faceResult;
  try {
    faceResult = await extractFaceEmbedding(imageBase64);
  } catch (e: unknown) {
    if (isFaceUnreachable(e))
      throw Object.assign(new Error("FACE_UNAVAILABLE"), { cause: e });
    throw e;
  }

  if (!faceResult.embeddings.length) {
    return { result: "no_face_detected", matchScore: null, student: { id: student._id, matricNo } };
  }

  const probeBuf = embeddingB64ToBuffer(faceResult.embeddings[0].embedding_b64);
  const probeVec = bufferToFloat32Array(probeBuf);

  let raw: Buffer;
  try {
    const buf = tplBuf(faceEnrollment.faceEmbedding);
    raw = decryptTemplate(buf);
  } catch (err) {
    console.error(`[FaceVerify] Decrypt failed:`, err);
    return { result: "not_enrolled", matchScore: null, student: { id: student._id, matricNo } };
  }

  const candVec = bufferToFloat32Array(raw);
  const sim = cosineSimilarity(probeVec, candVec);
  const matched = sim >= threshold;

  const eventMeta = {
    tenantId,
    deviceId,
    studentId: student._id,
    examId,
    courseId: exam?.courseId,
    academicSessionId: exam?.academicSessionId,
    academicYear: resolvedSessionYear ?? exam?.academicYear ?? undefined,
    semester: exam?.semester,
    modality: "face" as const,
  };

  if (matched) {
    try {
      await VerificationEvent.create({ ...eventMeta, result: "match", matchScore: Math.round(sim * 100) / 100 });
    } catch (e: unknown) {
      if ((e as { code?: number }).code === 11000 && examId) {
        return {
          result: "already_verified",
          matchScore: Math.round(sim * 100) / 100,
          student: { id: student._id, matricNo: student.matricNo, fullName: student.fullName, photoUrl: student.photoUrl },
        };
      }
      throw e;
    }
    return {
      result: "match",
      matchScore: Math.round(sim * 100) / 100,
      student: { id: student._id, matricNo: student.matricNo, fullName: student.fullName, photoUrl: student.photoUrl },
    };
  }

  return {
    result: "no_match",
    matchScore: Math.round(sim * 100) / 100,
    student: { id: student._id, matricNo: student.matricNo, fullName: student.fullName, photoUrl: student.photoUrl },
  };
}

export async function verifyRoutes(app: FastifyInstance) {
  app.post(
    "/verify/identify",
    {
      onRequest: [
        app.authenticate,
        requireRole([Role.SUPER_ADMIN, Role.TENANT_ADMIN, Role.ENROLLER, Role.BIOMETRIC_OPERATOR, Role.INVIGILATOR]),
      ],
    },
    async (req, reply) => {
      const user = req.user as JwtUser;
      const tid = resolveTenantId(req, reply, user);
      if (!tid) return;
      const body = IdentifyBody.parse(req.body);
      try {
        return await runIdentify({
          tenantId: tid,
          examId: body.examId,
          courseId: body.courseId,
          body,
        });
      } catch (e: unknown) {
        if (e instanceof Error && e.message === "MATCHING_UNAVAILABLE") {
          return reply.code(503).send({ error: "Matching service unavailable" });
        }
        throw e;
      }
    }
  );

  app.post(
    "/device/verify/identify",
    { onRequest: [authenticateDevice] },
    async (req, reply) => {
      const body = IdentifyBody.parse(req.body);
      try {
        return await runIdentify({
          tenantId: req.device!.tenantId,
          examId: body.examId,
          courseId: body.courseId,
          deviceId: req.device!.id,
          body,
        });
      } catch (e: unknown) {
         if (e instanceof Error && e.message === "MATCHING_UNAVAILABLE") {
          return reply.code(503).send({ error: "Matching service unavailable" });
        }
        throw e;
      }
    }
  );

  app.post(
    "/verify/one-to-one",
    {
      onRequest: [
        app.authenticate,
        requireRole([
          Role.SUPER_ADMIN,
          Role.TENANT_ADMIN,
          Role.ENROLLER,
          Role.BIOMETRIC_OPERATOR,
          Role.INVIGILATOR,
        ]),
      ],
    },
    async (req, reply) => {
      const user = req.user as JwtUser;
      const tid = resolveTenantId(req, reply, user);
      if (!tid) return;
      const body = VerifyBody.parse(req.body);
      try {
        return await runVerify({
          tenantId: tid,
          matricNo: body.matricNo,
          examId: body.examId,
          courseId: body.courseId,
          body,
        });
      } catch (e: unknown) {
        if (e instanceof Error && e.message === "MATCHING_UNAVAILABLE") {
          return reply.code(503).send({
            error: "Matching service unavailable",
            hint: `Start the SourceAFIS Java service at ${matchingServiceUrl()}.`,
          });
        }
        throw e;
      }
    }
  );

  app.post(
    "/device/verify/one-to-one",
    { onRequest: [authenticateDevice] },
    async (req, reply) => {
      const body = VerifyBody.parse(req.body);
      try {
        return await runVerify({
          tenantId: req.device!.tenantId,
          matricNo: body.matricNo,
          examId: body.examId,
          courseId: body.courseId,
          deviceId: req.device!.id,
          body,
        });
      } catch (e: unknown) {
        if (e instanceof Error && e.message === "MATCHING_UNAVAILABLE") {
          return reply.code(503).send({
            error: "Matching service unavailable",
            hint: `Start the SourceAFIS Java service at ${matchingServiceUrl()}.`,
          });
        }
        throw e;
      }
    }
  );

  const FaceIdentifyBody = z.object({
    examId: z.string().optional(),
    courseId: z.string().optional(),
    imageBase64: z.string().min(1),
    matchThreshold: z.coerce.number().optional(),
  });

  const FaceVerifyBody = z.object({
    matricNo: z.string().min(1),
    examId: z.string().optional(),
    courseId: z.string().optional(),
    imageBase64: z.string().min(1),
    matchThreshold: z.coerce.number().optional(),
  });

  app.post(
    "/verify/face/identify",
    {
      onRequest: [
        app.authenticate,
        requireRole([Role.SUPER_ADMIN, Role.TENANT_ADMIN, Role.ENROLLER, Role.BIOMETRIC_OPERATOR, Role.INVIGILATOR]),
      ],
    },
    async (req, reply) => {
      const user = req.user as JwtUser;
      const tid = resolveTenantId(req, reply, user);
      if (!tid) return;
      const body = FaceIdentifyBody.parse(req.body);
      try {
        return await runFaceIdentify({
          tenantId: tid,
          examId: body.examId,
          courseId: body.courseId,
          matchThreshold: body.matchThreshold,
          imageBase64: body.imageBase64,
        });
      } catch (e: unknown) {
        if (e instanceof Error && e.message === "FACE_UNAVAILABLE") {
          return reply.code(503).send({ error: "Face service unavailable" });
        }
        throw e;
      }
    }
  );

  app.post(
    "/device/verify/face/identify",
    { onRequest: [authenticateDevice] },
    async (req, reply) => {
      const body = FaceIdentifyBody.parse(req.body);
      try {
        return await runFaceIdentify({
          tenantId: req.device!.tenantId,
          examId: body.examId,
          courseId: body.courseId,
          deviceId: req.device!.id,
          matchThreshold: body.matchThreshold,
          imageBase64: body.imageBase64,
        });
      } catch (e: unknown) {
        if (e instanceof Error && e.message === "FACE_UNAVAILABLE") {
          return reply.code(503).send({ error: "Face service unavailable" });
        }
        throw e;
      }
    }
  );

  app.post(
    "/verify/face/one-to-one",
    {
      onRequest: [
        app.authenticate,
        requireRole([Role.SUPER_ADMIN, Role.TENANT_ADMIN, Role.ENROLLER, Role.BIOMETRIC_OPERATOR, Role.INVIGILATOR]),
      ],
    },
    async (req, reply) => {
      const user = req.user as JwtUser;
      const tid = resolveTenantId(req, reply, user);
      if (!tid) return;
      const body = FaceVerifyBody.parse(req.body);
      try {
        return await runFaceVerify({
          tenantId: tid,
          matricNo: body.matricNo,
          examId: body.examId,
          courseId: body.courseId,
          matchThreshold: body.matchThreshold,
          imageBase64: body.imageBase64,
        });
      } catch (e: unknown) {
        if (e instanceof Error && e.message === "FACE_UNAVAILABLE") {
          return reply.code(503).send({ error: "Face service unavailable" });
        }
        throw e;
      }
    }
  );

  app.post(
    "/device/verify/face/one-to-one",
    { onRequest: [authenticateDevice] },
    async (req, reply) => {
      const body = FaceVerifyBody.parse(req.body);
      try {
        return await runFaceVerify({
          tenantId: req.device!.tenantId,
          matricNo: body.matricNo,
          examId: body.examId,
          courseId: body.courseId,
          deviceId: req.device!.id,
          matchThreshold: body.matchThreshold,
          imageBase64: body.imageBase64,
        });
      } catch (e: unknown) {
        if (e instanceof Error && e.message === "FACE_UNAVAILABLE") {
          return reply.code(503).send({ error: "Face service unavailable" });
        }
        throw e;
      }
    }
  );
}
