import { z } from "zod";
import { Role } from "../models/roles.js";
import { BiometricEnrollment, CourseRegistration, Exam, ExamRosterEntry, Student, VerificationEvent, } from "../models/schemas.js";
import { requireRole } from "../lib/auth.js";
import { resolveTenantId } from "../lib/tenantScope.js";
import { decryptTemplate } from "../lib/crypto.js";
import { extractTemplate, isMatchingUnreachable, matchTemplates, matchingServiceUrl } from "../lib/matchingClient.js";
import { authenticateDevice } from "../lib/deviceAuth.js";
import { resolveAcademicYearLabel } from "../lib/resolveAcademicYear.js";
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
function tplBuf(enc) {
    if (Buffer.isBuffer(enc))
        return enc;
    return Buffer.from(enc);
}
async function runVerify(args) {
    const { tenantId, matricNo, examId, courseId: courseTag, deviceId, body } = args;
    const sessionTag = body.academicSessionId;
    const student = await Student.findOne({ tenantId, matricNo }).lean();
    if (!student) {
        return { result: "no_student", matchScore: null, student: null };
    }
    let exam = null;
    let resolvedSessionYear = null;
    if (examId) {
        exam = await Exam.findOne({ _id: examId, tenantId }).lean();
        if (!exam) {
            return {
                result: "exam_not_found",
                matchScore: null,
                student: { id: student._id, matricNo: student.matricNo },
            };
        }
        const sessionYear = await resolveAcademicYearLabel(tenantId, exam.academicSessionId, exam.academicYear);
        resolvedSessionYear = sessionYear;
        if (!exam.courseId || !sessionYear || exam.semester == null) {
            return {
                result: "exam_not_configured",
                matchScore: null,
                student: { id: student._id, matricNo: student.matricNo },
                detail: "Exam must have courseId, academic year (or session), and semester",
            };
        }
        if (sessionTag && exam.academicSessionId && sessionTag !== exam.academicSessionId) {
            return {
                result: "session_mismatch",
                matchScore: null,
                student: { id: student._id, matricNo: student.matricNo },
                expectedAcademicSessionId: exam.academicSessionId,
            };
        }
        if (courseTag && courseTag !== exam.courseId) {
            return {
                result: "course_mismatch",
                matchScore: null,
                student: { id: student._id, matricNo: student.matricNo },
                expectedCourseId: exam.courseId,
            };
        }
        const priorMatch = await VerificationEvent.findOne({
            tenantId,
            studentId: student._id,
            examId,
            result: "match",
        }).lean();
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
        const onRoster = await ExamRosterEntry.findOne({ examId, studentId: student._id }).lean();
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
                matchScore: null,
                student: { id: student._id, matricNo: student.matricNo },
                courseId: exam.courseId,
                academicYear: sessionYear,
                academicSessionId: exam.academicSessionId,
                semester: exam.semester,
            };
        }
    }
    const enrollments = await BiometricEnrollment.find({ studentId: student._id }).lean();
    if (!enrollments.length) {
        return { result: "not_enrolled", matchScore: null, student: { id: student._id, matricNo } };
    }
    let probe;
    try {
        probe = await extractTemplate({
            imageBase64: body.imageBase64,
            width: body.width,
            height: body.height,
            dpi: body.dpi,
            format: body.format,
        });
    }
    catch (e) {
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
        const raw = decryptTemplate(tplBuf(e.templateEnc));
        const candB64 = raw.toString("base64");
        let m;
        try {
            m = await matchTemplates(probe.template_base64, candB64, threshold);
        }
        catch (err) {
            if (isMatchingUnreachable(err)) {
                throw Object.assign(new Error("MATCHING_UNAVAILABLE"), { cause: err });
            }
            throw err;
        }
        if (m.score > best)
            best = m.score;
        if (m.matched)
            matched = true;
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
        try {
            await VerificationEvent.create({
                ...eventMeta,
                result: "match",
                matchScore: best,
            });
        }
        catch (e) {
            if (e.code === 11000) {
                return {
                    result: "already_verified",
                    matchScore: best,
                    student: {
                        id: student._id,
                        matricNo: student.matricNo,
                        fullName: student.fullName,
                        photoUrl: student.photoUrl,
                    },
                    examId,
                    courseId: exam?.courseId,
                };
            }
            throw e;
        }
        return {
            result: "match",
            matchScore: best,
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
        examId,
        courseId: exam?.courseId,
        academicYear: resolvedSessionYear ?? exam?.academicYear,
        academicSessionId: exam?.academicSessionId,
        semester: exam?.semester,
    };
}
export async function verifyRoutes(app) {
    app.post("/verify/one-to-one", {
        onRequest: [
            app.authenticate,
            requireRole([
                Role.SUPER_ADMIN,
                Role.TENANT_ADMIN,
                Role.ENROLLER,
                Role.INVIGILATOR,
            ]),
        ],
    }, async (req, reply) => {
        const user = req.user;
        const tid = resolveTenantId(req, reply, user);
        if (!tid)
            return;
        const body = VerifyBody.parse(req.body);
        try {
            return await runVerify({
                tenantId: tid,
                matricNo: body.matricNo,
                examId: body.examId,
                courseId: body.courseId,
                body,
            });
        }
        catch (e) {
            if (e instanceof Error && e.message === "MATCHING_UNAVAILABLE") {
                return reply.code(503).send({
                    error: "Matching service unavailable",
                    hint: `Start the SourceAFIS Java service at ${matchingServiceUrl()}.`,
                });
            }
            throw e;
        }
    });
    app.post("/device/verify/one-to-one", { onRequest: [authenticateDevice] }, async (req, reply) => {
        const body = VerifyBody.parse(req.body);
        try {
            return await runVerify({
                tenantId: req.device.tenantId,
                matricNo: body.matricNo,
                examId: body.examId,
                courseId: body.courseId,
                deviceId: req.device.id,
                body,
            });
        }
        catch (e) {
            if (e instanceof Error && e.message === "MATCHING_UNAVAILABLE") {
                return reply.code(503).send({
                    error: "Matching service unavailable",
                    hint: `Start the SourceAFIS Java service at ${matchingServiceUrl()}.`,
                });
            }
            throw e;
        }
    });
}
