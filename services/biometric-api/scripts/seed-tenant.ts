/**
 * Seed a tenant and its admin user directly in MongoDB.
 * Usage: pnpm tsx scripts/seed-tenant.ts <tenantName> <tenantSlug> <adminEmail> <adminPassword>
 */
import "../src/loadEnv.js";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { Tenant, User } from "../src/models/schemas.js";
import { Role } from "../src/models/roles.js";

const uri = process.env.MONGODB_URI ?? process.env.DATABASE_URL;

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 4) {
    console.log("Usage: pnpm tsx scripts/seed-tenant.ts <name> <slug> <email> <password>");
    process.exit(1);
  }

  const [name, slug, email, password] = args;

  if (!uri) {
    console.error("Set MONGODB_URI or DATABASE_URL in .env");
    process.exit(1);
  }

  await mongoose.connect(uri);

  // 1. Create Tenant
  const tenant = await Tenant.findOneAndUpdate(
    { slug },
    { $setOnInsert: { name, slug } },
    { upsert: true, new: true }
  );

  console.log(`Tenant created/found: ${tenant.name} (${tenant._id})`);

  // 2. Create Tenant Admin User
  const hash = await bcrypt.hash(password, 12);
  await User.findOneAndUpdate(
    { email },
    {
      $setOnInsert: {
        email,
        passwordHash: hash,
        role: Role.TENANT_ADMIN,
        tenantId: tenant._id,
        displayName: `${name} Admin`,
      },
    },
    { upsert: true }
  );

  console.log(`Tenant Admin seeded: ${email}`);
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
