import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
const DOS_TIME = 0;
const DOS_DATE = 0x21;
const UINT16_MAX = 0xffff;
const UINT32_MAX = 0xffffffff;

function assertZipUInt16(value, label) {
  if (!Number.isInteger(value) || value < 0 || value > UINT16_MAX) {
    throw new Error(`${label} is too large for a ZIP archive.`);
  }
}

function assertZipUInt32(value, label) {
  if (!Number.isInteger(value) || value < 0 || value > UINT32_MAX) {
    throw new Error(`${label} is too large for a ZIP archive.`);
  }
}

function crc32(data) {
  let crc = UINT32_MAX;

  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }

  return (crc ^ UINT32_MAX) >>> 0;
}

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

function createLocalHeader(name, data) {
  const header = Buffer.alloc(30);
  const checksum = crc32(data);

  assertZipUInt16(name.length, "ZIP entry name length");
  assertZipUInt32(data.length, "ZIP entry size");

  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(DOS_TIME, 10);
  header.writeUInt16LE(DOS_DATE, 12);
  header.writeUInt32LE(checksum, 14);
  header.writeUInt32LE(data.length, 18);
  header.writeUInt32LE(data.length, 22);
  header.writeUInt16LE(name.length, 26);
  header.writeUInt16LE(0, 28);

  return { checksum, header };
}

function createCentralHeader(entry) {
  const header = Buffer.alloc(46);

  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(DOS_TIME, 12);
  header.writeUInt16LE(DOS_DATE, 14);
  header.writeUInt32LE(entry.checksum, 16);
  header.writeUInt32LE(entry.data.length, 20);
  header.writeUInt32LE(entry.data.length, 24);
  header.writeUInt16LE(entry.name.length, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(0, 38);
  header.writeUInt32LE(entry.offset, 42);

  return header;
}

function createZip(files) {
  const localChunks = [];
  const entries = [];
  let offset = 0;

  for (const file of files) {
    const name = Buffer.from(file.path, "utf8");
    const { checksum, header } = createLocalHeader(name, file.data);

    assertZipUInt32(offset, "ZIP local entry offset");
    entries.push({
      checksum,
      data: file.data,
      name,
      offset,
    });
    localChunks.push(header, name, file.data);
    offset += header.length + name.length + file.data.length;
  }

  assertZipUInt16(entries.length, "ZIP entry count");
  const centralDirectory = entries.flatMap((entry) => [
    createCentralHeader(entry),
    entry.name,
  ]);
  const centralOffset = offset;
  const centralSize = centralDirectory.reduce(
    (size, chunk) => size + chunk.length,
    0,
  );
  assertZipUInt32(centralOffset, "ZIP central directory offset");
  assertZipUInt32(centralSize, "ZIP central directory size");

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(centralOffset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localChunks, ...centralDirectory, end]);
}

function runBuild() {
  const command = process.platform === "win32" ? "npm.cmd" : "npm";

  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, ["run", "build"], {
      cwd: projectRoot,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolvePromise();
      } else {
        reject(
          new Error(
            `Build failed${signal === null ? ` with exit code ${code}` : ` after ${signal}`}.`,
          ),
        );
      }
    });
  });
}

async function main() {
  await runBuild();
  await assertDistLayout();
  const version = await assertVersionsMatch();
  const files = await readReleaseFiles();
  const archive = createZip(files);
  const archivePath = resolve(releaseDir, `contextfling-v${version}.zip`);
  const checksumPath = `${archivePath}.sha256`;

  await mkdir(releaseDir, { recursive: true });
  await writeFile(archivePath, archive);

  const digest = createHash("sha256").update(archive).digest("hex");
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
  assertVersionsMatch,
  createZip,
  inspectDistDirectory,
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
