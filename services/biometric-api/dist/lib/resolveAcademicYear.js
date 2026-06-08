import { AcademicSession } from "../models/schemas.js";
export async function resolveAcademicYearLabel(tenantId, academicSessionId, academicYear) {
    if (academicSessionId) {
        const s = await AcademicSession.findOne({ _id: academicSessionId, tenantId }).lean();
        if (s)
            return s.label;
    }
    const y = academicYear?.trim();
    return y || null;
}
