import { z } from "zod";
import { Role } from "../models/roles.js";
import { AuditLog, BiometricEnrollment, Student } from "../models/schemas.js";
import { requireRole } from "../lib/auth.js";
import { resolveTenantId } from "../lib/tenantScope.js";
import { encryptTemplate } from "../lib/crypto.js";
import { extractTemplate, isMatchingUnreachable, matchingServiceUrl, qualityScore, } from "../lib/matchingClient.js";
const EnrollBody = z.object({
    fingerCode: z.string().min(1),
    imageBase64: z.string().min(1),
    width: z.coerce.number().int().positive(),
    height: z.coerce.number().int().positive(),
    dpi: z.coerce.number().int().positive().default(500),
    format: z.enum(["png", "raw_gray8"]),
    qualityMin: z.coerce.number().min(0).max(100).default(40),
});
export async function enrollmentRoutes(app) {
    app.post("/students/:studentId/enrollments", {
        onRequest: [
            app.authenticate,
            requireRole([Role.SUPER_ADMIN, Role.TENANT_ADMIN, Role.ENROLLER]),
        ],
    }, async (req, reply) => {
        const user = req.user;
        const tid = resolveTenantId(req, reply, user);
        if (!tid)
            return;
        const studentId = req.params.studentId;
        const body = EnrollBody.parse(req.body);
        const student = await Student.findOne({ _id: studentId, tenantId: tid }).lean();
        if (!student)
            return reply.code(404).send({ error: "Student not found" });
        let q;
        let extracted;
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
        }
        catch (e) {
            if (isMatchingUnreachable(e)) {
                return reply.code(503).send({
                    error: "Matching service unavailable",
                    hint: `Start the SourceAFIS Java service at ${matchingServiceUrl()} (e.g. run \`pnpm dev\` from the repo root, or: java -jar services/matching-java/target/matching-service-0.1.0.jar). Set MATCHING_SERVICE_URL in apps/api/.env if it runs elsewhere.`,
                });
            }
            throw e;
        }
        const raw = Buffer.from(extracted.template_base64, "base64");
        const enc = encryptTemplate(raw);
        const row = await BiometricEnrollment.findOneAndUpdate({ studentId, fingerCode: body.fingerCode }, {
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
        }, { upsert: true, new: true }).lean();
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
            id: row._id,
            fingerCode: row.fingerCode,
            qualityScore: q.score,
            templateVersion: row.templateVersion,
        };
    });
}
