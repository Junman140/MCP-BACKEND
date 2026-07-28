import type { FastifyInstance } from "fastify";
import { Role } from "../models/roles.js";
import {
  Course,
  CourseRegistration,
  Notification,
  Student,
  Exam,
} from "../models/schemas.js";
import { resolveTenantId, type JwtUser } from "../lib/tenantScope.js";

interface CourseLean {
  _id: string;
  code: string;
  title: string;
}

interface NotificationLean {
  _id: string;
  title: string;
  message: string;
}

interface StudentLean {
  _id: string;
  matricNo: string;
}

async function buildDashboard(tid: string, effectiveStudentId: string) {
  const registrations = await CourseRegistration.find({
    tenantId: tid,
    studentId: effectiveStudentId,
  }).select("courseId").lean();

  const courseIds = registrations.map((r) => r.courseId);
  let enrolledCourses: { id: string; code: string; title: string }[] = [];

  if (courseIds.length > 0) {
    const courses = await Course.find({ _id: { $in: courseIds }, tenantId: tid })
      .select("code title").lean<CourseLean[]>();
    enrolledCourses = courses.map((c) => ({ id: c._id, code: c.code, title: c.title }));
  }

  const notifications = await Notification.find({ tenantId: tid, type: "INAPP" })
    .sort({ createdAt: -1 }).limit(5).lean<NotificationLean[]>();
  const recentAnnouncements = notifications.map((n) => ({ id: n._id, title: n.title, content: n.message }));

  const now = new Date();
  const upcomingExams = await Exam.find({ tenantId: tid, endsAt: { $gte: now } })
    .sort({ startsAt: 1 }).limit(5).lean();
  const upcomingDeadlines = upcomingExams.map((e: any) => ({
    title: e.title ?? "",
    deadline: e.endsAt?.toISOString() ?? "",
  }));

  return { enrolledCourses, gpa: 0, totalCourses: enrolledCourses.length, recentAnnouncements, upcomingDeadlines };
}

export async function studentDashboardRoutes(app: FastifyInstance) {
  app.get("/student/dashboard", { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as JwtUser;
    const tid = resolveTenantId(req, reply, user);
    if (!tid) return;

    const queryId = (req.query as { studentId?: string }).studentId;
    if (queryId && user.role !== Role.STUDENT) {
      const s = await Student.findOne({ _id: queryId, tenantId: tid }).lean<StudentLean | null>();
      return buildDashboard(tid, s?._id ?? queryId);
    }

    const s = await Student.findOne({
      $or: [{ _id: user.sub, tenantId: tid }, { userId: user.sub, tenantId: tid }, { matricNo: user.sub, tenantId: tid }],
    }).lean<StudentLean | null>();

    if (!s) return { enrolledCourses: [], gpa: 0, totalCourses: 0, recentAnnouncements: [], upcomingDeadlines: [] };
    return buildDashboard(tid, s._id);
  });
}
