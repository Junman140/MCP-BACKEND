/**
 * Run SourceAFIS matching JAR; build with Maven once if target JAR is missing.
 * Requires JDK 17+ and Maven on PATH (or JAVA_HOME for java.exe).
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const matchingDir = path.join(root, "services", "matching-java");
const jar = path.join(matchingDir, "target", "matching-service-0.1.0.jar");

function resolveJava() {
  const isWin = process.platform === "win32";
  const exe = isWin ? "java.exe" : "java";
  const home = process.env.JAVA_HOME;
  if (home) {
    const p = path.join(home, "bin", exe);
    if (existsSync(p)) return p;
  }
  return "java";
}

function resolveMvn() {
  // Windows Apache Maven installs `mvn.cmd` in PATH; `mvn` alone often fails in Node spawns.
  return process.platform === "win32" ? "mvn.cmd" : "mvn";
}

function run(cmd, args, opts) {
  return spawnSync(cmd, args, {
    cwd: matchingDir,
    stdio: "inherit",
    shell: true,
    ...opts,
  });
}

if (!existsSync(jar)) {
  console.log("[match] Building matching-service JAR (first run)…");
  const mvn = resolveMvn();
  const mvnRun = run(mvn, ["-q", "-DskipTests", "package"]);
  if (mvnRun.status !== 0) {
    console.error(
      "[match] Maven build failed. Check JDK 17+ and Maven; on Windows use `mvn.cmd` on PATH or run from a Developer shell."
    );
    console.error(
      "[match] Manual build: cd services/matching-java && mvn -DskipTests package"
    );
    process.exit(mvnRun.status ?? 1);
  }
}

const java = resolveJava();
const jarRel = "target/matching-service-0.1.0.jar";
const runJava = run(java, ["-jar", jarRel]);
process.exit(runJava.status ?? 0);
