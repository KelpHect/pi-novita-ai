import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tempRoot = mkdtempSync(join(tmpdir(), "pi-novita-smoke-"));

function runNode(script, args, options = {}) {
  return execFileSync(process.execPath, [script, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
}

function runNpm(args, cwd) {
  const npmCli = process.env.npm_execpath;
  if (!npmCli) throw new Error("npm_execpath is not available");
  return runNode(npmCli, args, { cwd });
}

try {
  const pack = JSON.parse(
    runNpm(
      [
        "pack",
        "--json",
        "--ignore-scripts",
        "--pack-destination",
        tempRoot,
      ],
      root,
    ),
  )[0];
  const tarball = join(tempRoot, pack.filename);
  const consumer = join(tempRoot, "consumer");
  mkdirSync(consumer);
  writeFileSync(
    join(consumer, "package.json"),
    JSON.stringify({ name: "pi-novita-smoke", private: true }, null, 2),
  );
  runNpm(
    [
      "install",
      "--ignore-scripts",
      "--omit=dev",
      "--legacy-peer-deps",
      tarball,
    ],
    consumer,
  );

  const installed = join(consumer, "node_modules", "pi-novita-ai");
  const packageJson = JSON.parse(readFileSync(join(installed, "package.json"), "utf8"));
  const entrypoint = resolve(installed, packageJson.pi.extensions[0]);
  const runner = join(tempRoot, "load-packed-extension.mts");
  writeFileSync(
    runner,
    `import assert from "node:assert/strict";\n` +
      `globalThis.fetch = async () => { throw new Error("offline smoke"); };\n` +
      `const module = await import(${JSON.stringify(pathToFileURL(entrypoint).href)});\n` +
      `let provider; let command = false; let handler = false;\n` +
      `const pi = {\n` +
      `  registerProvider(id, config) { assert.equal(id, "novita"); provider = config; },\n` +
      `  registerCommand(name) { if (name === "novita") command = true; },\n` +
      `  on(name) { if (name === "message_end") handler = true; },\n` +
      `};\n` +
      `await module.default(pi);\n` +
      `assert.ok(provider); assert.equal(provider.api, "openai-completions");\n` +
      `assert.ok(provider.models.length > 0); assert.ok(command); assert.ok(handler);\n` +
      `console.log(JSON.stringify({ models: provider.models.length, command, handler }));\n`,
  );

  const tsxCli = resolve(root, "node_modules", "tsx", "dist", "cli.mjs");
  const fakeLoad = runNode(tsxCli, [runner], { cwd: root }).trim();

  const piCli = resolve(
    root,
    "node_modules",
    "@earendil-works",
    "pi-coding-agent",
    "dist",
    "cli.js",
  );
  const listed = runNode(
    piCli,
    ["--offline", "-e", installed, "--list-models", "novita"],
    {
      cwd: consumer,
      env: {
        ...process.env,
        NOVITA_API_KEY: "offline-smoke-placeholder",
        PI_CODING_AGENT_DIR: join(tempRoot, "pi-home"),
      },
    },
  );
  if (!/^novita\s+\S+/m.test(listed)) {
    throw new Error(
      `Pi did not list any model from the packed extension. Output: ${listed.slice(0, 1000)}`,
    );
  }

  console.log(
    JSON.stringify(
      {
        nodeVersion: process.version,
        tarball: pack.filename,
        shasum: pack.shasum,
        integrity: pack.integrity,
        packedSize: pack.size,
        unpackedSize: pack.unpackedSize,
        installedEntrypoint: packageJson.pi.extensions[0],
        fakeLoad: JSON.parse(fakeLoad),
        piListedProvider: true,
      },
      null,
      2,
    ),
  );
} finally {
  const expectedPrefix = join(tmpdir(), "pi-novita-smoke-");
  if (!tempRoot.startsWith(expectedPrefix)) {
    throw new Error(`Refusing to remove unexpected path: ${tempRoot}`);
  }
  rmSync(tempRoot, { recursive: true, force: true });
}
