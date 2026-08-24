import { spawnSync } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const testsDir = resolve(projectRoot, "tests");
const temporaryDir = await mkdtemp(resolve(tmpdir(), "contextfling-tests-"));

try {
  const testFiles = (await readdir(testsDir)).filter((file) =>
    /\.test\.(?:ts|mjs)$/u.test(file),
  );
  const typeScriptTests = testFiles
    .filter((file) => file.endsWith(".ts"))
    .map((file) => resolve(testsDir, file));
  const javaScriptTests = testFiles
    .filter((file) => file.endsWith(".mjs"))
    .map((file) => resolve(testsDir, file));

  await build({
    bundle: true,
    define: {
      "import.meta.url": JSON.stringify(
        pathToFileURL(resolve(testsDir, "bundled.test.ts")).href,
      ),
    },
    entryPoints: typeScriptTests,
    entryNames: "[name]",
    format: "esm",
    outdir: temporaryDir,
    platform: "node",
    sourcemap: "inline",
    target: "node24",
  });

  const bundledTests = typeScriptTests.map((file) =>
    resolve(temporaryDir, file.split("/").at(-1).replace(/\.ts$/u, ".js")),
  );
  const result = spawnSync(
    process.execPath,
    ["--test", ...bundledTests, ...javaScriptTests],
    { cwd: projectRoot, stdio: "inherit" },
  );
  process.exitCode = result.status ?? 1;
} finally {
  await rm(temporaryDir, { recursive: true, force: true });
}
