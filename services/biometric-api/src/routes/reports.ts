import type { FastifyInstance } from "fastify";
import { Role } from "../models/roles.js";
import type { DeviceReportLean, StudentReportLean, VerificationEventListLean } from "../models/lean.js";
import { Device, Student, VerificationEvent, BiometricEnrollment } from "../models/schemas.js";
import { requireRole } from "../lib/auth.js";
import { resolveTenantId, type JwtUser } from "../lib/tenantScope.js";

export async function reportRoutes(app: FastifyInstance) {
  app.get(
    "/reports/cbt-stats",
    {
      onRequest: [
        app.authenticate,
        requireRole([Role.SUPER_ADMIN, Role.TENANT_ADMIN, Role.VIEWER]),
      ],
    },
    async (req, reply) => {
      const user = req.user as JwtUser;
      const tid = resolveTenantId(req, reply, user);
      if (!tid) return;

      const totalStudents = await Student.countDocuments({ tenantId: tid });
      const enrolledIds = await BiometricEnrollment.distinct("studentId", { tenantId: tid });
      const verifiedIds = await VerificationEvent.distinct("studentId", { 
        tenantId: tid, 
        result: "match" 
      });

      return {
        total_students: totalStudents,
        total_enrolled: enrolledIds.length,
        total_verified: verifiedIds.length,
      };
    }
  );

  app.get(
    "/reports/verification-events",
    {
      onRequest: [
        app.authenticate,
        requireRole([Role.SUPER_ADMIN, Role.TENANT_ADMIN, Role.VIEWER]),
      ],
    },
    async (req, reply) => {
      const user = req.user as JwtUser;
      const tid = resolveTenantId(req, reply, user);
      if (!tid) return;
      const q = req.query as Record<string, string | undefined>;
      const from = q.from ? new Date(q.from) : new Date(Date.now() - 7 * 86400000);
      const to = q.to ? new Date(q.to) : new Date();
      const rows = await VerificationEvent.find({
        tenantId: tid,
        capturedAt: { $gte: from, $lte: to },
      })
        .sort({ capturedAt: -1 })
        .limit(500)
        .lean<VerificationEventListLean[]>();

      const studentIds = [...new Set(rows.map((r) => r.studentId))];
      const deviceIds = [...new Set(rows.map((r) => r.deviceId).filter(Boolean))] as string[];
      const [students, devices] = await Promise.all([
        Student.find({ _id: { $in: studentIds } })
          .select("matricNo fullName")
          .lean<StudentReportLean[]>(),
        deviceIds.length
          ? Device.find({ _id: { $in: deviceIds } }).select("name hallLabel").lean<DeviceReportLean[]>()
          : ([] as DeviceReportLean[]),
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
    }
  );

  app.get(
    "/reports/verification-events/export.csv",
    {
      onRequest: [
        app.authenticate,
        requireRole([Role.SUPER_ADMIN, Role.TENANT_ADMIN, Role.VIEWER]),
      ],
    },
    async (req, reply) => {
      const user = req.user as JwtUser;
      const tid = resolveTenantId(req, reply, user);
      if (!tid) return;
      const q = req.query as Record<string, string | undefined>;
      const from = q.from ? new Date(q.from) : new Date(Date.now() - 7 * 86400000);
      const to = q.to ? new Date(q.to) : new Date();
      const rows = await VerificationEvent.find({
        tenantId: tid,
        capturedAt: { $gte: from, $lte: to },
      })
        .sort({ capturedAt: 1 })
        .limit(10000)
        .lean<VerificationEventListLean[]>();

      const studentIds = [...new Set(rows.map((r) => r.studentId))];
      const deviceIds = [...new Set(rows.map((r) => r.deviceId).filter(Boolean))] as string[];
      const [students, devices] = await Promise.all([
        Student.find({ _id: { $in: studentIds } })
          .select("matricNo fullName")
          .lean<StudentReportLean[]>(),
        deviceIds.length
          ? Device.find({ _id: { $in: deviceIds } }).select("name hallLabel").lean<DeviceReportLean[]>()
          : ([] as DeviceReportLean[]),
      ]);
      const sm = new Map(students.map((s) => [s._id, s]));
      const dm = new Map(devices.map((d) => [d._id, d]));

      const header =
        "capturedAt,result,matchScore,examId,courseId,academicYear,semester,matricNo,fullName,device,hall\n";
      const lines = rows
        .map((r) => {
          const esc = (s: string | null | undefined) =>
            `"${(s ?? "").replace(/"/g, '""')}"`;
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
    }
  );
}
