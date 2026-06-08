import { z } from "zod";
import { Role } from "../models/roles.js";
import { Course, Exam, ExamRosterEntry, Student } from "../models/schemas.js";
import { requireRole } from "../lib/auth.js";
import { resolveTenantId } from "../lib/tenantScope.js";
import { withId, withIds } from "../lib/serialize.js";
import { resolveAcademicYearLabel } from "../lib/resolveAcademicYear.js";
const CreateExam = z
    .object({
    title: z.string().min(1),
    courseId: z.string().min(1),
    academicSessionId: z.string().optional(),
    academicYear: z.string().optional(),
    semester: z.coerce.number().int().min(1).max(2),
    startsAt: z.string().datetime().optional(),
    endsAt: z.string().datetime().optional(),
})
    .refine((d) => d.academicSessionId || (d.academicYear && d.academicYear.trim().length > 0), {
    message: "Provide academicSessionId or academicYear",
});
const PatchExam = z.object({
    title: z.string().min(1).optional(),
    courseId: z.string().min(1).optional(),
    academicSessionId: z.string().nullable().optional(),
    academicYear: z.string().min(1).optional(),
    semester: z.coerce.number().int().min(1).max(2).optional(),
    startsAt: z.string().datetime().optional().nullable(),
    endsAt: z.string().datetime().optional().nullable(),
});
const RosterBulk = z.object({
    entries: z.array(z.object({
        studentId: z.string(),
        hallLabel: z.string().optional(),
    })),
});
export async function examRoutes(app) {
    app.post("/exams", {
        onRequest: [
            app.authenticate,
            requireRole([Role.SUPER_ADMIN, Role.TENANT_ADMIN, Role.ENROLLER]),
        ],
    }, async (req, reply) => {
        const user = req.user;
        const tid = resolveTenantId(req, reply, user);
        if (!tid)
            return;
        const body = CreateExam.parse(req.body);
        const course = await Course.findOne({ _id: body.courseId, tenantId: tid }).lean();
        if (!course)
            return reply.code(400).send({ error: "Course not found" });
        const academicYear = await resolveAcademicYearLabel(tid, body.academicSessionId, body.academicYear ?? null);
        if (!academicYear)
            return reply.code(400).send({ error: "Invalid or missing academic session" });
        const exam = await Exam.create({
            tenantId: tid,
            title: body.title,
            courseId: body.courseId,
            academicSessionId: body.academicSessionId ?? null,
            academicYear,
            semester: body.semester,
            startsAt: body.startsAt ? new Date(body.startsAt) : undefined,
            endsAt: body.endsAt ? new Date(body.endsAt) : undefined,
        });
        return withId(exam.toObject());
    });
    app.get("/exams", {
        onRequest: [
            app.authenticate,
            requireRole([
                Role.SUPER_ADMIN,
                Role.TENANT_ADMIN,
                Role.ENROLLER,
                Role.INVIGILATOR,
                Role.VIEWER,
            ]),
        ],
    }, async (req, reply) => {
        const user = req.user;
        const tid = resolveTenantId(req, reply, user);
        if (!tid)
            return;
        const rows = await Exam.find({ tenantId: tid }).sort({ createdAt: -1 }).lean();
        return withIds(rows);
    });
    app.post("/exams/:examId/roster", {
        onRequest: [
            app.authenticate,
            requireRole([Role.SUPER_ADMIN, Role.TENANT_ADMIN, Role.ENROLLER]),
        ],
    }, async (req, reply) => {
        const user = req.user;
        const tid = resolveTenantId(req, reply, user);
        if (!tid)
            return;
        const examId = req.params.examId;
        const body = RosterBulk.parse(req.body);
        const exam = await Exam.findOne({ _id: examId, tenantId: tid }).lean();
        if (!exam)
            return reply.code(404).send({ error: "Exam not found" });
        for (const e of body.entries) {
            const st = await Student.findOne({ _id: e.studentId, tenantId: tid }).lean();
            if (!st)
                return reply.code(400).send({ error: `Unknown student ${e.studentId}` });
        }
        await Promise.all(body.entries.map((e) => ExamRosterEntry.findOneAndUpdate({ examId, studentId: e.studentId }, { $set: { examId, studentId: e.studentId, hallLabel: e.hallLabel } }, { upsert: true, new: true })));
        return { ok: true, count: body.entries.length };
    });
    app.patch("/exams/:examId", {
        onRequest: [
            app.authenticate,
            requireRole([Role.SUPER_ADMIN, Role.TENANT_ADMIN, Role.ENROLLER]),
        ],
    }, async (req, reply) => {
        const user = req.user;
        const tid = resolveTenantId(req, reply, user);
        if (!tid)
            return;
        const examId = req.params.examId;
        const body = PatchExam.parse(req.body);
        if (body.courseId) {
            const course = await Course.findOne({ _id: body.courseId, tenantId: tid }).lean();
            if (!course)
                return reply.code(400).send({ error: "Course not found" });
        }
        const existing = await Exam.findOne({ _id: examId, tenantId: tid }).lean();
        if (!existing)
            return reply.code(404).send({ error: "Exam not found" });
        const updates = {};
        if (body.title !== undefined)
            updates.title = body.title;
        if (body.courseId !== undefined)
            updates.courseId = body.courseId;
        if (body.semester !== undefined)
            updates.semester = body.semester;
        if (body.startsAt !== undefined)
            updates.startsAt = body.startsAt ? new Date(body.startsAt) : null;
        if (body.endsAt !== undefined)
            updates.endsAt = body.endsAt ? new Date(body.endsAt) : null;
        if (body.academicSessionId !== undefined)
            updates.academicSessionId = body.academicSessionId;
        if (body.academicYear !== undefined || body.academicSessionId !== undefined) {
            const y = await resolveAcademicYearLabel(tid, body.academicSessionId !== undefined ? body.academicSessionId : existing.academicSessionId, body.academicYear !== undefined ? body.academicYear : existing.academicYear);
            if (y)
                updates.academicYear = y;
        }
        const exam = await Exam.findOneAndUpdate({ _id: examId, tenantId: tid }, { $set: updates }, { new: true }).lean();
        if (!exam)
            return reply.code(404).send({ error: "Exam not found" });
        return withId(exam);
    });
}
