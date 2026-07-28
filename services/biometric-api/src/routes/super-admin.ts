import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Role } from "../models/roles.js";
import { Tenant, User, Student, LecturerProfile, Course, CourseRegistration, VerificationEvent } from "../models/schemas.js";
import { requireRole, hashPassword } from "../lib/auth.js";
import type { JwtUser } from "../lib/tenantScope.js";

export async function superAdminRoutes(app: FastifyInstance) {
  // ── Superadmin: cumulative dashboard ──
  app.get(
    "/super/dashboard",
    { onRequest: [app.authenticate, requireRole([Role.SUPER_ADMIN])] },
    async () => {
      const tenants = await Tenant.find({}).lean() as Record<string, any>[];
      const summaries = await Promise.all(
        tenants.map(async (t) => {
          const tid = t._id as string;
          const [students, lecturers, courses, verifications] = await Promise.all([
            Student.countDocuments({ tenantId: tid }),
            LecturerProfile.countDocuments({ tenantId: tid, isActive: true }),
            Course.countDocuments({ tenantId: tid }),
            VerificationEvent.countDocuments({ tenantId: tid }),
          ]);
          return {
            id: tid,
            name: t.name,
            slug: t.slug,
            students,
            lecturers,
            courses,
            verifications,
            createdAt: t.createdAt,
          };
        })
      );

      const totalStudents = summaries.reduce((s, t) => s + t.students, 0);
      const totalLecturers = summaries.reduce((s, t) => s + t.lecturers, 0);
      const totalCourses = summaries.reduce((s, t) => s + t.courses, 0);
      const totalTenants = tenants.length;

      return { totalTenants, totalStudents, totalLecturers, totalCourses, tenants: summaries };
    }
  );

  // ── Superadmin: list all tenants ──
  app.get(
    "/super/tenants",
    { onRequest: [app.authenticate, requireRole([Role.SUPER_ADMIN])] },
    async () => {
      const tenants = await Tenant.find({}).lean() as Record<string, any>[];
      return await Promise.all(
        tenants.map(async (t) => {
          const tid = t._id as string;
          const [students, lecturers, courses] = await Promise.all([
            Student.countDocuments({ tenantId: tid }),
            LecturerProfile.countDocuments({ tenantId: tid }),
            Course.countDocuments({ tenantId: tid }),
          ]);
          return { id: tid, name: t.name, slug: t.slug, students, lecturers, courses, createdAt: t.createdAt };
        })
      );
    }
  );

  // ── Superadmin: tenant stats ──
  app.get(
    "/super/tenants/:id/stats",
    { onRequest: [app.authenticate, requireRole([Role.SUPER_ADMIN])] },
    async (req, reply) => {
      const tid = (req.params as { id: string }).id;
      const tenant = await Tenant.findById(tid).lean() as Record<string, any> | null;
      if (!tenant) return reply.code(404).send({ error: "Tenant not found" });

      const [students, lecturers, courses, registrations, verifications] = await Promise.all([
        Student.countDocuments({ tenantId: tid }),
        LecturerProfile.countDocuments({ tenantId: tid }),
        Course.countDocuments({ tenantId: tid }),
        CourseRegistration.countDocuments({ tenantId: tid }),
        VerificationEvent.countDocuments({ tenantId: tid }),
      ]);

      const admins = await User.find({ tenantId: tid, role: "TENANT_ADMIN" }, { email: 1, displayName: 1 }).lean() as Record<string, any>[];

      return {
        id: tenant._id,
        name: (tenant as any).name,
        slug: (tenant as any).slug,
        createdAt: (tenant as any).createdAt,
        students,
        lecturers,
        courses,
        registrations,
        verifications,
        admins,
      };
    }
  );

  // ── Superadmin: delete school + all its data ──
  app.delete(
    "/super/tenants/:id",
    { onRequest: [app.authenticate, requireRole([Role.SUPER_ADMIN])] },
    async (req, reply) => {
      const tid = (req.params as { id: string }).id;
      const tenant = await Tenant.findById(tid);
      if (!tenant) return reply.code(404).send({ error: "Tenant not found" });

      const collections = [
        "users", "students", "lecturer_profiles", "faculties", "departments",
        "courses", "course_registrations", "academic_sessions", "exams",
        "exam_roster_entries", "biometric_enrollments", "devices",
        "verification_events", "notifications", "audit_logs",
        "course_modules", "content_items", "lms_assignments", "lms_quizzes",
        "quiz_attempts", "grade_entries", "attendance_sessions",
        "attendance_records", "discussion_forums", "discussion_posts",
        "announcements", "messages", "timetable_entries", "student_progress",
      ];

      for (const col of collections) {
        await (Tenant.db?.collection(col).deleteMany({ tenantId: tid }));
      }

      await Tenant.deleteOne({ _id: tid });
      return { ok: true, deleted: (tenant as any).name };
    }
  );

  // ── Superadmin: reset school admin password ──
  const ResetBody = z.object({ email: z.string().email(), newPassword: z.string().min(8) });

  app.post(
    "/super/tenants/:id/reset-password",
    { onRequest: [app.authenticate, requireRole([Role.SUPER_ADMIN])] },
    async (req, reply) => {
      const tid = (req.params as { id: string }).id;
      const body = ResetBody.parse(req.body);

      const user = await User.findOne({ tenantId: tid, email: body.email, role: "TENANT_ADMIN" });
      if (!user) return reply.code(404).send({ error: "School admin not found" });

      user.passwordHash = await hashPassword(body.newPassword);
      await user.save();
      return { ok: true };
    }
  );
}
