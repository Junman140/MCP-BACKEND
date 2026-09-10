import PDFDocument from "pdfkit";
import { PassThrough } from "node:stream";
import { Client as MinioClient } from "minio";
import path from "node:path";
import { Receipt, Invoice } from "../models/schemas.js";

function getMinioClient(): MinioClient | null {
  const endpoint = process.env.MINIO_ENDPOINT;
  const accessKey = process.env.MINIO_ACCESS_KEY;
  const secretKey = process.env.MINIO_SECRET_KEY;
  if (!endpoint || !accessKey || !secretKey) return null;

  return new MinioClient({
    endPoint: endpoint.replace(/^https?:\/\//, "").split(":")[0],
    port: endpoint.includes(":") ? parseInt(endpoint.split(":")[2] || "9000", 10) : 9000,
    useSSL: endpoint.startsWith("https://"),
    accessKey,
    secretKey,
  });
}

function generateReceiptNumber(): string {
  const prefix = "RCP";
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `${prefix}-${timestamp}-${random}`;
}

async function buildPdfBuffer(args: {
  receiptNumber: string;
  invoiceId: string;
  studentName: string;
  matricNo: string;
  feeType: string;
  amount: number;
  serviceFee: number;
  totalAmount: number;
  paymentDate: Date;
  pspReference?: string;
  rrrReference?: string;
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks: Buffer[] = [];
    const stream = new PassThrough();

    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
    doc.pipe(stream);

    doc.fontSize(20).font("Helvetica-Bold").text("PAYMENT RECEIPT", { align: "center" });
    doc.moveDown(0.5);
    doc.fontSize(10).font("Helvetica").text(`Receipt #: ${args.receiptNumber}`, { align: "center" });
    doc.moveDown(0.5);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
    doc.moveDown(1);

    doc.font("Helvetica-Bold").fontSize(11);
    doc.text("Student Details");
    doc.moveDown(0.3);
    doc.font("Helvetica").fontSize(10);
    doc.text(`Name: ${args.studentName}`);
    doc.text(`Matric Number: ${args.matricNo}`);
    doc.moveDown(0.5);

    doc.font("Helvetica-Bold").fontSize(11);
    doc.text("Payment Details");
    doc.moveDown(0.3);
    doc.font("Helvetica").fontSize(10);
    const feeLabel = args.feeType.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    doc.text(`Type: ${feeLabel}`);
    doc.text(`Date: ${args.paymentDate.toLocaleDateString("en-NG", { year: "numeric", month: "long", day: "numeric" })}`);
    if (args.pspReference) doc.text(`Payment Reference: ${args.pspReference}`);
    if (args.rrrReference) doc.text(`RRR Reference: ${args.rrrReference}`);
    doc.moveDown(0.5);

    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
    doc.moveDown(0.5);

    const col1 = 50;
    const col2 = 350;
    const startY = doc.y;

    doc.font("Helvetica").fontSize(10);
    doc.text("Description", col1, startY);
    doc.text("Amount (NGN)", col2, startY, { width: 150, align: "right" });
    doc.moveDown(0.5);

    doc.text("Tuition / Fee", col1);
    doc.text(`₦${args.amount.toLocaleString()}`, col2, doc.y - 12, { width: 150, align: "right" });
    doc.moveDown(0.3);

    doc.text("Payment Processing Fee", col1);
    doc.text(`₦${args.serviceFee.toLocaleString()}`, col2, doc.y - 12, { width: 150, align: "right" });
    doc.moveDown(0.5);

    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
    doc.moveDown(0.3);

    doc.font("Helvetica-Bold");
    doc.text("Total", col1);
    doc.text(`₦${args.totalAmount.toLocaleString()}`, col2, doc.y - 12, { width: 150, align: "right" });
    doc.moveDown(2);

    doc.font("Helvetica").fontSize(9);
    doc.text("This is a computer-generated receipt and does not require a signature.", 50, doc.y, { align: "center" });
    doc.moveDown(0.3);
    doc.text(`Generated: ${new Date().toISOString()}`, 50, doc.y, { align: "center" });

    doc.end();
  });
}

async function uploadToMinio(bucket: string, objectName: string, buffer: Buffer) {
  const minio = getMinioClient();
  if (!minio) {
    console.warn("[Receipt] MinIO not configured, skipping upload");
    return `file://receipts/${objectName}`;
  }

  const bucketName = bucket || process.env.MINIO_BUCKET || "lms-content";
  const exists = await minio.bucketExists(bucketName);
  if (!exists) {
    await minio.makeBucket(bucketName);
  }

  await minio.putObject(bucketName, objectName, buffer, buffer.length, {
    "Content-Type": "application/pdf",
  });

  return `${bucketName}/${objectName}`;
}

export async function generateReceipt(args: {
  tenantId: string;
  invoice: Record<string, any>;
  rrrReference?: string;
}) {
  const invoice = args.invoice;
  const { Student } = await import("../models/schemas.js");
  const student = await Student.findById(invoice.studentId);
  if (!student) throw new Error(`Student ${invoice.studentId} not found`);

  const receiptNumber = generateReceiptNumber();

  const pdfBuffer = await buildPdfBuffer({
    receiptNumber,
    invoiceId: invoice._id,
    studentName: student.fullName,
    matricNo: student.matricNo,
    feeType: invoice.feeType,
    amount: invoice.amount,
    serviceFee: invoice.serviceFee,
    totalAmount: invoice.totalAmount,
    paymentDate: invoice.paidAt ?? new Date(),
    pspReference: invoice.pspReference,
    rrrReference: args.rrrReference,
  });

  const objectName = `receipts/${args.tenantId}/${invoice._id}/${receiptNumber}.pdf`;
  const storagePath = await uploadToMinio("lms-content", objectName, pdfBuffer);

  return Receipt.create({
    tenantId: args.tenantId,
    invoiceId: invoice._id,
    studentId: invoice.studentId,
    receiptNumber,
    amount: invoice.amount,
    serviceFee: invoice.serviceFee,
    totalAmount: invoice.totalAmount,
    feeType: invoice.feeType,
    paymentDate: invoice.paidAt ?? new Date(),
    pspReference: invoice.pspReference,
    rrrReference: args.rrrReference ?? undefined,
    storagePath,
  });
}

export async function getReceiptPdf(receiptId: string) {
  const receipt = await Receipt.findById(receiptId);
  if (!receipt) return null;

  const minio = getMinioClient();
  if (!minio) return null;

  const [bucketName, ...parts] = receipt.storagePath?.split("/") ?? [];
  const objectName = parts.join("/");

  try {
    const stream = await minio.getObject(bucketName, objectName);
    return stream;
  } catch {
    return null;
  }
}
