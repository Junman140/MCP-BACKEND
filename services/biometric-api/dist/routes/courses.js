import { z } from "zod";
import { Role } from "../models/roles.js";
import { Course } from "../models/schemas.js";
import { requireRole } from "../lib/auth.js";
import { resolveTenantId } from "../lib/tenantScope.js";
import { withId, withIds } from "../lib/serialize.js";
const CreateCourse = z.object({
    code: z.string().min(1),
    title: z.string().min(1),
    facultyId: z.string().optional(),
    departmentId: z.string().optional(),
    faculty: z.string().optional(),
    department: z.string().optional(),
});
const PatchCourse = CreateCourse.partial();
export async function courseRoutes(app) {
    app.get("/courses", {
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
        const rows = await Course.find({ tenantId: tid }).sort({ code: 1 }).limit(500).lean();
        return withIds(rows);
    });
    app.post("/courses", {
        onRequest: [app.authenticate, requireRole([Role.SUPER_ADMIN, Role.TENANT_ADMIN, Role.ENROLLER])],
    }, async (req, reply) => {
        const user = req.user;
        const tid = resolveTenantId(req, reply, user);
        if (!tid)
            return;
        const body = CreateCourse.parse(req.body);
        try {
            const c = await Course.create({
                tenantId: tid,
                code: body.code.trim(),
                title: body.title.trim(),
                facultyId: body.facultyId,
                departmentId: body.departmentId,
                faculty: body.faculty,
                department: body.department,
            });
            return withId(c.toObject());
        }
        catch (e) {
            if (e.code === 11000) {
                return reply.code(409).send({ error: "Course code already exists" });
            }
            throw e;
        }
    });
    app.patch("/courses/:id", {
        onRequest: [app.authenticate, requireRole([Role.SUPER_ADMIN, Role.TENANT_ADMIN, Role.ENROLLER])],
    }, async (req, reply) => {
        const user = req.user;
        const tid = resolveTenantId(req, reply, user);
        if (!tid)
            return;
        const id = req.params.id;
        const body = PatchCourse.parse(req.body);
        const updates = {};
        if (body.code !== undefined)
            updates.code = body.code.trim();
        if (body.title !== undefined)
            updates.title = body.title.trim();
        if (body.facultyId !== undefined)
            updates.facultyId = body.facultyId;
        if (body.departmentId !== undefined)
            updates.departmentId = body.departmentId;
        if (body.faculty !== undefined)
            updates.faculty = body.faculty;
        if (body.department !== undefined)
            updates.department = body.department;
        const c = await Course.findOneAndUpdate({ _id: id, tenantId: tid }, { $set: updates }, { new: true }).lean();
        if (!c)
            return reply.code(404).send({ error: "Not found" });
        return withId(c);
    });
    app.delete("/courses/:id", {
        onRequest: [app.authenticate, requireRole([Role.SUPER_ADMIN, Role.TENANT_ADMIN])],
    }, async (req, reply) => {
        const user = req.user;
        const tid = resolveTenantId(req, reply, user);
        if (!tid)
            return;
        const id = req.params.id;
        const r = await Course.deleteOne({ _id: id, tenantId: tid });
        if (r.deletedCount === 0)
            return reply.code(404).send({ error: "Not found" });
        return { ok: true };
    });
}
