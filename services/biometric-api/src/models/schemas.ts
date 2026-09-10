import mongoose, { Schema } from "mongoose";
import { randomUUID } from "node:crypto";

function idString() {
  return { type: String, default: () => randomUUID() };
}

const TenantSchema = new Schema(
  {
    _id: idString(),
    name: { type: String, required: true },
    slug: { type: String, required: true, unique: true },
  },
  { timestamps: true, collection: "tenants" }
);

const UserSchema = new Schema(
  {
    _id: idString(),
    tenantId: { type: String, ref: "Tenant", default: null },
    email: { type: String, required: true, unique: true },
    passwordHash: { type: String, required: true },
    role: {
      type: String,
      enum: ["SUPER_ADMIN", "TENANT_ADMIN", "ENROLLER", "INVIGILATOR", "LECTURER", "BIOMETRIC_OPERATOR", "STUDENT", "VIEWER"],
      default: "VIEWER",
    },
    displayName: String,
  },
  { timestamps: true, collection: "users" }
);

const LecturerProfileSchema = new Schema(
  {
    _id: idString(),
    tenantId: { type: String, required: true, ref: "Tenant", index: true },
    userId: { type: String, required: true, ref: "User", unique: true },
    staffId: { type: String, required: true },
    title: String,
    fullName: { type: String, required: true },
    email: { type: String, required: true },
    phone: String,
    departmentId: { type: String, ref: "Department", default: null },
    qualifications: [String],
    specializations: [String],
    employmentType: { type: String, enum: ["full-time", "part-time", "adjunct"], default: "full-time" },
    photoUrl: String,
    officeHours: [
      new Schema(
        {
          dayOfWeek: { type: String, enum: ["mon","tue","wed","thu","fri","sat","sun"] },
          startTime: String,
          endTime: String,
          location: String,
        },
        { _id: false }
      ),
    ],
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, collection: "lecturer_profiles" }
);
LecturerProfileSchema.index({ tenantId: 1, staffId: 1 }, { unique: true });

const FacultySchema = new Schema(
  {
    _id: idString(),
    tenantId: { type: String, required: true, ref: "Tenant", index: true },
    name: { type: String, required: true },
  },
  { timestamps: true, collection: "faculties" }
);
FacultySchema.index({ tenantId: 1, name: 1 }, { unique: true });

const DepartmentSchema = new Schema(
  {
    _id: idString(),
    tenantId: { type: String, required: true, ref: "Tenant", index: true },
    facultyId: { type: String, ref: "Faculty", default: null, index: true },
    name: { type: String, required: true },
    /** Pattern for matric population, e.g. "19/AN/ED/VE/####" */
    matricPattern: String,
  },
  { timestamps: true, collection: "departments" }
);
DepartmentSchema.index({ tenantId: 1, facultyId: 1, name: 1 }, { unique: true });

/** Academic session labels for dropdowns (e.g. 2024/2025). */
const AcademicSessionSchema = new Schema(
  {
    _id: idString(),
    tenantId: { type: String, required: true, ref: "Tenant", index: true },
    label: { type: String, required: true },
  },
  { timestamps: true, collection: "academic_sessions" }
);
AcademicSessionSchema.index({ tenantId: 1, label: 1 }, { unique: true });

const StudentSchema = new Schema(
  {
    _id: idString(),
    tenantId: { type: String, required: true, ref: "Tenant", index: true },
    matricNo: { type: String, required: true },
    fullName: { type: String, required: true },
    email: String,
    facultyId: { type: String, ref: "Faculty", default: null },
    departmentId: { type: String, ref: "Department", default: null },
    /** Legacy / denormalized copy when IDs not used */
    faculty: String,
    department: String,
    level: String,
    userId: { type: String, ref: "User", default: null, index: true, sparse: true },
    photoUrl: String,
    passwordHash: String,
  },
  { timestamps: true, collection: "students" }
);
StudentSchema.index({ tenantId: 1, matricNo: 1 }, { unique: true });

const CourseSchema = new Schema(
  {
    _id: idString(),
    tenantId: { type: String, required: true, ref: "Tenant", index: true },
    code: { type: String, required: true },
    title: { type: String, required: true },
    courseType: {
      type: String,
      enum: ["general", "departmental", "faculty"],
      default: "departmental",
    },
    facultyId: { type: String, ref: "Faculty", default: null },
    departmentIds: [{ type: String, ref: "Department" }],
    semester: { type: Number, min: 1, max: 2, default: 1 },
    level: { type: String, default: null },
    creditUnits: { type: Number, default: 3 },
    lecturerIds: [{ type: String, ref: "LecturerProfile" }],
    faculty: String,
    department: String,
  },
  { timestamps: true, collection: "courses" }
);
CourseSchema.index({ tenantId: 1, code: 1 }, { unique: true });
CourseSchema.index({ tenantId: 1, facultyId: 1, semester: 1, courseType: 1 });

/** Student registered for a course in a given academic year & semester (sitting eligibility). */
const CourseRegistrationSchema = new Schema(
  {
    _id: idString(),
    tenantId: { type: String, required: true, ref: "Tenant", index: true },
    studentId: { type: String, required: true, ref: "Student", index: true },
    courseId: { type: String, required: true, ref: "Course", index: true },
    academicSessionId: { type: String, ref: "AcademicSession", default: null },
    academicYear: { type: String, required: true },
    semester: { type: Number, required: true, min: 1, max: 2 },
  },
  { timestamps: true, collection: "course_registrations" }
);
CourseRegistrationSchema.index(
  { tenantId: 1, studentId: 1, courseId: 1, academicYear: 1, semester: 1 },
  { unique: true }
);

const BiometricEnrollmentSchema = new Schema(
  {
    _id: idString(),
    tenantId: { type: String, required: true, ref: "Tenant", index: true },
    studentId: { type: String, required: true, ref: "Student" },
    modality: { type: String, enum: ["fingerprint", "face"], default: "fingerprint" },
    fingerCode: { type: String, default: null },
    templateEnc: { type: Buffer, default: null },
    faceEmbedding: { type: Buffer, default: null },
    qualityScore: Number,
    enrolledById: { type: String, ref: "User" },
    enrolledAt: { type: Date, default: () => new Date() },
    templateVersion: { type: String, default: "sourceafis-v1" },
  },
  { collection: "biometric_enrollments" }
);
BiometricEnrollmentSchema.index(
  { studentId: 1, fingerCode: 1 },
  { unique: true, sparse: true }
);
BiometricEnrollmentSchema.index(
  { studentId: 1, modality: 1 },
  { unique: true, partialFilterExpression: { modality: "face" } }
);

const DeviceSchema = new Schema(
  {
    _id: idString(),
    tenantId: { type: String, required: true, ref: "Tenant", index: true },
    name: { type: String, required: true },
    hallLabel: String,
    apiKeyHash: { type: String, required: true },
    lastSeenAt: Date,
  },
  { timestamps: true, collection: "devices" }
);

const ExamSchema = new Schema(
  {
    _id: idString(),
    tenantId: { type: String, required: true, ref: "Tenant", index: true },
    title: { type: String, required: true },
    courseId: { type: String, ref: "Course", default: null },
    academicSessionId: { type: String, ref: "AcademicSession", default: null },
    /** e.g. "2024/2025" — denormalized from session or legacy */
    academicYear: { type: String, default: null },
    /** 1 = first semester, 2 = second */
    semester: { type: Number, default: null, min: 1, max: 2 },
    startsAt: Date,
    endsAt: Date,
  },
  { timestamps: true, collection: "exams" }
);

const ExamRosterEntrySchema = new Schema(
  {
    _id: idString(),
    examId: { type: String, required: true, ref: "Exam", index: true },
    studentId: { type: String, required: true, ref: "Student" },
    hallLabel: String,
  },
  { collection: "exam_roster_entries" }
);
ExamRosterEntrySchema.index({ examId: 1, studentId: 1 }, { unique: true });

const VerificationEventSchema = new Schema(
  {
    _id: idString(),
    tenantId: { type: String, required: true, ref: "Tenant", index: true },
    deviceId: { type: String, ref: "Device" },
    studentId: { type: String, required: true, ref: "Student" },
    /** If mismatch detected, this is the student it actually matched */
    mismatchStudentId: { type: String, ref: "Student" },
    examId: String,
    courseId: { type: String, ref: "Course" },
    academicSessionId: { type: String, ref: "AcademicSession" },
    academicYear: String,
    semester: Number,
    result: { type: String, required: true },
    matchScore: Number,
    modality: { type: String, enum: ["fingerprint", "face"], default: "fingerprint" },
    idempotencyKey: { type: String, sparse: true, unique: true },
    capturedAt: { type: Date, default: () => new Date() },
    syncedAt: Date,
  },
  { collection: "verification_events" }
);
VerificationEventSchema.index({ tenantId: 1, capturedAt: -1 });
VerificationEventSchema.index({ studentId: 1 });
/** Prevent duplicate successful attendance for the same exam (double-spend). */
VerificationEventSchema.index(
  { tenantId: 1, studentId: 1, examId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      result: "match",
      examId: { $exists: true, $nin: [null, ""] },
    },
  }
);

const AuditLogSchema = new Schema(
  {
    _id: idString(),
    tenantId: { type: String, ref: "Tenant" },
    actorId: { type: String, ref: "User" },
    action: { type: String, required: true },
    entityType: String,
    entityId: String,
    meta: Schema.Types.Mixed,
    createdAt: { type: Date, default: () => new Date() },
  },
  { collection: "audit_logs" }
);
AuditLogSchema.index({ tenantId: 1, createdAt: -1 });

// ── LMS schemas ──

const CourseModuleSchema = new Schema(
  {
    _id: idString(),
    tenantId: { type: String, required: true, ref: "Tenant", index: true },
    courseId: { type: String, required: true, ref: "Course", index: true },
    title: { type: String, required: true },
    description: String,
    order: { type: Number, default: 0 },
  },
  { timestamps: true, collection: "course_modules" }
);

const ContentItemSchema = new Schema(
  {
    _id: idString(),
    tenantId: { type: String, required: true, ref: "Tenant", index: true },
    moduleId: { type: String, required: true, ref: "CourseModule", index: true },
    title: { type: String, required: true },
    type: { type: String, enum: ["text","video","pdf","link","quiz-ref","assignment-ref"], required: true },
    body: String,
    url: String,
    mediaType: String,
    duration: Number,
    fileSize: Number,
    order: { type: Number, default: 0 },
    isPublished: { type: Boolean, default: false },
  },
  { timestamps: true, collection: "content_items" }
);

const AssignmentSchema = new Schema(
  {
    _id: idString(),
    tenantId: { type: String, required: true, ref: "Tenant", index: true },
    courseId: { type: String, required: true, ref: "Course", index: true },
    title: { type: String, required: true },
    description: String,
    dueDate: Date,
    maxScore: { type: Number, default: 100 },
    allowLateSubmission: { type: Boolean, default: false },
    attachments: [String],
  },
  { timestamps: true, collection: "lms_assignments" }
);

const QuizSchema = new Schema(
  {
    _id: idString(),
    tenantId: { type: String, required: true, ref: "Tenant", index: true },
    courseId: { type: String, required: true, ref: "Course", index: true },
    title: { type: String, required: true },
    description: String,
    timeLimitMinutes: Number,
    maxScore: { type: Number, default: 100 },
    questions: [
      new Schema(
        {
          text: String,
          type: { type: String, enum: ["multiple-choice","true-false","short-answer"], required: true },
          options: [String],
          correctAnswer: String,
          points: { type: Number, default: 1 },
        },
        { _id: true }
      ),
    ],
    isPublished: { type: Boolean, default: false },
  },
  { timestamps: true, collection: "lms_quizzes" }
);

const QuizAttemptSchema = new Schema(
  {
    _id: idString(),
    tenantId: { type: String, required: true, ref: "Tenant", index: true },
    quizId: { type: String, required: true, ref: "Quiz", index: true },
    studentId: { type: String, required: true, ref: "Student" },
    answers: Schema.Types.Mixed,
    score: Number,
    totalPoints: Number,
    startedAt: Date,
    submittedAt: Date,
  },
  { timestamps: true, collection: "quiz_attempts" }
);

const GradeEntrySchema = new Schema(
  {
    _id: idString(),
    tenantId: { type: String, required: true, ref: "Tenant", index: true },
    courseId: { type: String, required: true, ref: "Course", index: true },
    studentId: { type: String, required: true, ref: "Student" },
    type: { type: String, enum: ["assignment","quiz","exam","participation"], required: true },
    score: { type: Number, required: true },
    maxScore: { type: Number, default: 100 },
    letterGrade: String,
    comments: String,
    gradedById: { type: String, ref: "User" },
    isApproved: { type: Boolean, default: false },
    approvedById: { type: String, ref: "User" },
  },
  { timestamps: true, collection: "grade_entries" }
);
GradeEntrySchema.index({ tenantId: 1, studentId: 1, courseId: 1 });

const AttendanceSessionSchema = new Schema(
  {
    _id: idString(),
    tenantId: { type: String, required: true, ref: "Tenant", index: true },
    courseId: { type: String, required: true, ref: "Course", index: true },
    title: { type: String, required: true },
    date: Date,
    startTime: String,
    endTime: String,
    qrCode: String,
    qrExpiresAt: Date,
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, collection: "attendance_sessions" }
);

const AttendanceRecordSchema = new Schema(
  {
    _id: idString(),
    tenantId: { type: String, required: true, ref: "Tenant", index: true },
    sessionId: { type: String, required: true, ref: "AttendanceSession", index: true },
    studentId: { type: String, required: true, ref: "Student" },
    status: { type: String, enum: ["present","absent","late","excused"], default: "present" },
    checkinTime: Date,
    method: { type: String, enum: ["qr","manual","biometric"], default: "qr" },
  },
  { timestamps: true, collection: "attendance_records" }
);
AttendanceRecordSchema.index({ sessionId: 1, studentId: 1 }, { unique: true });

const DiscussionForumSchema = new Schema(
  {
    _id: idString(),
    tenantId: { type: String, required: true, ref: "Tenant", index: true },
    courseId: { type: String, required: true, ref: "Course", index: true },
    title: { type: String, required: true },
    description: String,
    isLocked: { type: Boolean, default: false },
  },
  { timestamps: true, collection: "discussion_forums" }
);

const DiscussionPostSchema = new Schema(
  {
    _id: idString(),
    tenantId: { type: String, required: true, ref: "Tenant", index: true },
    forumId: { type: String, required: true, ref: "DiscussionForum", index: true },
    authorId: String,
    authorName: String,
    body: { type: String, required: true },
    isPinned: { type: Boolean, default: false },
    parentPostId: { type: String, ref: "DiscussionPost", default: null },
  },
  { timestamps: true, collection: "discussion_posts" }
);

const AnnouncementSchema = new Schema(
  {
    _id: idString(),
    tenantId: { type: String, required: true, ref: "Tenant", index: true },
    courseId: { type: String, required: true, ref: "Course", index: true },
    authorId: { type: String, ref: "User", required: true },
    title: { type: String, required: true },
    body: { type: String, required: true },
  },
  { timestamps: true, collection: "announcements" }
);

const MessageSchema = new Schema(
  {
    _id: idString(),
    tenantId: { type: String, required: true, ref: "Tenant", index: true },
    senderId: { type: String, required: true },
    recipientId: { type: String, required: true, index: true },
    subject: String,
    body: { type: String, required: true },
    isRead: { type: Boolean, default: false },
  },
  { timestamps: true, collection: "messages" }
);
MessageSchema.index({ tenantId: 1, senderId: 1, recipientId: 1 });

const TimetableEntrySchema = new Schema(
  {
    _id: idString(),
    tenantId: { type: String, required: true, ref: "Tenant", index: true },
    courseId: { type: String, required: true, ref: "Course", index: true },
    title: { type: String, required: true },
    dayOfWeek: { type: String, enum: ["mon","tue","wed","thu","fri","sat","sun"], required: true },
    startTime: { type: String, required: true },
    endTime: { type: String, required: true },
    location: String,
    lecturerId: { type: String, ref: "LecturerProfile", default: null },
  },
  { timestamps: true, collection: "timetable_entries" }
);

const StudentProgressSchema = new Schema(
  {
    _id: idString(),
    tenantId: { type: String, required: true, ref: "Tenant", index: true },
    studentId: { type: String, required: true, ref: "Student" },
    courseId: { type: String, required: true, ref: "Course", index: true },
    completedItemIds: [String],
    lastAccessedItemId: String,
    completionPercentage: { type: Number, default: 0 },
  },
  { timestamps: true, collection: "student_progress" }
);
StudentProgressSchema.index({ studentId: 1, courseId: 1 }, { unique: true });

export const Tenant = mongoose.models.Tenant || mongoose.model("Tenant", TenantSchema);
export const User = mongoose.models.User || mongoose.model("User", UserSchema);
export const LecturerProfile =
  mongoose.models.LecturerProfile || mongoose.model("LecturerProfile", LecturerProfileSchema);
export const Faculty = mongoose.models.Faculty || mongoose.model("Faculty", FacultySchema);
export const Department = mongoose.models.Department || mongoose.model("Department", DepartmentSchema);
export const AcademicSession =
  mongoose.models.AcademicSession || mongoose.model("AcademicSession", AcademicSessionSchema);
export const Student = mongoose.models.Student || mongoose.model("Student", StudentSchema);
export const BiometricEnrollment =
  mongoose.models.BiometricEnrollment ||
  mongoose.model("BiometricEnrollment", BiometricEnrollmentSchema);
export const Device = mongoose.models.Device || mongoose.model("Device", DeviceSchema);
export const Course = mongoose.models.Course || mongoose.model("Course", CourseSchema);
export const CourseRegistration =
  mongoose.models.CourseRegistration ||
  mongoose.model("CourseRegistration", CourseRegistrationSchema);
export const Exam = mongoose.models.Exam || mongoose.model("Exam", ExamSchema);
export const ExamRosterEntry =
  mongoose.models.ExamRosterEntry || mongoose.model("ExamRosterEntry", ExamRosterEntrySchema);
export const VerificationEvent =
  mongoose.models.VerificationEvent || mongoose.model("VerificationEvent", VerificationEventSchema);
export const AuditLog = mongoose.models.AuditLog || mongoose.model("AuditLog", AuditLogSchema);

const NotificationSchema = new Schema(
  {
    _id: idString(),
    tenantId: { type: String, required: true, ref: "Tenant", index: true },
    recipientId: { type: String, ref: "User", index: true },
    type: { type: String, enum: ["INAPP", "EMAIL"], default: "INAPP" },
    title: { type: String, required: true },
    message: { type: String, required: true },
    isRead: { type: Boolean, default: false },
    meta: Schema.Types.Mixed,
  },
  { timestamps: true, collection: "notifications" }
);
NotificationSchema.index({ tenantId: 1, createdAt: -1 });

export const Notification = mongoose.models.Notification || mongoose.model("Notification", NotificationSchema);
export const CourseModule = mongoose.models.CourseModule || mongoose.model("CourseModule", CourseModuleSchema);
export const ContentItem = mongoose.models.ContentItem || mongoose.model("ContentItem", ContentItemSchema);
export const Assignment = mongoose.models.Assignment || mongoose.model("Assignment", AssignmentSchema);
export const Quiz = mongoose.models.Quiz || mongoose.model("Quiz", QuizSchema);
export const QuizAttempt = mongoose.models.QuizAttempt || mongoose.model("QuizAttempt", QuizAttemptSchema);
export const GradeEntry = mongoose.models.GradeEntry || mongoose.model("GradeEntry", GradeEntrySchema);
export const AttendanceSession =
  mongoose.models.AttendanceSession || mongoose.model("AttendanceSession", AttendanceSessionSchema);
export const AttendanceRecord =
  mongoose.models.AttendanceRecord || mongoose.model("AttendanceRecord", AttendanceRecordSchema);
export const DiscussionForum =
  mongoose.models.DiscussionForum || mongoose.model("DiscussionForum", DiscussionForumSchema);
export const DiscussionPost =
  mongoose.models.DiscussionPost || mongoose.model("DiscussionPost", DiscussionPostSchema);
export const Announcement = mongoose.models.Announcement || mongoose.model("Announcement", AnnouncementSchema);
export const Message = mongoose.models.Message || mongoose.model("Message", MessageSchema);
export const TimetableEntry =
  mongoose.models.TimetableEntry || mongoose.model("TimetableEntry", TimetableEntrySchema);
export const StudentProgress =
  mongoose.models.StudentProgress || mongoose.model("StudentProgress", StudentProgressSchema);

// ── Payment / Fee schemas ──

const FeeConfigSchema = new Schema(
  {
    _id: idString(),
    tenantId: { type: String, required: true, ref: "Tenant", index: true },
    feeType: {
      type: String,
      enum: ["school_fees", "course_registration", "departmental_dues"],
      required: true,
    },
    label: { type: String, required: true },
    amount: { type: Number, required: true },
    serviceFee: { type: Number, required: true, default: 500 },
    academicSessionId: { type: String, ref: "AcademicSession", default: null },
    level: { type: String, default: null },
    departmentId: { type: String, ref: "Department", default: null },
    facultyId: { type: String, ref: "Faculty", default: null },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, collection: "fee_configs" }
);
FeeConfigSchema.index({ tenantId: 1, feeType: 1, level: 1 });

const InvoiceSchema = new Schema(
  {
    _id: idString(),
    tenantId: { type: String, required: true, ref: "Tenant", index: true },
    studentId: { type: String, required: true, ref: "Student", index: true },
    feeType: {
      type: String,
      enum: ["school_fees", "course_registration", "departmental_dues"],
      required: true,
    },
    amount: { type: Number, required: true },
    serviceFee: { type: Number, required: true },
    totalAmount: { type: Number, required: true },
    status: {
      type: String,
      enum: ["AWAITING_PAYMENT", "COLLECTED", "REMITTING", "REMITTED", "COMPLETE", "FAILED", "EXPIRED"],
      default: "AWAITING_PAYMENT",
      index: true,
    },
    academicSessionId: { type: String, ref: "AcademicSession", default: null },
    academicYear: { type: String, default: null },
    semester: { type: Number, min: 1, max: 2, default: null },
    virtualAccountNumber: { type: String, index: true },
    virtualAccountBank: { type: String },
    pspReference: { type: String, unique: true, sparse: true },
    pspProvider: { type: String, enum: ["paystack", "flutterwave", "monnify"] },
    courseIds: [{ type: String }],
    meta: Schema.Types.Mixed,
    paidAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null },
  },
  { timestamps: true, collection: "invoices" }
);
InvoiceSchema.index({ tenantId: 1, studentId: 1, status: 1 });
InvoiceSchema.index({ pspReference: 1 }, { unique: true, sparse: true });

const PaymentTransactionSchema = new Schema(
  {
    _id: idString(),
    tenantId: { type: String, required: true, ref: "Tenant", index: true },
    invoiceId: { type: String, required: true, ref: "Invoice", index: true },
    amount: { type: Number, required: true },
    direction: {
      type: String,
      enum: ["INBOUND", "OUTBOUND"],
      required: true,
    },
    pspProvider: { type: String, enum: ["paystack", "flutterwave", "monnify", "remita"] },
    pspReference: { type: String },
    gatewayResponse: { type: String },
    status: {
      type: String,
      enum: ["PENDING", "SUCCESS", "FAILED"],
      default: "PENDING",
    },
    remittanceRRR: { type: String },
    idempotencyKey: { type: String, unique: true, sparse: true },
    meta: Schema.Types.Mixed,
  },
  { timestamps: true, collection: "payment_transactions" }
);
PaymentTransactionSchema.index({ invoiceId: 1, createdAt: -1 });
PaymentTransactionSchema.index({ tenantId: 1, createdAt: -1 });

const LedgerEntrySchema = new Schema(
  {
    _id: idString(),
    tenantId: { type: String, required: true, ref: "Tenant", index: true },
    invoiceId: { type: String, required: true, ref: "Invoice", index: true },
    event: {
      type: String,
      enum: ["INVOICE_CREATED", "COLLECTED", "REMITTING", "REMITTED", "COMPLETE", "FAILED", "RETRY", "RECONCILED"],
      required: true,
    },
    amount: { type: Number, required: true },
    previousHash: { type: String, required: true },
    currentHash: { type: String, required: true },
    transactionId: { type: String, ref: "PaymentTransaction", default: null },
    data: Schema.Types.Mixed,
  },
  { timestamps: true, collection: "ledger_entries" }
);
LedgerEntrySchema.index({ invoiceId: 1, createdAt: 1 });
LedgerEntrySchema.index({ tenantId: 1, createdAt: -1 });

const ReceiptSchema = new Schema(
  {
    _id: idString(),
    tenantId: { type: String, required: true, ref: "Tenant", index: true },
    invoiceId: { type: String, required: true, ref: "Invoice" },
    studentId: { type: String, required: true, ref: "Student" },
    receiptNumber: { type: String, required: true, unique: true },
    amount: { type: Number, required: true },
    serviceFee: { type: Number, required: true },
    totalAmount: { type: Number, required: true },
    feeType: { type: String, required: true },
    paymentDate: { type: Date, default: () => new Date() },
    pspReference: { type: String },
    rrrReference: { type: String },
    isDownloaded: { type: Boolean, default: false },
    storagePath: { type: String },
  },
  { timestamps: true, collection: "receipts" }
);
ReceiptSchema.index({ tenantId: 1, studentId: 1, createdAt: -1 });
ReceiptSchema.index({ invoiceId: 1 }, { unique: true });

const FCMTokenSchema = new Schema(
  {
    _id: idString(),
    userId: { type: String, required: true, ref: "User", index: true },
    token: { type: String, required: true },
    deviceType: { type: String, enum: ["android", "ios", "web"] },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, collection: "fcm_tokens" }
);
FCMTokenSchema.index({ userId: 1, token: 1 }, { unique: true });
FCMTokenSchema.index({ token: 1 });

export const FeeConfig = mongoose.models.FeeConfig || mongoose.model("FeeConfig", FeeConfigSchema);
export const Invoice = mongoose.models.Invoice || mongoose.model("Invoice", InvoiceSchema);
export const PaymentTransaction =
  mongoose.models.PaymentTransaction || mongoose.model("PaymentTransaction", PaymentTransactionSchema);
export const LedgerEntry = mongoose.models.LedgerEntry || mongoose.model("LedgerEntry", LedgerEntrySchema);
export const Receipt = mongoose.models.Receipt || mongoose.model("Receipt", ReceiptSchema);
export const FCMToken = mongoose.models.FCMToken || mongoose.model("FCMToken", FCMTokenSchema);

const JobQueueSchema = new Schema(
  {
    _id: idString(),
    type: { type: String, required: true, index: true },
    status: {
      type: String,
      enum: ["PENDING", "PROCESSING", "COMPLETED", "FAILED", "DEAD"],
      default: "PENDING",
      index: true,
    },
    tenantId: { type: String, ref: "Tenant", index: true },
    invoiceId: { type: String, ref: "Invoice", index: true },
    priority: { type: Number, default: 0 },
    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 5 },
    nextAttemptAt: { type: Date, default: () => new Date() },
    lastError: { type: String, default: null },
    data: Schema.Types.Mixed,
    processingStartedAt: Date,
    completedAt: Date,
  },
  { timestamps: true, collection: "job_queue" }
);
JobQueueSchema.index({ status: 1, nextAttemptAt: 1 });

export const JobQueue = mongoose.models.JobQueue || mongoose.model("JobQueue", JobQueueSchema);
