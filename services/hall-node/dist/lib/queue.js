import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./crypto.js";
const queueFile = () => path.join(dataDir(), "pending-events.jsonl");
export function appendPending(ev) {
    fs.appendFileSync(queueFile(), `${JSON.stringify(ev)}\n`, "utf8");
}
export function readPending() {
    const f = queueFile();
    if (!fs.existsSync(f))
        return [];
    return fs
        .readFileSync(f, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
}
export function clearPending() {
    const f = queueFile();
    if (fs.existsSync(f))
        fs.unlinkSync(f);
}
