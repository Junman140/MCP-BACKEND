import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Role } from "../models/roles.js";
import type { BiometricEnrollmentLean, StudentLean } from "../models/lean.js";
import { AuditLog, BiometricEnrollment, Student } from "../models/schemas.js";
import { requireRole } from "../lib/auth.js";
import { resolveTenantId, type JwtUser } from "../lib/tenantScope.js";
import { encryptTemplate } from "../lib/crypto.js";
import {
  extractTemplate,
  isMatchingUnreachable,
  matchingServiceUrl,
  qualityScore,
} from "../lib/matchingClient.js";
import {
  extractFaceEmbedding,
  faceServiceUrl,
  embeddingB64ToBuffer,
  isFaceUnreachable,
} from "../lib/faceClient.js";

const EnrollBody = z.object({
  fingerCode: z.string().min(1),
  imageBase64: z.string().min(1),
  width: z.coerce.number().int().positive(),
  height: z.coerce.number().int().positive(),
  dpi: z.coerce.number().int().positive().default(500),
  format: z.enum(["png", "raw_gray8"]),
  qualityMin: z.coerce.number().min(0).max(100).default(40),
});

export async function enrollmentRoutes(app: FastifyInstance) {
  app.get(
    "/students/:studentId/enrollments/status",
    {
      onRequest: [
        app.authenticate,
        requireRole([Role.SUPER_ADMIN, Role.TENANT_ADMIN, Role.ENROLLER, Role.INVIGILATOR]),
      ],
    },
    async (req, reply) => {
      const user = req.user as JwtUser;
      const tid = resolveTenantId(req, reply, user);
      if (!tid) return;
      const studentId = (req.params as { studentId: string }).studentId;

      const student = await Student.findOne({ _id: studentId, tenantId: tid }).lean();
      if (!student) return reply.code(404).send({ error: "Student not found" });

      const all = await BiometricEnrollment.find({ studentId, tenantId: tid }).lean<
        BiometricEnrollmentLean[]
      >();
      const hasFingerprint = all.some((e) => e.modality === "fingerprint");
      const hasFace = all.some((e) => e.modality === "face");
      const fingers = all
        .filter((e) => e.modality === "fingerprint" && e.fingerCode)
        .map((e) => e.fingerCode!);

      return { fingerprint: hasFingerprint, face: hasFace, fingers };
    }
  );

  app.post(
    "/students/:studentId/enrollments",
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
      const studentId = (req.params as { studentId: string }).studentId;
      const body = EnrollBody.parse(req.body);

      const student = await Student.findOne({ _id: studentId, tenantId: tid }).lean<StudentLean | null>();
      if (!student) return reply.code(404).send({ error: "Student not found" });

      let q: { score: number };
      let extracted: { template_base64: string; template_version: string };
      try {
        q = await qualityScore({
          imageBase64: body.imageBase64,
          width: body.width,
          height: body.height,
          format: body.format,
        });
        if (q.score < body.qualityMin) {
          return reply.code(400).send({
            error: "Quality too low",
            quality: q.score,
            qualityMin: body.qualityMin,
          });
        }

        extracted = await extractTemplate({
          imageBase64: body.imageBase64,
          width: body.width,
          height: body.height,
          dpi: body.dpi,
          format: body.format,
        });
      } catch (e: unknown) {
        if (isMatchingUnreachable(e)) {
          return reply.code(503).send({
            error: "Matching service unavailable",
            hint: `Start the SourceAFIS Java service at ${matchingServiceUrl()} (e.g. run \`pnpm dev\` from the repo root, or: java -jar services/matching-java/target/matching-service-0.1.0.jar). Set MATCHING_SERVICE_URL in apps/api/.env if it runs elsewhere.`,
          });
        }
        throw e;
      }
      const raw = Buffer.from(extracted.template_base64, "base64");
      console.log(`[Enroll] Extracted template length: ${raw.length} bytes. Format: ${body.format}`);
      const enc = encryptTemplate(raw);

      const row = await BiometricEnrollment.findOneAndUpdate(
        { studentId, fingerCode: body.fingerCode },
        {
          $set: {
            tenantId: tid,
            studentId,
            fingerCode: body.fingerCode,
            templateEnc: enc,
            qualityScore: q.score,
            enrolledById: user.sub,
            templateVersion: extracted.template_version,
            enrolledAt: new Date(),
          },
        },
        { upsert: true, new: true }
      ).lean<BiometricEnrollmentLean | null>();

      if (!row) {
        return reply.code(500).send({ error: "Enrollment failed" });
      }

      await AuditLog.create({
        tenantId: tid,
        actorId: user.sub,
        action: "enrollment.upsert",
        entityType: "BiometricEnrollment",
        entityId: row._id,
        meta: { fingerCode: body.fingerCode, quality: q.score },
      });

      return {
        id: row._id.toString(),
        fingerCode: row.fingerCode,
        qualityScore: q.score,
        templateVersion: row.templateVersion,
      };
    }
  );

  app.post(
    "/students/:studentId/enrollments/face",
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
      const studentId = (req.params as { studentId: string }).studentId;
      const body = z
        .object({
          imageBase64: z.string().min(1),
          qualityMin: z.coerce.number().min(0).max(1).default(0.5),
        })
        .parse(req.body);

      const student = await Student.findOne({
        _id: studentId,
        tenantId: tid,
      }).lean<StudentLean | null>();
      if (!student) return reply.code(404).send({ error: "Student not found" });

      let result;
      try {
        result = await extractFaceEmbedding(body.imageBase64);
      } catch (e: unknown) {
        if (isFaceUnreachable(e)) {
          return reply.code(503).send({
            error: "Face service unavailable",
            hint: `Start the face service at ${faceServiceUrl()}.`,
          });
        }
        throw e;
      }

      if (!result.embeddings.length) {
        return reply.code(400).send({
          error: "No face detected",
          detail: "Ensure the face is clearly visible and well-lit.",
        });
      }

      const best = result.embeddings[0];
      if (best.confidence < body.qualityMin) {
        return reply.code(400).send({
          error: "Face quality too low",
          confidence: best.confidence,
          qualityMin: body.qualityMin,
        });
      }

      const embeddingBuf = embeddingB64ToBuffer(best.embedding_b64);
      const enc = encryptTemplate(embeddingBuf);

      const row = await BiometricEnrollment.findOneAndUpdate(
        { studentId, modality: "face" },
        {
          $set: {
            tenantId: tid,
            studentId,
            modality: "face",
            faceEmbedding: enc,
            qualityScore: best.confidence,
            enrolledById: user.sub,
            templateVersion: "arcface-buffalo-l",
            enrolledAt: new Date(),
          },
        },
        { upsert: true, new: true }
      ).lean<BiometricEnrollmentLean | null>();

      if (!row) {
        return reply.code(500).send({ error: "Face enrollment failed" });
      }

      await AuditLog.create({
        tenantId: tid,
        actorId: user.sub,
        action: "enrollment.face.upsert",
        entityType: "BiometricEnrollment",
        entityId: row._id,
        meta: { modality: "face", quality: best.confidence },
      });

      return {
        id: row._id.toString(),
        modality: "face",
        qualityScore: best.confidence,
        templateVersion: row.templateVersion,
      };
    }
  );

  app.delete(
    "/students/:studentId/enrollments",
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
      const studentId = (req.params as { studentId: string }).studentId;

      const student = await Student.findOne({ _id: studentId, tenantId: tid }).lean();
      if (!student) return reply.code(404).send({ error: "Student not found" });

      const res = await BiometricEnrollment.deleteMany({ studentId, tenantId: tid });

      await AuditLog.create({
        tenantId: tid,
        actorId: user.sub,
        action: "enrollment.delete",
        entityType: "BiometricEnrollment",
        entityId: studentId,
        meta: { deletedCount: res.deletedCount },
      });

      return { ok: true, deletedCount: res.deletedCount };
    }
  );
}
