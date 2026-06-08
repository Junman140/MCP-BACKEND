import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./crypto.js";
const cachePath = () => path.join(dataDir(), "exam-package.json");
export function readCache() {
    const p = cachePath();
    if (!fs.existsSync(p))
        return null;
    return JSON.parse(fs.readFileSync(p, "utf8"));
}
export function writeCache(pkg) {
    const full = { ...pkg, syncedAt: new Date().toISOString() };
    fs.writeFileSync(cachePath(), JSON.stringify(full, null, 2), "utf8");
}
