import type { FastifyInstance } from "fastify";
import { Role } from "../models/roles.js";
import { StudentProgress, GradeEntry, CourseRegistration, Course } from "../models/schemas.js";
import { requireRole } from "../lib/auth.js";
import { resolveTenantId, type JwtUser } from "../lib/tenantScope.js";

const readRoles = [Role.SUPER_ADMIN, Role.TENANT_ADMIN, Role.LECTURER];

export async function lmsAnalyticsRoutes(app: FastifyInstance) {
  // At-risk students: those with <40% progress in any course
  app.get("/analytics/at-risk", { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as JwtUser;
    const tid = resolveTenantId(req, reply, user);
    if (!tid) return;
    const atRisk = await StudentProgress.find({ tenantId: tid, completionPercentage: { $lt: 40 } })
      .sort({ completionPercentage: 1 }).limit(50).lean();
    return atRisk;
  });

  // Engagement per course: registration count vs progress
  app.get("/analytics/engagement/:courseId", { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as JwtUser;
    const tid = resolveTenantId(req, reply, user);
    if (!tid) return;
    const courseId = (req.params as { courseId: string }).courseId;
    const totalEnrolled = await CourseRegistration.countDocuments({ courseId, tenantId: tid });
    const active = await StudentProgress.countDocuments({ courseId, tenantId: tid, completionPercentage: { $gt: 0 } });
    const completed = await StudentProgress.countDocuments({ courseId, tenantId: tid, completionPercentage: 100 });
    return { courseId, totalEnrolled, activeStudents: active, completedStudents: completed, engagementRate: totalEnrolled > 0 ? Math.round((active / totalEnrolled) * 100) : 0 };
  });

  // Grade distribution per course
  app.get("/analytics/grade-distribution/:courseId", { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as JwtUser;
    const tid = resolveTenantId(req, reply, user);
    if (!tid) return;
    const courseId = (req.params as { courseId: string }).courseId;
    const grades = await GradeEntry.find({ courseId, tenantId: tid }).lean();
    const buckets: Record<string, number> = { "A (≥70)": 0, "B (60-69)": 0, "C (50-59)": 0, "D (40-49)": 0, "F (<40)": 0 };
    for (const g of grades) {
      const pct = g.maxScore > 0 ? (g.score / g.maxScore) * 100 : 0;
      if (pct >= 70) buckets["A (≥70)"]++;
      else if (pct >= 60) buckets["B (60-69)"]++;
      else if (pct >= 50) buckets["C (50-59)"]++;
      else if (pct >= 40) buckets["D (40-49)"]++;
      else buckets["F (<40)"]++;
    }
    return { courseId, totalGrades: grades.length, distribution: buckets };
  });
}
