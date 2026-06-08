import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Role } from "../models/roles.js";
import type { ExamLean } from "../models/lean.js";
import { Course, Exam, ExamRosterEntry, Student } from "../models/schemas.js";
import { requireRole } from "../lib/auth.js";
import { resolveTenantId, type JwtUser } from "../lib/tenantScope.js";
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
  entries: z.array(
    z.object({
      studentId: z.string().optional(),
      matricNo: z.string().optional(),
      hallLabel: z.string().optional(),
    })
  ),
});

const RosterDepartment = z.object({
  departmentId: z.string().min(1),
  hallLabel: z.string().optional(),
});

export async function examRoutes(app: FastifyInstance) {
  app.post(
    "/exams/:examId/roster/bulk-department",
    {
      onRequest: [
        app.authenticate,
        requireRole([Role.SUPER_ADMIN, Role.TENANT_ADMIN, Role.ENROLLER]),
      ],
    },
    async (req, reply) => {
      const user = req.user as JwtUser;
      const tid = resolveTenantId(req, reply, user);
      if (!tid) return;
      const examId = (req.params as { examId: string }).examId;
      const body = RosterDepartment.parse(req.body);
      
      const exam = await Exam.findOne({ _id: examId, tenantId: tid }).lean();
      if (!exam) return reply.code(404).send({ error: "Exam not found" });

      console.log(`[Roster] Bulk add by department: ${body.departmentId} for exam: ${examId}`);

      const students = await Student.find({ departmentId: body.departmentId, tenantId: tid }).lean();
      if (students.length === 0) {
        console.warn(`[Roster] No students found in department ${body.departmentId}`);
        return { ok: true, count: 0, total: 0 };
      }

      console.log(`[Roster] Found ${students.length} students in department. Matric numbers: ${students.map(s => s.matricNo).join(', ')}`);

      const ops = students.map((s) => ({
        updateOne: {
          filter: { examId, studentId: s._id },
          update: { $set: { examId, studentId: s._id, hallLabel: body.hallLabel } },
          upsert: true,
        }
      }));

      const bulkRes = await ExamRosterEntry.bulkWrite(ops);
      console.log(`[Roster] Bulk write finished. Upserted: ${bulkRes.upsertedCount}, Modified: ${bulkRes.modifiedCount}`);

      return { ok: true, count: students.length, total: students.length };
    }
  );

  app.post(
    "/exams",
    {
      onRequest: [
        app.authenticate,
        requireRole([Role.SUPER_ADMIN, Role.TENANT_ADMIN, Role.ENROLLER]),
      ],
    },
    async (req, reply) => {
      const user = req.user as JwtUser;
      const tid = resolveTenantId(req, reply, user);
      if (!tid) return;
      const body = CreateExam.parse(req.body);
      const course = await Course.findOne({ _id: body.courseId, tenantId: tid }).lean();
      if (!course) return reply.code(400).send({ error: "Course not found" });
      const academicYear = await resolveAcademicYearLabel(tid, body.academicSessionId, body.academicYear ?? null);
      if (!academicYear) return reply.code(400).send({ error: "Invalid or missing academic session" });
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
      return withId(exam.toObject() as { _id: string });
    }
  );

  app.get(
    "/exams",
    {
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
    },
    async (req, reply) => {
      const user = req.user as JwtUser;
      const tid = resolveTenantId(req, reply, user);
      if (!tid) return;
      const rows = await Exam.find({ tenantId: tid }).sort({ createdAt: -1 }).lean();
      return withIds(rows as { _id: string }[]);
    }
  );

  app.post(
    "/exams/:examId/roster",
    {
      onRequest: [
        app.authenticate,
        requireRole([Role.SUPER_ADMIN, Role.TENANT_ADMIN, Role.ENROLLER]),
      ],
    },
    async (req, reply) => {
      const user = req.user as JwtUser;
      const tid = resolveTenantId(req, reply, user);
      if (!tid) return;
      const examId = (req.params as { examId: string }).examId;
      const body = RosterBulk.parse(req.body);
      const exam = await Exam.findOne({ _id: examId, tenantId: tid }).lean();
      if (!exam) return reply.code(404).send({ error: "Exam not found" });

      const results = await Promise.all(
        body.entries.map(async (e) => {
          const filter: any = { tenantId: tid };
          if (e.studentId) filter._id = e.studentId;
          else if (e.matricNo) filter.matricNo = e.matricNo;
          else return null;

          const st = await Student.findOne(filter).lean();
          if (!st) return null;

          return ExamRosterEntry.findOneAndUpdate(
            { examId, studentId: st._id },
            { $set: { examId, studentId: st._id, hallLabel: e.hallLabel } },
            { upsert: true, new: true }
          );
        })
      );

      const successful = results.filter(Boolean).length;
      return { ok: true, count: successful, total: body.entries.length };
    }
  );

  app.delete(
    "/exams/:examId",
    {
      onRequest: [
        app.authenticate,
        requireRole([Role.SUPER_ADMIN, Role.TENANT_ADMIN, Role.ENROLLER]),
      ],
    },
    async (req, reply) => {
      const user = req.user as JwtUser;
      const tid = resolveTenantId(req, reply, user);
      if (!tid) return;
      const examId = (req.params as { examId: string }).examId;
      const exam = await Exam.findOneAndDelete({ _id: examId, tenantId: tid });
      if (!exam) return reply.code(404).send({ error: "Exam not found" });
      // Delete roster entries too
      await ExamRosterEntry.deleteMany({ examId });
      return { ok: true };
    }
  );

  app.patch(
    "/exams/:examId",
    {
      onRequest: [
        app.authenticate,
        requireRole([Role.SUPER_ADMIN, Role.TENANT_ADMIN, Role.ENROLLER]),
      ],
    },
    async (req, reply) => {
      const user = req.user as JwtUser;
      const tid = resolveTenantId(req, reply, user);
      if (!tid) return;
      const examId = (req.params as { examId: string }).examId;
      const body = PatchExam.parse(req.body);
      if (body.courseId) {
        const course = await Course.findOne({ _id: body.courseId, tenantId: tid }).lean();
        if (!course) return reply.code(400).send({ error: "Course not found" });
      }
      const existing = await Exam.findOne({ _id: examId, tenantId: tid }).lean<ExamLean | null>();
      if (!existing) return reply.code(404).send({ error: "Exam not found" });
      const updates: Record<string, unknown> = {};
      if (body.title !== undefined) updates.title = body.title;
      if (body.courseId !== undefined) updates.courseId = body.courseId;
      if (body.semester !== undefined) updates.semester = body.semester;
      if (body.startsAt !== undefined) updates.startsAt = body.startsAt ? new Date(body.startsAt) : null;
      if (body.endsAt !== undefined) updates.endsAt = body.endsAt ? new Date(body.endsAt) : null;
      if (body.academicSessionId !== undefined) updates.academicSessionId = body.academicSessionId;
      if (body.academicYear !== undefined || body.academicSessionId !== undefined) {
        const y = await resolveAcademicYearLabel(
          tid,
          body.academicSessionId !== undefined ? body.academicSessionId : existing.academicSessionId,
          body.academicYear !== undefined ? body.academicYear : existing.academicYear
        );
        if (y) updates.academicYear = y;
      }
      const exam = await Exam.findOneAndUpdate({ _id: examId, tenantId: tid }, { $set: updates }, { new: true }).lean<ExamLean | null>();
      if (!exam) return reply.code(404).send({ error: "Exam not found" });
      return withId(exam);
    }
  );
}
