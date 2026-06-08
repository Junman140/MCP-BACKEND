/** Plain objects returned by `.lean()` for type-safe queries. */
export interface UserLean {
  _id: string;
  email: string;
  passwordHash: string;
  role: string;
  tenantId?: string | null;
  displayName?: string;
}

export interface DeviceLean {
  _id: string;
  tenantId: string;
  apiKeyHash: string;
  name: string;
  hallLabel?: string | null;
  lastSeenAt?: Date | null;
}

export interface StudentLean {
  _id: string;
  tenantId: string;
  matricNo: string;
  fullName: string;
  facultyId?: string | null;
  departmentId?: string | null;
  faculty?: string | null;
  department?: string | null;
  level?: string | null;
  photoUrl?: string | null;
}

export interface CourseLean {
  _id: string;
  tenantId: string;
  code: string;
  title: string;
  facultyId?: string | null;
  departmentId?: string | null;
  faculty?: string | null;
  department?: string | null;
}

export interface CourseRegistrationLean {
  _id: string;
  tenantId: string;
  studentId: string;
  courseId: string;
  academicSessionId?: string | null;
  academicYear: string;
  semester: number;
}

export interface BiometricEnrollmentLean {
  _id: string;
  tenantId: string;
  studentId: string;
  modality: string;
  fingerCode?: string | null;
  templateEnc?: Buffer | null;
  faceEmbedding?: Buffer | null;
  qualityScore?: number | null;
  templateVersion: string;
}

export interface ExamLean {
  _id: string;
  tenantId: string;
  title: string;
  courseId?: string | null;
  academicSessionId?: string | null;
  academicYear?: string | null;
  semester?: number | null;
  startsAt?: Date | null;
  endsAt?: Date | null;
}

export interface ExamRosterEntryLean {
  _id: string;
  examId: string;
  studentId: string;
  hallLabel?: string | null;
}

export interface VerificationEventLean {
  _id: string;
  matchScore?: number | null;
  studentId?: string;
  examId?: string | null;
  result?: string;
}

/** Fields needed for reports / CSV joins. */
export interface VerificationEventListLean {
  _id: string;
  tenantId: string;
  studentId: string;
  deviceId?: string | null;
  examId?: string | null;
  courseId?: string | null;
  academicSessionId?: string | null;
  academicYear?: string | null;
  semester?: number | null;
  capturedAt: Date;
  result: string;
  matchScore?: number | null;
}

export interface StudentReportLean {
  _id: string;
  matricNo: string;
  fullName: string;
}

export interface DeviceReportLean {
  _id: string;
  name: string;
  hallLabel?: string | null;
}
