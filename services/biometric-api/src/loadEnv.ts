/**
 * Load `apps/api/.env` regardless of process cwd (e.g. when running from monorepo root).
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const here = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.join(here, "..");
dotenv.config({ path: path.join(apiRoot, ".env") });
