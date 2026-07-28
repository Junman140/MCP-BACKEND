import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Role } from "../models/roles.js";
import { User, Student } from "../models/schemas.js";
import { hashPassword, verifyPassword } from "../lib/auth.js";
import { resolveTenantId, type JwtUser } from "../lib/tenantScope.js";
import { withId } from "../lib/serialize.js";

const StudentLogin = z.object({
  matricNo: z.string().min(1),
  password: z.string().min(1),
});

const StudentRegister = z.object({
  matricNo: z.string().min(1),
  fullName: z.string().min(1),
  departmentId: z.string().optional(),
  facultyId: z.string().optional(),
  level: z.string().optional(),
});

const PasswordChange = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

export async function studentAuthRoutes(app: FastifyInstance) {
  // ── Student login (with auto-registration on first login) ──
  app.post("/student/login", async (req, reply) => {
    const body = StudentLogin.parse(req.body);
    const cleanMatric = body.matricNo.replace(/[^a-zA-Z0-9]/g, "");

    const student = await Student.findOne({ matricNo: body.matricNo });
    if (!student) return reply.code(401).send({ error: "Invalid matric number or password" });

    // Already registered → normal password check
    if (student.userId) {
      const user = await User.findById(student.userId).lean() as Record<string, any> | null;
      if (user && (await verifyPassword(body.password, user.passwordHash))) {
        const token = await reply.jwtSign({
          sub: student._id,
          role: Role.STUDENT,
          tenantId: student.tenantId ?? null,
        });
        return { token, student: { id: student._id, matricNo: student.matricNo, fullName: student.fullName, needsPasswordChange: false } };
      }
      return reply.code(401).send({ error: "Invalid matric number or password" });
    }

    // Not yet registered → auto-register if password matches clean matricNo
    if (body.password !== cleanMatric && body.password !== body.matricNo) {
      return reply.code(401).send({ error: "First-time login: use your matric number as the password (letters and numbers only).", firstTime: true });
    }

    const email = `${cleanMatric.toLowerCase()}@student.local`;
    const pwHash = await hashPassword(body.password);

    const newUser = await User.create({
      tenantId: student.tenantId,
      email,
      passwordHash: pwHash,
      role: Role.STUDENT,
      displayName: student.fullName,
    });

    student.userId = newUser._id;
    await student.save();

    const token = await reply.jwtSign({
      sub: student._id,
      role: Role.STUDENT,
      tenantId: student.tenantId ?? null,
    });

    return {
      token,
      student: { id: student._id, matricNo: student.matricNo, fullName: student.fullName, needsPasswordChange: true },
      message: "Account created. Please change your password in Settings.",
    };
  });

  // ── Admin-registered student account creation ──
  app.post("/student/register", { onRequest: [app.authenticate] }, async (req, reply) => {
    const body = StudentRegister.parse(req.body);
    const user = req.user as JwtUser;

    // Only admins/lecturers can register students for login
    if (!([Role.SUPER_ADMIN, Role.TENANT_ADMIN, Role.LECTURER] as string[]).includes(user.role)) {
      return reply.code(403).send({ error: "Forbidden" });
    }

    const student = await Student.findOne({ matricNo: body.matricNo });
    if (!student) return reply.code(404).send({ error: "Student not found" });

    if (student.userId) {
      return reply.code(409).send({ error: "Student already has login credentials" });
    }

    const email = `${body.matricNo.replace(/[^a-zA-Z0-9]/g, '').toLowerCase()}@student.local`;
    const defaultPassword = body.matricNo.replace(/[^a-zA-Z0-9]/g, ''); // clean matricNo as password
    const pwHash = await hashPassword(defaultPassword);

    const newUser = await User.create({
      tenantId: student.tenantId,
      email,
      passwordHash: pwHash,
      role: Role.STUDENT,
      displayName: body.fullName,
    });

    student.userId = newUser._id;
    await student.save();

    return reply.code(201).send({
      email,
      defaultPassword,
      student: withId(student.toObject() as { _id: string }),
    });
  });

  // ── Student password change ──
  app.post("/student/change-password", { onRequest: [app.authenticate] }, async (req, reply) => {
    const body = PasswordChange.parse(req.body);
    const user = req.user as JwtUser;
    const tid = resolveTenantId(req, reply, user);
    if (!tid) return;

    // Find student by JWT sub
    const student = await Student.findOne({
      $or: [{ _id: user.sub }, { matricNo: user.sub }],
      tenantId: tid,
    });
    if (!student?.userId) return reply.code(404).send({ error: "Student account not found" });

    const authUser = await User.findById(student.userId);
    if (!authUser) return reply.code(404).send({ error: "User account not found" });

    if (!(await verifyPassword(body.currentPassword, authUser.passwordHash))) {
      return reply.code(401).send({ error: "Current password is incorrect" });
    }

    authUser.passwordHash = await hashPassword(body.newPassword);
    await authUser.save();

    return { ok: true };
  });
}
