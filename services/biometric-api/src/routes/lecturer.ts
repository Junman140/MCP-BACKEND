import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Role } from "../models/roles.js";
import { User, LecturerProfile, Course, CourseRegistration, Student, Notification } from "../models/schemas.js";
import { requireRole, hashPassword } from "../lib/auth.js";
import { resolveTenantId, type JwtUser } from "../lib/tenantScope.js";
import { withId, withIds } from "../lib/serialize.js";
import crypto from "node:crypto";

const RegisterBody = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  staffId: z.string().min(1),
  title: z.string().optional(),
  fullName: z.string().min(1),
  phone: z.string().optional(),
  departmentId: z.string().optional(),
  qualifications: z.array(z.string()).optional(),
  specializations: z.array(z.string()).optional(),
  employmentType: z.enum(["full-time", "part-time", "adjunct"]).optional(),
  courseIds: z.array(z.string()).optional(),
});

const AssignBody = z.object({ courseIds: z.array(z.string()) });

function lecturerCoursesGuard(reply: any, courseIds: string[], requestedId?: string) {
  if (requestedId && !courseIds.includes(requestedId)) {
    return reply.code(403).send({ error: "You are not assigned to this course" });
  }
}

export async function lecturerRoutes(app: FastifyInstance) {
  // ── Admin: register a new lecturer (creates User + LecturerProfile) ──
  app.post(
    "/lecturer/register",
    { onRequest: [app.authenticate, requireRole([Role.SUPER_ADMIN, Role.TENANT_ADMIN])] },
    async (req, reply) => {
      const user = req.user as JwtUser;
      const tid = resolveTenantId(req, reply, user);
      if (!tid) return;
      const body = RegisterBody.parse(req.body);

      const existing = await User.findOne({ email: body.email });
      if (existing) return reply.code(409).send({ error: "Email already registered" });

      const pwHash = await hashPassword(body.password);
      const newUser = await User.create({
        tenantId: tid,
        email: body.email,
        passwordHash: pwHash,
        role: Role.LECTURER,
        displayName: body.fullName,
      });

      const profile = await LecturerProfile.create({
        tenantId: tid,
        userId: newUser._id,
        staffId: body.staffId,
        title: body.title ?? null,
        fullName: body.fullName,
        email: body.email,
        phone: body.phone ?? null,
        departmentId: body.departmentId ?? null,
        qualifications: body.qualifications ?? [],
        specializations: body.specializations ?? [],
        employmentType: body.employmentType ?? "full-time",
      });

      if (body.courseIds?.length) {
        await Course.updateMany(
          { _id: { $in: body.courseIds }, tenantId: tid },
          { $addToSet: { lecturerIds: profile._id } }
        );
      }

      return reply.code(201).send({
        user: withId(newUser.toObject() as { _id: string }),
        profile: withId(profile.toObject() as { _id: string }),
      });
    }
  );

  // ── Lecturer: get own profile with assigned courses ──
  app.get(
    "/lecturer/me",
    { onRequest: [app.authenticate, app.resolveLecturer, requireRole([Role.LECTURER])] },
    async (req, reply) => {
      const lecturer = req.lecturer!;
      const profile = await LecturerProfile.findById(lecturer.profileId).lean();
      if (!profile) return reply.code(404).send({ error: "Profile not found" });

      const courses = lecturer.courseIds.length
        ? await Course.find({ _id: { $in: lecturer.courseIds } }).sort({ code: 1 }).lean()
        : [];

      return {
        profile: withId(profile as { _id: string }),
        courses: withIds(courses as { _id: string }[]),
      };
    }
  );

  // ── Lecturer: update own profile ──
  const UpdateProfileBody = z.object({
    title: z.string().optional(),
    phone: z.string().optional(),
    qualifications: z.array(z.string()).optional(),
    specializations: z.array(z.string()).optional(),
    photoUrl: z.string().optional(),
    officeHours: z.array(z.object({
      dayOfWeek: z.enum(["mon","tue","wed","thu","fri","sat","sun"]),
      startTime: z.string(),
      endTime: z.string(),
      location: z.string(),
    })).optional(),
  });

  app.patch(
    "/lecturer/me",
    { onRequest: [app.authenticate, app.resolveLecturer, requireRole([Role.LECTURER])] },
    async (req, reply) => {
      const lecturer = req.lecturer!;
      const body = UpdateProfileBody.parse(req.body);
      const updates: Record<string, unknown> = {};
      if (body.title !== undefined) updates.title = body.title;
      if (body.phone !== undefined) updates.phone = body.phone;
      if (body.qualifications !== undefined) updates.qualifications = body.qualifications;
      if (body.specializations !== undefined) updates.specializations = body.specializations;
      if (body.photoUrl !== undefined) updates.photoUrl = body.photoUrl;
      if (body.officeHours !== undefined) updates.officeHours = body.officeHours;
      const p = await LecturerProfile.findByIdAndUpdate(lecturer.profileId, { $set: updates }, { new: true }).lean();
      if (!p) return reply.code(404).send({ error: "Profile not found" });
      return withId(p as { _id: string });
    }
  );

  // ── Lecturer: list my assigned courses (auto-scoped) ──
  app.get(
    "/lecturer/courses",
    { onRequest: [app.authenticate, app.resolveLecturer, requireRole([Role.LECTURER])] },
    async (req) => {
      const lecturer = req.lecturer!;
      if (!lecturer.courseIds.length) return [];
      const courses = await Course.find({ _id: { $in: lecturer.courseIds } }).sort({ code: 1 }).lean();
      return withIds(courses as { _id: string }[]);
    }
  );

  // ── Lecturer: get course detail (must be assigned) ──
  app.get(
    "/lecturer/courses/:id",
    { onRequest: [app.authenticate, app.resolveLecturer, requireRole([Role.LECTURER])] },
    async (req, reply) => {
      const lecturer = req.lecturer!;
      const params = req.params as { id: string };
      lecturerCoursesGuard(reply, lecturer.courseIds, params.id);
      if (reply.sent) return;

      const course = await Course.findById(params.id).lean();
      if (!course) return reply.code(404).send({ error: "Course not found" });
      return withId(course as { _id: string });
    }
  );

  // ── Lecturer: students enrolled in my course ──
  app.get(
    "/lecturer/courses/:id/students",
    { onRequest: [app.authenticate, app.resolveLecturer, requireRole([Role.LECTURER])] },
    async (req, reply) => {
      const lecturer = req.lecturer!;
      const params = req.params as { id: string };
      lecturerCoursesGuard(reply, lecturer.courseIds, params.id);
      if (reply.sent) return;

      const regs = await CourseRegistration.find({ courseId: params.id }).select("studentId").lean();
      const studentIds = regs.map((r) => r.studentId);
      if (!studentIds.length) return [];
      const students = await Student.find({ _id: { $in: studentIds } }).sort({ fullName: 1 }).lean();
      return withIds(students as { _id: string }[]);
    }
  );

  // ── Admin: assign/unassign courses to a lecturer ──
  app.patch(
    "/lecturer/:profileId/courses",
    { onRequest: [app.authenticate, requireRole([Role.SUPER_ADMIN, Role.TENANT_ADMIN])] },
    async (req, reply) => {
      const user = req.user as JwtUser;
      const tid = resolveTenantId(req, reply, user);
      if (!tid) return;
      const params = req.params as { profileId: string };
      const body = AssignBody.parse(req.body);

      const profile = await LecturerProfile.findOne({ _id: params.profileId, tenantId: tid });
      if (!profile) return reply.code(404).send({ error: "Lecturer profile not found" });

      const validCourses = await Course.find({ _id: { $in: body.courseIds }, tenantId: tid })
        .select("_id")
        .lean();
      const validIds = validCourses.map((c) => c._id as string);

      await Course.updateMany(
        { lecturerIds: profile._id, tenantId: tid },
        { $pull: { lecturerIds: profile._id } }
      );

      if (validIds.length) {
        await Course.updateMany(
          { _id: { $in: validIds }, tenantId: tid },
          { $addToSet: { lecturerIds: profile._id } }
        );
      }

      return { assignedCourseIds: validIds };
    }
  );

  // ── Lecturer: dashboard / workload summary ──
  app.get(
    "/lecturer/dashboard",
    { onRequest: [app.authenticate, app.resolveLecturer, requireRole([Role.LECTURER])] },
    async (req) => {
      const lecturer = req.lecturer!;
      if (!lecturer.courseIds.length) {
        return { courseCount: 0, totalStudents: 0, courses: [] };
      }

      const courses = await Course.find({ _id: { $in: lecturer.courseIds } }).lean();

      const courseSummaries = await Promise.all(
        courses.map(async (c) => {
          const studentCount = await CourseRegistration.countDocuments({ courseId: c._id });
          return {
            id: c._id,
            code: c.code,
            title: c.title,
            studentCount,
          };
        })
      );

      const totalStudents = courseSummaries.reduce((sum, c) => sum + c.studentCount, 0);

      return {
        courseCount: courses.length,
        totalStudents,
        courses: courseSummaries,
      };
    }
  );

  // ── Lecturer: post announcement to assigned course ──
  app.post(
    "/lecturer/courses/:id/announcements",
    { onRequest: [app.authenticate, app.resolveLecturer, requireRole([Role.LECTURER])] },
    async (req, reply) => {
      const lecturer = req.lecturer!;
      const params = req.params as { id: string };
      const body = req.body as { title?: string; message?: string };
      lecturerCoursesGuard(reply, lecturer.courseIds, params.id);
      if (reply.sent) return;
      if (!body.title || !body.message) {
        return reply.code(400).send({ error: "title and message are required" });
      }

      const tid = (req.user as JwtUser).tenantId;
      const regs = await CourseRegistration.find({ courseId: params.id }).select("studentId").lean();
      const studentIds = regs.map((r) => r.studentId);

      const notifications = studentIds.map((sid) => ({
        _id: crypto.randomUUID(),
        tenantId: tid,
        recipientId: sid,
        type: "INAPP" as const,
        title: `[${body.title}]`,
        message: body.message!,
      }));

      if (notifications.length) {
        await Notification.insertMany(notifications);
      }

      return reply.code(201).send({ notifiedCount: notifications.length });
    }
  );

  // ── Admin: list all lecturers ──
  app.get(
    "/lecturers",
    { onRequest: [app.authenticate, requireRole([Role.SUPER_ADMIN, Role.TENANT_ADMIN])] },
    async (req, reply) => {
      const user = req.user as JwtUser;
      const tid = resolveTenantId(req, reply, user);
      if (!tid) return;
      const profiles = await LecturerProfile.find({ tenantId: tid })
        .lean<Record<string, any>[]>();
      return withIds(profiles as { _id: string }[]);
    }
  );

  // ── Admin: delete a lecturer ──
  app.delete(
    "/lecturer/:profileId",
    { onRequest: [app.authenticate, requireRole([Role.SUPER_ADMIN, Role.TENANT_ADMIN])] },
    async (req, reply) => {
      const user = req.user as JwtUser;
      const tid = resolveTenantId(req, reply, user);
      if (!tid) return;
      const id = (req.params as { profileId: string }).profileId;
      const profile = await LecturerProfile.findOne({ _id: id, tenantId: tid });
      if (!profile) return reply.code(404).send({ error: "Not found" });

      // Remove lecturer from all courses
      await Course.updateMany(
        { lecturerIds: profile._id, tenantId: tid },
        { $pull: { lecturerIds: profile._id } }
      );

      // Deactivate the User account
      if (profile.userId) {
        await User.updateOne({ _id: profile.userId }, { $set: { role: "VIEWER" } });
      }

      profile.isActive = false;
      await profile.save();

      return { ok: true };
    }
  );

  // ── Admin: update lecturer profile (department, staffId, position, courses) ──
  const AdminUpdateBody = z.object({
    staffId: z.string().optional(),
    title: z.string().optional(),
    fullName: z.string().optional(),
    phone: z.string().optional(),
    departmentId: z.string().optional(),
    qualifications: z.array(z.string()).optional(),
    specializations: z.array(z.string()).optional(),
    employmentType: z.enum(["full-time", "part-time", "adjunct"]).optional(),
    courseIds: z.array(z.string()).optional(),
  });

  app.patch(
    "/lecturer/:profileId",
    { onRequest: [app.authenticate, requireRole([Role.SUPER_ADMIN, Role.TENANT_ADMIN])] },
    async (req, reply) => {
      const user = req.user as JwtUser;
      const tid = resolveTenantId(req, reply, user);
      if (!tid) return;
      const id = (req.params as { profileId: string }).profileId;
      const body = AdminUpdateBody.parse(req.body);

      const updates: Record<string, unknown> = {};
      if (body.staffId !== undefined) updates.staffId = body.staffId;
      if (body.title !== undefined) updates.title = body.title;
      if (body.fullName !== undefined) updates.fullName = body.fullName;
      if (body.phone !== undefined) updates.phone = body.phone;
      if (body.departmentId !== undefined) updates.departmentId = body.departmentId;
      if (body.qualifications !== undefined) updates.qualifications = body.qualifications;
      if (body.specializations !== undefined) updates.specializations = body.specializations;
      if (body.employmentType !== undefined) updates.employmentType = body.employmentType;

      if (Object.keys(updates).length > 0) {
        await LecturerProfile.updateOne({ _id: id, tenantId: tid }, { $set: updates });
      }

      // Update course assignments if provided
      if (body.courseIds !== undefined) {
        await Course.updateMany(
          { lecturerIds: id, tenantId: tid },
          { $pull: { lecturerIds: id } }
        );
        if (body.courseIds.length > 0) {
          await Course.updateMany(
            { _id: { $in: body.courseIds }, tenantId: tid },
            { $addToSet: { lecturerIds: id } }
          );
        }
      }

      const profile = await LecturerProfile.findOne({ _id: id, tenantId: tid }).lean<Record<string, any>>();
      if (!profile) return reply.code(404).send({ error: "Not found" });
      return withId(profile as { _id: string });
    }
  );
}
