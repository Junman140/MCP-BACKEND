import { Role } from "../models/roles.js";
import { Device, Student, VerificationEvent } from "../models/schemas.js";
import { requireRole } from "../lib/auth.js";
import { resolveTenantId } from "../lib/tenantScope.js";
export async function reportRoutes(app) {
    app.get("/reports/verification-events", {
        onRequest: [
            app.authenticate,
            requireRole([Role.SUPER_ADMIN, Role.TENANT_ADMIN, Role.VIEWER]),
        ],
    }, async (req, reply) => {
        const user = req.user;
        const tid = resolveTenantId(req, reply, user);
        if (!tid)
            return;
        const q = req.query;
        const from = q.from ? new Date(q.from) : new Date(Date.now() - 7 * 86400000);
        const to = q.to ? new Date(q.to) : new Date();
        const rows = await VerificationEvent.find({
            tenantId: tid,
            capturedAt: { $gte: from, $lte: to },
        })
            .sort({ capturedAt: -1 })
            .limit(500)
            .lean();
        const studentIds = [...new Set(rows.map((r) => r.studentId))];
        const deviceIds = [...new Set(rows.map((r) => r.deviceId).filter(Boolean))];
        const [students, devices] = await Promise.all([
            Student.find({ _id: { $in: studentIds } })
                .select("matricNo fullName")
                .lean(),
            deviceIds.length
                ? Device.find({ _id: { $in: deviceIds } }).select("name hallLabel").lean()
                : [],
        ]);
        const sm = new Map(students.map((s) => [s._id, s]));
        const dm = new Map(devices.map((d) => [d._id, d]));
        return rows.map((r) => ({
            id: r._id,
            capturedAt: r.capturedAt,
            result: r.result,
            matchScore: r.matchScore,
            examId: r.examId ?? null,
            courseId: r.courseId ?? null,
            academicYear: r.academicYear ?? null,
            semester: r.semester ?? null,
            student: sm.get(r.studentId) ?? { matricNo: "", fullName: "" },
            device: r.deviceId ? dm.get(r.deviceId) ?? null : null,
        }));
    });
    app.get("/reports/verification-events/export.csv", {
        onRequest: [
            app.authenticate,
            requireRole([Role.SUPER_ADMIN, Role.TENANT_ADMIN, Role.VIEWER]),
        ],
    }, async (req, reply) => {
        const user = req.user;
        const tid = resolveTenantId(req, reply, user);
        if (!tid)
            return;
        const q = req.query;
        const from = q.from ? new Date(q.from) : new Date(Date.now() - 7 * 86400000);
        const to = q.to ? new Date(q.to) : new Date();
        const rows = await VerificationEvent.find({
            tenantId: tid,
            capturedAt: { $gte: from, $lte: to },
        })
            .sort({ capturedAt: 1 })
            .limit(10000)
            .lean();
        const studentIds = [...new Set(rows.map((r) => r.studentId))];
        const deviceIds = [...new Set(rows.map((r) => r.deviceId).filter(Boolean))];
        const [students, devices] = await Promise.all([
            Student.find({ _id: { $in: studentIds } })
                .select("matricNo fullName")
                .lean(),
            deviceIds.length
                ? Device.find({ _id: { $in: deviceIds } }).select("name hallLabel").lean()
                : [],
        ]);
        const sm = new Map(students.map((s) => [s._id, s]));
        const dm = new Map(devices.map((d) => [d._id, d]));
        const header = "capturedAt,result,matchScore,examId,courseId,academicYear,semester,matricNo,fullName,device,hall\n";
        const lines = rows
            .map((r) => {
            const esc = (s) => `"${(s ?? "").replace(/"/g, '""')}"`;
            const st = sm.get(r.studentId);
            const dev = r.deviceId ? dm.get(r.deviceId) : undefined;
            const cols = [
                r.capturedAt.toISOString(),
                r.result,
                r.matchScore ?? "",
                r.examId ?? "",
                r.courseId ?? "",
                r.academicYear ?? "",
                r.semester ?? "",
                st?.matricNo ?? "",
                st?.fullName ?? "",
                dev?.name ?? "",
                dev?.hallLabel ?? "",
            ];
            return cols
                .map((x) => (typeof x === "string" && x.includes(",") ? esc(x) : x))
                .join(",");
        })
            .join("\n");
        reply.header("Content-Type", "text/csv");
        return header + lines;
    });
}
