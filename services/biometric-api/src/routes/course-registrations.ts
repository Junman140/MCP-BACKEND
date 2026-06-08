import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Role } from "../models/roles.js";
import { Course, CourseRegistration, Student } from "../models/schemas.js";
import { requireRole } from "../lib/auth.js";
import { resolveTenantId, type JwtUser } from "../lib/tenantScope.js";
import { withId, withIds } from "../lib/serialize.js";
import { resolveAcademicYearLabel } from "../lib/resolveAcademicYear.js";

const CreateReg = z
  .object({
    studentId: z.string().min(1),
    courseId: z.string().min(1),
    academicSessionId: z.string().optional(),
    academicYear: z.string().optional(),
    semester: z.coerce.number().int().min(1).max(2),
  })
  .refine((d) => d.academicSessionId || (d.academicYear && d.academicYear.trim().length > 0), {
    message: "Provide academicSessionId or academicYear",
  });

export async function courseRegistrationRoutes(app: FastifyInstance) {
  app.get(
    "/course-registrations",
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
      const studentId = (req.query as { studentId?: string }).studentId?.trim();
      const filter: Record<string, unknown> = { tenantId: tid };
      if (studentId) filter.studentId = studentId;
      const rows = await CourseRegistration.find(filter).sort({ academicYear: -1, semester: -1 }).limit(500).lean();
      return withIds(rows as { _id: string }[]);
    }
  );

  app.post(
    "/course-registrations",
    {
      onRequest: [app.authenticate, requireRole([Role.SUPER_ADMIN, Role.TENANT_ADMIN, Role.ENROLLER])],
    },
    async (req, reply) => {
      const user = req.user as JwtUser;
      const tid = resolveTenantId(req, reply, user);
      if (!tid) return;
      const body = CreateReg.parse(req.body);
      const [st, co] = await Promise.all([
        Student.findOne({ _id: body.studentId, tenantId: tid }).lean(),
        Course.findOne({ _id: body.courseId, tenantId: tid }).lean(),
      ]);
      if (!st) return reply.code(400).send({ error: "Student not found" });
      if (!co) return reply.code(400).send({ error: "Course not found" });
      const academicYear = await resolveAcademicYearLabel(tid, body.academicSessionId, body.academicYear ?? null);
      if (!academicYear) return reply.code(400).send({ error: "Invalid or missing academic session" });
      try {
        const r = await CourseRegistration.create({
          tenantId: tid,
          studentId: body.studentId,
          courseId: body.courseId,
          academicSessionId: body.academicSessionId ?? null,
          academicYear,
          semester: body.semester,
        });
        return withId(r.toObject() as { _id: string });
      } catch (e: unknown) {
        if ((e as { code?: number }).code === 11000) {
          return reply.code(409).send({ error: "Registration already exists for this student, course, year, semester" });
        }
        throw e;
      }
    }
  );

  app.delete(
    "/course-registrations/:id",
    {
      onRequest: [app.authenticate, requireRole([Role.SUPER_ADMIN, Role.TENANT_ADMIN, Role.ENROLLER])],
    },
    async (req, reply) => {
      const user = req.user as JwtUser;
      const tid = resolveTenantId(req, reply, user);
      if (!tid) return;
      const id = (req.params as { id: string }).id;
      const r = await CourseRegistration.deleteOne({ _id: id, tenantId: tid });
      if (r.deletedCount === 0) return reply.code(404).send({ error: "Not found" });
      return { ok: true };
    }
  );
}
