import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Role } from "../models/roles.js";
import type { CourseLean } from "../models/lean.js";
import { Course } from "../models/schemas.js";
import { requireRole } from "../lib/auth.js";
import { resolveTenantId, type JwtUser } from "../lib/tenantScope.js";
import { withId, withIds } from "../lib/serialize.js";

const CreateCourse = z.object({
  code: z.string().min(1),
  title: z.string().min(1),
  courseType: z.enum(["general", "departmental", "faculty"]).optional(),
  facultyId: z.string().optional(),
  departmentIds: z.array(z.string()).optional(),
  semester: z.number().min(1).max(2).optional(),
  level: z.string().optional(),
  creditUnits: z.number().optional(),
  lecturerIds: z.array(z.string()).optional(),
  faculty: z.string().optional(),
  department: z.string().optional(),
});

const PatchCourse = CreateCourse.partial();

export async function courseRoutes(app: FastifyInstance) {
  app.get(
    "/courses",
    {
      onRequest: [
        app.authenticate,
        requireRole([
          Role.SUPER_ADMIN,
          Role.TENANT_ADMIN,
          Role.ENROLLER,
          Role.INVIGILATOR,
          Role.VIEWER,
          Role.LECTURER,
          Role.STUDENT,
        ]),
      ],
    },
    async (req, reply) => {
      const user = req.user as JwtUser;
      const tid = resolveTenantId(req, reply, user);
      if (!tid) return;

      const q = (req.query as Record<string, string | undefined>) || {};
      const filter: Record<string, unknown> = { tenantId: tid };

      if (q.facultyId) filter.facultyId = q.facultyId;
      if (q.departmentId) filter.departmentIds = q.departmentId;
      if (q.semester) filter.semester = parseInt(q.semester, 10);
      if (q.courseType) filter.courseType = q.courseType;
      if (q.level) filter.level = q.level;
      if (q.search) {
        filter.$or = [
          { code: { $regex: q.search, $options: "i" } },
          { title: { $regex: q.search, $options: "i" } },
        ];
      }

      const page = Math.max(1, parseInt(q.page || "1", 10) || 1);
      const limit = Math.min(500, Math.max(1, parseInt(q.limit || "100", 10) || 100));
      const skip = (page - 1) * limit;

      const [rows, total] = await Promise.all([
        Course.find(filter)
          .sort({ semester: 1, courseType: 1, code: 1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        Course.countDocuments(filter),
      ]);

      return { data: withIds(rows as { _id: string }[]), total, page, limit };
    }
  );

  app.post(
    "/courses",
    {
      onRequest: [app.authenticate, requireRole([Role.SUPER_ADMIN, Role.TENANT_ADMIN, Role.ENROLLER])],
    },
    async (req, reply) => {
      const user = req.user as JwtUser;
      const tid = resolveTenantId(req, reply, user);
      if (!tid) return;
      const body = CreateCourse.parse(req.body);
      try {
        const c = await Course.create({
          tenantId: tid,
          code: body.code.trim(),
          title: body.title.trim(),
          courseType: body.courseType ?? "departmental",
          facultyId: body.facultyId ?? null,
          departmentIds: body.departmentIds ?? [],
          semester: body.semester ?? 1,
          level: body.level ?? null,
          creditUnits: body.creditUnits ?? 3,
          lecturerIds: body.lecturerIds ?? [],
          faculty: body.faculty,
          department: body.department,
        });
        return reply.code(201).send(withId(c.toObject() as { _id: string }));
      } catch (e: unknown) {
        if ((e as { code?: number }).code === 11000) {
          return reply.code(409).send({ error: "Course code already exists" });
        }
        throw e;
      }
    }
  );

  app.patch(
    "/courses/:id",
    {
      onRequest: [app.authenticate, requireRole([Role.SUPER_ADMIN, Role.TENANT_ADMIN, Role.ENROLLER])],
    },
    async (req, reply) => {
      const user = req.user as JwtUser;
      const tid = resolveTenantId(req, reply, user);
      if (!tid) return;
      const id = (req.params as { id: string }).id;
      const body = PatchCourse.parse(req.body);
      const updates: Record<string, unknown> = {};
      if (body.code !== undefined) updates.code = body.code.trim();
      if (body.title !== undefined) updates.title = body.title.trim();
      if (body.courseType !== undefined) updates.courseType = body.courseType;
      if (body.facultyId !== undefined) updates.facultyId = body.facultyId;
      if (body.departmentIds !== undefined) updates.departmentIds = body.departmentIds;
      if (body.semester !== undefined) updates.semester = body.semester;
      if (body.level !== undefined) updates.level = body.level;
      if (body.creditUnits !== undefined) updates.creditUnits = body.creditUnits;
      if (body.lecturerIds !== undefined) updates.lecturerIds = body.lecturerIds;
      if (body.faculty !== undefined) updates.faculty = body.faculty;
      if (body.department !== undefined) updates.department = body.department;
      const c = await Course.findOneAndUpdate(
        { _id: id, tenantId: tid },
        { $set: updates },
        { new: true }
      ).lean<CourseLean | null>();
      if (!c) return reply.code(404).send({ error: "Not found" });
      return withId(c);
    }
  );

  app.delete(
    "/courses/:id",
    {
      onRequest: [app.authenticate, requireRole([Role.SUPER_ADMIN, Role.TENANT_ADMIN])],
    },
    async (req, reply) => {
      const user = req.user as JwtUser;
      const tid = resolveTenantId(req, reply, user);
      if (!tid) return;
      const id = (req.params as { id: string }).id;
      const r = await Course.deleteOne({ _id: id, tenantId: tid });
      if (r.deletedCount === 0) return reply.code(404).send({ error: "Not found" });
      return { ok: true };
    }
  );
}
