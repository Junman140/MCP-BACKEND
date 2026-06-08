import { Notification, Student, User } from "../models/schemas.js";
import nodemailer from "nodemailer";

export async function createInAppNotification(args: {
  tenantId: string;
  recipientId?: string;
  title: string;
  message: string;
  meta?: any;
}) {
  return await Notification.create({
    ...args,
    type: "INAPP",
  });
}

export async function sendEmailNotification(args: {
  tenantId: string;
  to: string;
  subject: string;
  text: string;
}) {
  // SMTP Configuration from env
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || "587");
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM || "noreply@mcp-biometric.com";

  if (!host || !user || !pass) {
    console.warn("[Email] SMTP not configured, skipping email to", args.to);
    return;
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });

  try {
    await transporter.sendMail({
      from,
      to: args.to,
      subject: args.subject,
      text: args.text,
    });
    console.log("[Email] Sent successfully to", args.to);
  } catch (err) {
    console.error("[Email] Failed to send email:", err);
  }
}

export async function notifyMismatch(args: {
  tenantId: string;
  claimedStudentId: string;
  actualStudentId: string;
  deviceId?: string;
  examId?: string;
}) {
  const [claimed, actual] = await Promise.all([
    Student.findById(args.claimedStudentId),
    Student.findById(args.actualStudentId),
  ]);

  if (!claimed || !actual) return;

  const title = "⚠️ Biometric Mismatch Detected";
  const message = `Student ${actual.fullName} (${actual.matricNo}) attempted to verify as ${claimed.fullName} (${claimed.matricNo}) ${args.examId ? `for exam ${args.examId}` : ""}.`;

  // 1. Create In-App Notifications for Admins
  const admins = await User.find({ 
    tenantId: args.tenantId, 
    role: { $in: ["SUPER_ADMIN", "TENANT_ADMIN"] } 
  });

  for (const admin of admins) {
    await createInAppNotification({
      tenantId: args.tenantId,
      recipientId: admin._id,
      title,
      message,
      meta: { ...args, claimedMatric: claimed.matricNo, actualMatric: actual.matricNo },
    });
  }

  // 2. Send Email if configured (to an admin email or the claimed student's email)
  // For now, let's send to a configured admin email
  const adminEmail = process.env.ADMIN_ALERT_EMAIL;
  if (adminEmail) {
    await sendEmailNotification({
      tenantId: args.tenantId,
      to: adminEmail,
      subject: title,
      text: message,
    });
  }
}
