import { z } from "zod";
import { Role } from "../models/roles.js";
import { AuditLog, BiometricEnrollment, Student } from "../models/schemas.js";
import { requireRole } from "../lib/auth.js";
import { resolveTenantId } from "../lib/tenantScope.js";
import { withId, withIds } from "../lib/serialize.js";
const UpsertStudent = z.object({
    matricNo: z.string().min(1),
    fullName: z.string().min(1),
    facultyId: z.string().nullable().optional(),
    departmentId: z.string().nullable().optional(),
    faculty: z.string().optional(),
    department: z.string().optional(),
    level: z.string().optional(),
    photoUrl: z.string().url().optional(),
});
const PatchStudent = UpsertStudent.partial();
export async function studentRoutes(app) {
    app.post("/students", {
        onRequest: [
            app.authenticate,
            requireRole([Role.SUPER_ADMIN, Role.TENANT_ADMIN, Role.ENROLLER]),
        ],
    }, async (req, reply) => {
        const user = req.user;
        const tid = resolveTenantId(req, reply, user);
        if (!tid)
            return;
        const body = UpsertStudent.parse(req.body);
        try {
            const s = await Student.create({
                tenantId: tid,
                matricNo: body.matricNo,
                fullName: body.fullName,
                facultyId: body.facultyId ?? undefined,
                departmentId: body.departmentId ?? undefined,
                faculty: body.faculty,
                department: body.department,
                level: body.level,
                photoUrl: body.photoUrl,
            });
            await AuditLog.create({
                tenantId: tid,
                actorId: user.sub,
                action: "student.create",
                entityType: "Student",
                entityId: s._id,
            });
            return withId(s.toObject());
        }
        catch (e) {
            if (e.code === 11000) {
                return reply.code(409).send({ error: "Matric already exists" });
            }
            throw e;
        }
    });
    app.get("/students", {
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
    }, async (req, reply) => {
        const user = req.user;
        const tid = resolveTenantId(req, reply, user);
        if (!tid)
            return;
        const q = req.query?.q?.trim();
        const filter = { tenantId: tid };
        if (q) {
            filter.$or = [
                { matricNo: { $regex: q, $options: "i" } },
                { fullName: { $regex: q, $options: "i" } },
            ];
        }
        const rows = await Student.find(filter).sort({ matricNo: 1 }).limit(200).lean();
        return withIds(rows);
    });
    app.get("/students/:id", {
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
    }, async (req, reply) => {
        const user = req.user;
        const tid = resolveTenantId(req, reply, user);
        if (!tid)
            return;
        const s = await Student.findOne({ _id: req.params.id, tenantId: tid }).lean();
        if (!s)
            return reply.code(404).send({ error: "Not found" });
        const enrollments = await BiometricEnrollment.find({ studentId: s._id }).lean();
        return { ...withId(s), enrollments };
    });
    app.patch("/students/:id", {
        onRequest: [
            app.authenticate,
            requireRole([Role.SUPER_ADMIN, Role.TENANT_ADMIN, Role.ENROLLER]),
        ],
    }, async (req, reply) => {
        const user = req.user;
        const tid = resolveTenantId(req, reply, user);
        if (!tid)
            return;
        const id = req.params.id;
        const body = PatchStudent.parse(req.body);
        const updates = {};
        if (body.matricNo !== undefined)
            updates.matricNo = body.matricNo;
        if (body.fullName !== undefined)
            updates.fullName = body.fullName;
        if (body.facultyId !== undefined)
            updates.facultyId = body.facultyId;
        if (body.departmentId !== undefined)
            updates.departmentId = body.departmentId;
        if (body.faculty !== undefined)
            updates.faculty = body.faculty;
        if (body.department !== undefined)
            updates.department = body.department;
        if (body.level !== undefined)
            updates.level = body.level;
        if (body.photoUrl !== undefined)
            updates.photoUrl = body.photoUrl;
        const s = await Student.findOneAndUpdate({ _id: id, tenantId: tid }, { $set: updates }, { new: true }).lean();
        if (!s)
            return reply.code(404).send({ error: "Not found" });
        await AuditLog.create({
            tenantId: tid,
            actorId: user.sub,
            action: "student.update",
            entityType: "Student",
            entityId: id,
        });
        return withId(s);
    });
}
