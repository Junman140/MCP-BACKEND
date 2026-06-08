import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./crypto.js";

export interface CachedExamPackage {
  examId: string;
  title: string;
  tenantId: string;
  courseId: string | null;
  academicYear: string | null;
  semester: number | null;
  students: Array<{
    studentId: string;
    matricNo: string;
    fullName: string;
    photoUrl: string | null;
    hallLabel: string | null;
    /** False if exam has course/year/semester and student is not registered for that course offering. */
    eligibleForExam: boolean;
    enrollments: Array<{
      fingerCode: string;
      templateEncBase64: string;
      templateVersion: string;
      qualityScore: number | null;
    }>;
  }>;
  syncedAt: string;
}

const cachePath = () => path.join(dataDir(), "exam-package.json");

export function readCache(): CachedExamPackage | null {
  const p = cachePath();
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8")) as CachedExamPackage;
}

export function writeCache(pkg: Omit<CachedExamPackage, "syncedAt">): void {
  const full: CachedExamPackage = { ...pkg, syncedAt: new Date().toISOString() };
  fs.writeFileSync(cachePath(), JSON.stringify(full, null, 2), "utf8");
}
