import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function runNpm(args) {
  const npmCli = process.env.npm_execpath;
  if (!npmCli) throw new Error("npm_execpath is not available");
  return execFileSync(process.execPath, [npmCli, ...args], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function fail(message) {
  throw new Error(`Package check failed: ${message}`);
}

const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const packageLock = JSON.parse(
  readFileSync(resolve(root, "package-lock.json"), "utf8"),
);
if (packageJson.version !== packageLock.version) {
  fail(`package.json is ${packageJson.version}, lockfile is ${packageLock.version}`);
}
if (packageJson.version !== packageLock.packages?.[""]?.version) {
  fail("lockfile root package version does not match package.json");
}

const pack = JSON.parse(
  runNpm(["pack", "--dry-run", "--json", "--ignore-scripts"]),
)[0];
if (!pack || !Array.isArray(pack.files)) fail("npm pack returned no file list");

const files = pack.files.map((entry) => entry.path.replaceAll("\\", "/"));
const fileSet = new Set(files);
const required = [
  "LICENSE",
  "README.md",
  "package.json",
  "src/auth.ts",
  "src/config.ts",
  "src/errors.ts",
  "src/fallback-models.ts",
  "src/index.ts",
  "src/model-mapping.ts",
  "src/novita-api.ts",
  "src/status-command.ts",
];
for (const path of required) {
  if (!fileSet.has(path)) fail(`required file is missing: ${path}`);
}

const forbidden = [
  /(^|\/)tests?(\/|$)/i,
  /(^|\/)fixtures?(\/|$)/i,
  /(^|\/)scripts?(\/|$)/i,
  /(^|\/)\.pi(\/|$)/i,
  /(^|\/)coverage(\/|$)/i,
  /(^|\/)(?:dist|tmp|temp)(\/|$)/i,
  /\.log$/i,
  /\.env(?:\.|$)/i,
];
for (const path of files) {
  if (forbidden.some((pattern) => pattern.test(path))) {
    fail(`development artifact is included: ${path}`);
  }
}

const entrypoints = packageJson.pi?.extensions ?? [];
if (entrypoints.length === 0) fail("Pi extension entrypoint is missing");
for (const entrypoint of entrypoints) {
  const normalized = entrypoint.replace(/^\.\//, "").replaceAll("\\", "/");
  if (!fileSet.has(normalized)) fail(`Pi entrypoint is not packed: ${normalized}`);
}

const secretPatterns = [
  /\bnva_[A-Za-z0-9_-]{16,}\b/,
  /\bsk_[A-Za-z0-9_-]{20,}\b/,
  /Authorization\s*[:=]\s*["'`]Bearer\s+[A-Za-z0-9._-]{12,}/i,
];
for (const path of files) {
  const content = readFileSync(resolve(root, path), "utf8");
  if (secretPatterns.some((pattern) => pattern.test(content))) {
    fail(`secret-like value found in ${path}`);
  }
}

console.log(
  JSON.stringify(
    {
      id: pack.id,
      filename: pack.filename,
      entryCount: files.length,
      files,
    },
    null,
    2,
  ),
);
