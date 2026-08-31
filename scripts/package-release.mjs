import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdir,
  readdir,
  readFile,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { findSecretMatches } from "./check-secrets.mjs";

const execFileAsync = promisify(execFile);
const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sourceManifestPath = resolve(projectRoot, "src/manifest.json");
const distDir = resolve(projectRoot, "dist");
const packageJsonPath = resolve(projectRoot, "package.json");
const releaseDir = resolve(projectRoot, "release");

const RELEASE_FILES = [
  "manifest.json",
  "offscreen.js",
  "offscreen.html",
  "service-worker.js",
  "settings/settings.css",
  "settings/settings.html",
  "settings/settings.js",
];
const RELEASE_DIRECTORIES = ["settings"];
const FIXED_MTIME = new Date("1980-01-01T00:00:00.000Z");

async function readJson(path, label) {
  let text;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    throw new Error(
      `Could not read ${label}: ${error instanceof Error ? error.message : error}`,
    );
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(
      `Could not parse ${label}: ${error instanceof Error ? error.message : error}`,
    );
  }
}

async function inspectDistDirectory(directory, prefix = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  const directories = [];

  for (const entry of entries) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      directories.push(relativePath);
      const nested = await inspectDistDirectory(
        resolve(directory, entry.name),
        relativePath,
      );
      files.push(...nested.files);
      directories.push(...nested.directories);
    } else if (entry.isFile()) {
      files.push(relativePath);
    } else {
      throw new Error(
        `dist contains a non-regular entry that cannot be packaged: ${relativePath}`,
      );
    }
  }

  return { files, directories };
}

function comparePathSets(actual, expected) {
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  return {
    missing: expected.filter((path) => !actualSet.has(path)),
    unexpected: actual.filter((path) => !expectedSet.has(path)),
  };
}

async function assertDistLayout() {
  let inspection;
  try {
    inspection = await inspectDistDirectory(distDir);
  } catch (error) {
    throw new Error(
      `Could not inspect dist: ${error instanceof Error ? error.message : error}`,
    );
  }

  const files = [...inspection.files].sort();
  const directories = [...inspection.directories].sort();
  const fileDifferences = comparePathSets(files, RELEASE_FILES);
  const directoryDifferences = comparePathSets(
    directories,
    RELEASE_DIRECTORIES,
  );
  const problems = [];

  if (fileDifferences.missing.length > 0) {
    problems.push(`missing file(s): ${fileDifferences.missing.join(", ")}`);
  }
  if (fileDifferences.unexpected.length > 0) {
    problems.push(
      `unexpected file(s): ${fileDifferences.unexpected.join(", ")}`,
    );
  }
  if (directoryDifferences.missing.length > 0) {
    problems.push(
      `missing directory(ies): ${directoryDifferences.missing.join(", ")}`,
    );
  }
  if (directoryDifferences.unexpected.length > 0) {
    problems.push(
      `unexpected directory(ies): ${directoryDifferences.unexpected.join(", ")}`,
    );
  }

  if (problems.length > 0) {
    throw new Error(
      `dist layout is not release-safe (${problems.join("; ")}).`,
    );
  }
}

function getVersion(value, label) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.trim() !== value ||
    value.includes("/") ||
    value.includes("\\")
  ) {
    throw new Error(`${label} must contain a safe, non-empty version string.`);
  }
  return value;
}

async function assertVersionsMatch() {
  const packageJson = await readJson(packageJsonPath, "package.json");
  const packageVersion = getVersion(
    packageJson.version,
    "package.json version",
  );
  const sourceManifest = await readJson(
    sourceManifestPath,
    "src/manifest.json",
  );
  const sourceVersion = getVersion(
    sourceManifest.version,
    "src/manifest.json version",
  );
  const distManifest = await readJson(
    resolve(distDir, "manifest.json"),
    "dist/manifest.json",
  );
  const distVersion = getVersion(
    distManifest.version,
    "dist/manifest.json version",
  );

  if (packageVersion !== sourceVersion || packageVersion !== distVersion) {
    throw new Error(
      `Version mismatch: package.json=${packageVersion}, src/manifest.json=${sourceVersion}, dist/manifest.json=${distVersion}.`,
    );
  }

  return packageVersion;
}

async function readReleaseFiles() {
  const files = [];

  for (const relativePath of RELEASE_FILES) {
    files.push({
      data: await readFile(resolve(distDir, relativePath)),
      path: relativePath,
    });
  }

  return files;
}

function findReleaseSecretMatches(files) {
  const findings = [];

  for (const file of files) {
    if (file.data.includes(0)) continue;

    const text = file.data.toString("utf8");
    for (const match of findSecretMatches(text)) {
      findings.push({
        detector: match.detector,
        line: match.line,
        path: file.path,
      });
    }
  }

  return findings;
}

function assertReleaseFilesHaveNoSecrets(files) {
  const findings = findReleaseSecretMatches(files);
  if (findings.length === 0) return;

  const details = findings
    .map((finding) => `${finding.path}:${finding.line} (${finding.detector})`)
    .join(", ");
  throw new Error(
    `Release secret scan failed: ${findings.length} finding(s): ${details}`,
  );
}

async function runCommand(command, args, options = {}) {
  const {
    cwd = projectRoot,
    description = command,
    env = process.env,
  } = options;

  try {
    await execFileAsync(command, args, {
      cwd,
      env,
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (error) {
    const details =
      error &&
      typeof error === "object" &&
      "stderr" in error &&
      typeof error.stderr === "string"
        ? error.stderr.trim()
        : error instanceof Error
          ? error.message
          : String(error);
    throw new Error(`${description} failed${details ? `: ${details}` : "."}`);
  }
}

function runBuild() {
  const command = process.platform === "win32" ? "npm.cmd" : "npm";
  return runCommand(command, ["run", "build"], { description: "Build" });
}

async function createReleaseZip(archivePath) {
  await Promise.all(
    RELEASE_FILES.map((relativePath) =>
      utimes(resolve(distDir, relativePath), FIXED_MTIME, FIXED_MTIME),
    ),
  );

  await runCommand("zip", ["-X", "-0", "-q", archivePath, ...RELEASE_FILES], {
    cwd: distDir,
    description:
      "Release ZIP creation with Info-ZIP zip (install zip on macOS/Linux and ensure it is on PATH)",
    env: { ...process.env, TZ: "UTC" },
  });
}

async function main() {
  await runBuild();
  await assertDistLayout();
  const version = await assertVersionsMatch();
  const files = await readReleaseFiles();
  assertReleaseFilesHaveNoSecrets(files);
  const archivePath = resolve(releaseDir, `contextfling-v${version}.zip`);
  const checksumPath = `${archivePath}.sha256`;

  await mkdir(releaseDir, { recursive: true });
  await rm(archivePath, { force: true });
  await rm(checksumPath, { force: true });
  await createReleaseZip(archivePath);

  const digest = createHash("sha256")
    .update(await readFile(archivePath))
    .digest("hex");
  await writeFile(checksumPath, `${digest}  ${basename(archivePath)}\n`);
  console.log(`Release ZIP: ${archivePath}`);
  console.log("Contents:");
  for (const file of files) {
    console.log(`- ${file.path} (${file.data.length} bytes)`);
  }
  console.log(`SHA-256: ${digest}`);
  console.log(`Checksum file: ${checksumPath}`);
}

export {
  assertDistLayout,
  assertReleaseFilesHaveNoSecrets,
  assertVersionsMatch,
  findReleaseSecretMatches,
};

const invokedPath =
  process.argv[1] === undefined ? "" : resolve(process.argv[1]);
if (invokedPath === fileURLToPath(import.meta.url)) {
  await main().catch((error) => {
    console.error(
      `Release packaging failed: ${error instanceof Error ? error.message : error}`,
    );
    process.exitCode = 1;
  });
}
