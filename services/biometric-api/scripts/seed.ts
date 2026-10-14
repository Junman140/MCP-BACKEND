/**
 * Seed super admin user (MongoDB). Run: pnpm --filter @bio/api run seed
 */
import "../src/loadEnv.js";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { User } from "../src/models/schemas.js";
import { Role } from "../src/models/roles.js";

const uri = process.env.MONGODB_URI ?? process.env.DATABASE_URL;
if (!uri) {
  console.error("Set MONGODB_URI or DATABASE_URL");
  process.exit(1);
}

async function main() {
  await mongoose.connect(uri);
  const email = process.env.SEED_SUPER_EMAIL;
  const password = process.env.SEED_SUPER_PASSWORD;
  if (!email || !password) {
    if (process.env.NODE_ENV === "production") {
      console.error("SEED_SUPER_EMAIL and SEED_SUPER_PASSWORD must be set when NODE_ENV=production");
      process.exit(1);
    }
    console.warn("SEED_SUPER_* not set — falling back to insecure dev defaults (never do this in production)");
  }
  const seedEmail = email ?? "super@example.edu";
  const seedPassword = password ?? "ChangeMe123!";
  const hash = await bcrypt.hash(seedPassword, 12);
  await User.findOneAndUpdate(
    { email },
    {
      $setOnInsert: {
        email,
        passwordHash: hash,
        role: Role.SUPER_ADMIN,
        displayName: "Super Admin",
      },
    },
    { upsert: true }
  );
  console.log(`Seeded SUPER_ADMIN ${email}`);
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
