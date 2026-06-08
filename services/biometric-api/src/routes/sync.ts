import type { FastifyInstance } from "fastify";
import { z } from "zod";
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
import { authenticateDevice } from "../lib/deviceAuth.js";
import { resolveAcademicYearLabel } from "../lib/resolveAcademicYear.js";

const Query = z.object({
  examId: z.string().min(1),
});

/** Offline package: roster + encrypted templates (as stored in DB). */
export async function syncRoutes(app: FastifyInstance) {
  app.get(
    "/sync/exam-package",
    { onRequest: [authenticateDevice] },
    async (req, reply) => {
      const q = Query.parse(req.query);
      const tenantId = req.device!.tenantId;
      const exam = await Exam.findOne({ _id: q.examId, tenantId }).lean<ExamLean | null>();
      if (!exam) return reply.code(404).send({ error: "Exam not found" });

      const roster = await ExamRosterEntry.find({ examId: exam._id }).lean<ExamRosterEntryLean[]>();
      const studentIds = roster.map((r) => r.studentId);
      const students = await Student.find({ _id: { $in: studentIds }, tenantId }).lean<StudentLean[]>();

      const sessionYear = await resolveAcademicYearLabel(tenantId, exam.academicSessionId, exam.academicYear);
      let regByStudent: Map<string, boolean>;
      if (exam.courseId && sessionYear && exam.semester != null) {
        const regs = await CourseRegistration.find({
          tenantId,
          courseId: exam.courseId,
          academicYear: sessionYear,
          semester: exam.semester,
          studentId: { $in: studentIds },
        }).lean();
        const regSet = new Set(regs.map((r) => r.studentId));
        regByStudent = new Map(studentIds.map((sid) => [sid, regSet.has(sid)]));
      } else {
        regByStudent = new Map(studentIds.map((sid) => [sid, true]));
      }
      const enrollments = await BiometricEnrollment.find({ studentId: { $in: studentIds } }).lean<BiometricEnrollmentLean[]>();
      const enrollByStudent = new Map<string, BiometricEnrollmentLean[]>();
      for (const e of enrollments) {
        const list = enrollByStudent.get(e.studentId) ?? [];
        list.push(e);
        enrollByStudent.set(e.studentId, list);
      }

      const rosterByStudent = new Map(roster.map((r) => [r.studentId, r.hallLabel]));
      const outStudents = students.map((st) => ({
        studentId: st._id,
        matricNo: st.matricNo,
        fullName: st.fullName,
        photoUrl: st.photoUrl ?? null,
        hallLabel: rosterByStudent.get(st._id) ?? null,
        eligibleForExam: regByStudent.get(st._id) ?? false,
        enrollments: (enrollByStudent.get(st._id) ?? []).map((e) => ({
          fingerCode: e.fingerCode,
          templateEncBase64: Buffer.from(e.templateEnc as Buffer).toString("base64"),
          templateVersion: e.templateVersion,
          qualityScore: e.qualityScore,
        })),
      }));

      return {
        examId: exam._id,
        title: exam.title,
        courseId: exam.courseId ?? null,
        academicSessionId: exam.academicSessionId ?? null,
        academicYear: sessionYear ?? exam.academicYear ?? null,
        semester: exam.semester ?? null,
        tenantId,
        students: outStudents,
      };
    }
  );

  app.post(
    "/sync/verification-events",
    { onRequest: [authenticateDevice] },
    async (req) => {
      const tenantId = req.device!.tenantId;
      const body = z
        .object({
          events: z.array(
            z.object({
              studentId: z.string(),
              examId: z.string().optional(),
              courseId: z.string().optional(),
              academicSessionId: z.string().optional(),
              academicYear: z.string().optional(),
              semester: z.number().optional(),
              result: z.string(),
              matchScore: z.number().optional(),
              capturedAt: z.string().datetime().optional(),
              idempotencyKey: z.string().optional(),
            })
          ),
        })
        .parse(req.body);

      const ids: string[] = [];
      for (const ev of body.events) {
        const capturedAt = ev.capturedAt ? new Date(ev.capturedAt) : new Date();
        if (ev.idempotencyKey) {
          const row = await VerificationEvent.findOneAndUpdate(
            { idempotencyKey: ev.idempotencyKey },
            {
              $set: { syncedAt: new Date() },
              $setOnInsert: {
                tenantId,
                deviceId: req.device!.id,
                studentId: ev.studentId,
                examId: ev.examId,
                courseId: ev.courseId,
                academicSessionId: ev.academicSessionId,
                academicYear: ev.academicYear,
                semester: ev.semester,
                result: ev.result,
                matchScore: ev.matchScore,
                capturedAt,
                idempotencyKey: ev.idempotencyKey,
              },
            },
            { upsert: true, new: true }
          ).lean<VerificationEventLean | null>();
          if (row) ids.push(row._id);
        } else {
          try {
            const row = await VerificationEvent.create({
              tenantId,
              deviceId: req.device!.id,
              studentId: ev.studentId,
              examId: ev.examId,
              courseId: ev.courseId,
              academicSessionId: ev.academicSessionId,
              academicYear: ev.academicYear,
              semester: ev.semester,
              result: ev.result,
              matchScore: ev.matchScore,
              capturedAt,
              syncedAt: new Date(),
            });
            ids.push(row._id);
          } catch (e: unknown) {
            if ((e as { code?: number }).code === 11000) {
              continue;
            }
            throw e;
          }
        }
      }
      return { ok: true, ids };
    }
  );
}
