import mongoose from "mongoose";
import "../models/schemas.js";

let connecting: Promise<typeof mongoose> | null = null;

export async function connectDb(): Promise<void> {
  const uri = process.env.MONGODB_URI ?? process.env.DATABASE_URL;
  if (!uri) {
    throw new Error("Set MONGODB_URI (or DATABASE_URL) to a MongoDB connection string");
  }
  if (mongoose.connection.readyState === 1) return;
  if (!connecting) {
    connecting = mongoose.connect(uri);
  }
  await connecting;
}
