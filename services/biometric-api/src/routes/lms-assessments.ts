import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Role } from "../models/roles.js";
import { Assignment, Quiz, QuizAttempt } from "../models/schemas.js";
import { requireRole } from "../lib/auth.js";
import { resolveTenantId, type JwtUser } from "../lib/tenantScope.js";
import { withId, withIds } from "../lib/serialize.js";

const AssignmentBody = z.object({ courseId: z.string().optional(), title: z.string().min(1), description: z.string().optional(), dueDate: z.string().optional(), maxScore: z.number().optional(), allowLateSubmission: z.boolean().optional(), attachments: z.array(z.string()).optional() });
const QuizBody = z.object({ courseId: z.string().optional(), title: z.string().min(1), description: z.string().optional(), timeLimitMinutes: z.number().optional(), maxScore: z.number().optional(), questions: z.array(z.object({ text: z.string().optional(), type: z.enum(["multiple-choice","true-false","short-answer"]), options: z.array(z.string()).optional(), correctAnswer: z.string().optional(), points: z.number().optional() })).optional(), isPublished: z.boolean().optional() });
const QuizSubmitBody = z.object({ answers: z.record(z.string()) });

const readRoles = [Role.SUPER_ADMIN, Role.TENANT_ADMIN, Role.ENROLLER, Role.LECTURER, Role.VIEWER, Role.INVIGILATOR];
const writeRoles = [Role.SUPER_ADMIN, Role.TENANT_ADMIN, Role.LECTURER];

export async function lmsAssessmentsRoutes(app: FastifyInstance) {
  // ── Assignments ──
  app.get("/assignments", { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as JwtUser;
    const tid = resolveTenantId(req, reply, user);
    if (!tid) return;
    const filter: Record<string, unknown> = { tenantId: tid };
    const courseId = (req.query as { courseId?: string }).courseId;
    if (courseId) filter.courseId = courseId;
    const rows = await Assignment.find(filter).sort({ createdAt: -1 }).lean();
    return withIds(rows as { _id: string }[]);
  });

  app.post("/assignments", { onRequest: [app.authenticate, requireRole(writeRoles)] }, async (req, reply) => {
    const user = req.user as JwtUser;
    const tid = resolveTenantId(req, reply, user);
    if (!tid) return;
    const body = AssignmentBody.parse(req.body);
    const a = await Assignment.create({ ...body, courseId: body.courseId ?? (req.query as { courseId?: string }).courseId, tenantId: tid, dueDate: body.dueDate ? new Date(body.dueDate) : undefined });
    return withId(a.toObject() as { _id: string });
  });

  app.delete("/assignments/:id", { onRequest: [app.authenticate, requireRole(writeRoles)] }, async (req, reply) => {
    const user = req.user as JwtUser;
    const tid = resolveTenantId(req, reply, user);
    if (!tid) return;
    const r = await Assignment.deleteOne({ _id: (req.params as { id: string }).id, tenantId: tid });
    if (r.deletedCount === 0) return reply.code(404).send({ error: "Not found" });
    return { ok: true };
  });

  // ── Quizzes ──
  app.get("/quizzes", { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as JwtUser;
    const tid = resolveTenantId(req, reply, user);
    if (!tid) return;
    const filter: Record<string, unknown> = { tenantId: tid };
    const courseId = (req.query as { courseId?: string }).courseId;
    if (courseId) filter.courseId = courseId;
    const rows = await Quiz.find(filter).sort({ createdAt: -1 }).lean();
    return withIds(rows as { _id: string }[]);
  });

  app.post("/quizzes", { onRequest: [app.authenticate, requireRole(writeRoles)] }, async (req, reply) => {
    const user = req.user as JwtUser;
    const tid = resolveTenantId(req, reply, user);
    if (!tid) return;
    const body = QuizBody.parse(req.body);
    const q = await Quiz.create({ ...body, courseId: body.courseId ?? (req.query as { courseId?: string }).courseId, tenantId: tid });
    return withId(q.toObject() as { _id: string });
  });

  app.delete("/quizzes/:id", { onRequest: [app.authenticate, requireRole(writeRoles)] }, async (req, reply) => {
    const user = req.user as JwtUser;
    const tid = resolveTenantId(req, reply, user);
    if (!tid) return;
    const r = await Quiz.deleteOne({ _id: (req.params as { id: string }).id, tenantId: tid });
    if (r.deletedCount === 0) return reply.code(404).send({ error: "Not found" });
    return { ok: true };
  });

  // ── Quiz: start attempt ──
  app.post("/quizzes/:id/start", { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as JwtUser;
    const tid = resolveTenantId(req, reply, user);
    if (!tid) return;
    const quizId = (req.params as { id: string }).id;
    const quiz = await Quiz.findOne({ _id: quizId, tenantId: tid }).lean() as Record<string, any> | null;
    if (!quiz) return reply.code(404).send({ error: "Quiz not found" });
    const attempt = await QuizAttempt.create({ tenantId: tid, quizId, studentId: user.sub, startedAt: new Date(), totalPoints: quiz.maxScore ?? 100 });
    return withId(attempt.toObject() as { _id: string });
  });

  // ── Quiz: submit answers ──
  app.post("/quizzes/:id/submit", { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as JwtUser;
    const tid = resolveTenantId(req, reply, user);
    if (!tid) return;
    const quizId = (req.params as { id: string }).id;
    const body = QuizSubmitBody.parse(req.body);
    const quiz = await Quiz.findOne({ _id: quizId, tenantId: tid }).lean() as Record<string, any> | null;
    if (!quiz) return reply.code(404).send({ error: "Quiz not found" });
    let score = 0;
    let total = 0;
    for (const q of (quiz.questions ?? []) as { _id: string; points?: number; correctAnswer?: string }[]) {
      total += q.points ?? 1;
      const qId = (q as { _id: string })._id;
      if (body.answers[qId] === q.correctAnswer) score += q.points ?? 1;
    }
    const attempt = await QuizAttempt.findOneAndUpdate(
      { quizId, studentId: user.sub, submittedAt: null },
      { $set: { answers: body.answers, score, totalPoints: total, submittedAt: new Date() } },
      { new: true, sort: { createdAt: -1 } }
    );
    if (!attempt) return reply.code(404).send({ error: "No active attempt found" });
    return { score, totalPoints: total, attemptId: attempt._id };
  });
}
