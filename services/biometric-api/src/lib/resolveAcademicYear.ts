import { AcademicSession } from "../models/schemas.js";

export async function resolveAcademicYearLabel(
  tenantId: string,
  academicSessionId: string | null | undefined,
  academicYear: string | null | undefined
): Promise<string | null> {
  if (academicSessionId) {
    const s = await AcademicSession.findOne({ _id: academicSessionId, tenantId }).lean<{ label: string } | null>();
    if (s) return s.label;
  }
  const y = academicYear?.trim();
  return y || null;
}
