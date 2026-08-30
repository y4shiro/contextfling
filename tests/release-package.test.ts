import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const releaseDirectory = resolve(projectRoot, "release");
const expectedEntryNames = [
  "manifest.json",
  "offscreen.js",
  "offscreen.html",
  "service-worker.js",
  "settings/settings.css",
  "settings/settings.html",
  "settings/settings.js",
];
const expectedDosTime = 0;
const expectedDosDate = 0x21;

type ReleaseFile = {
  data: Buffer;
  path: string;
};

type ReleaseSecretFinding = {
  detector: string;
  line: number;
  path: string;
};

type PackageReleaseModule = {
  assertDistLayout: () => Promise<void>;
  assertReleaseFilesHaveNoSecrets: (files: ReleaseFile[]) => void;
  assertVersionsMatch: () => Promise<string>;
  findReleaseSecretMatches: (files: ReleaseFile[]) => ReleaseSecretFinding[];
};

const {
  assertDistLayout,
  assertReleaseFilesHaveNoSecrets,
  assertVersionsMatch,
  findReleaseSecretMatches,
} = (await import(
  resolve(projectRoot, "scripts/package-release.mjs")
)) as PackageReleaseModule;

type LocalEntry = {
  compressedSize: number;
  crc: number;
  data: Buffer;
  flags: number;
  method: number;
  name: string;
  offset: number;
  time: number;
  date: number;
  uncompressedSize: number;
};

type CentralEntry = {
  compressedSize: number;
  crc: number;
  date: number;
  flags: number;
  localOffset: number;
  method: number;
  name: string;
  time: number;
  uncompressedSize: number;
};

type ParsedZip = {
  centralEntries: CentralEntry[];
  localEntries: LocalEntry[];
};

function assertRange(
  archive: Buffer,
  offset: number,
  length: number,
  label: string,
): void {
  assert.ok(
    Number.isInteger(offset) &&
      Number.isInteger(length) &&
      offset >= 0 &&
      length >= 0 &&
      offset + length <= archive.length,
    `${label} is outside the ZIP archive`,
  );
}

function readUInt16(archive: Buffer, offset: number, label: string): number {
  assertRange(archive, offset, 2, label);
  return archive.readUInt16LE(offset);
}

function readUInt32(archive: Buffer, offset: number, label: string): number {
  assertRange(archive, offset, 4, label);
  return archive.readUInt32LE(offset);
}

function readEntryName(
  archive: Buffer,
  offset: number,
  length: number,
  label: string,
): string {
  assertRange(archive, offset, length, label);
  const nameBytes = archive.subarray(offset, offset + length);
  const name = nameBytes.toString("utf8");
  assert.deepEqual(
    Buffer.from(name, "utf8"),
    nameBytes,
    `${label} is not UTF-8`,
  );
  return name;
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff;

  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function findEndOfCentralDirectory(archive: Buffer): number {
  const minimumOffset = Math.max(0, archive.length - 22 - 0xffff);

  for (let offset = archive.length - 22; offset >= minimumOffset; offset -= 1) {
    if (
      offset < 0 ||
      readUInt32(archive, offset, "EOCD signature") !== 0x06054b50
    ) {
      continue;
    }

    const commentLength = readUInt16(
      archive,
      offset + 20,
      "EOCD comment length",
    );
    if (offset + 22 + commentLength === archive.length) {
      return offset;
    }
  }

  assert.fail("ZIP end of central directory record was not found");
}

function parseLocalEntries(
  archive: Buffer,
  centralOffset: number,
): LocalEntry[] {
  const entries: LocalEntry[] = [];
  let offset = 0;

  while (offset < centralOffset) {
    assertRange(archive, offset, 30, "local header");
    assert.equal(
      readUInt32(archive, offset, "local header signature"),
      0x04034b50,
      `unexpected local header signature at offset ${offset}`,
    );

    const flags = readUInt16(archive, offset + 6, "local flags");
    const method = readUInt16(archive, offset + 8, "local compression method");
    const time = readUInt16(archive, offset + 10, "local modification time");
    const date = readUInt16(archive, offset + 12, "local modification date");
    const crc = readUInt32(archive, offset + 14, "local CRC-32");
    const compressedSize = readUInt32(
      archive,
      offset + 18,
      "local compressed size",
    );
    const uncompressedSize = readUInt32(
      archive,
      offset + 22,
      "local uncompressed size",
    );
    const nameLength = readUInt16(archive, offset + 26, "local name length");
    const extraLength = readUInt16(archive, offset + 28, "local extra length");
    const name = readEntryName(
      archive,
      offset + 30,
      nameLength,
      "local entry name",
    );
    const dataOffset = offset + 30 + nameLength + extraLength;
    assertRange(archive, dataOffset, compressedSize, "local entry data");
    const data = archive.subarray(dataOffset, dataOffset + compressedSize);

    assert.equal(flags, 0, `${name} must not use ZIP data descriptors`);
    assert.equal(method, 0, `${name} must use ZIP store compression`);
    assert.equal(
      compressedSize,
      uncompressedSize,
      `${name} must have equal compressed and uncompressed sizes`,
    );
    assert.equal(crc32(data), crc, `${name} has an invalid local CRC-32`);

    entries.push({
      compressedSize,
      crc,
      data,
      flags,
      method,
      name,
      offset,
      time,
      date,
      uncompressedSize,
    });
    offset = dataOffset + compressedSize;
  }

  assert.equal(
    offset,
    centralOffset,
    "local entries must end at central directory",
  );
  return entries;
}

function parseCentralEntries(
  archive: Buffer,
  centralOffset: number,
  centralSize: number,
  count: number,
): CentralEntry[] {
  const entries: CentralEntry[] = [];
  let offset = centralOffset;
  const centralEnd = centralOffset + centralSize;
  assertRange(archive, centralOffset, centralSize, "central directory");

  for (let index = 0; index < count; index += 1) {
    assertRange(archive, offset, 46, "central directory header");
    assert.equal(
      readUInt32(archive, offset, "central directory signature"),
      0x02014b50,
      `unexpected central directory signature at offset ${offset}`,
    );

    const flags = readUInt16(archive, offset + 8, "central flags");
    const method = readUInt16(
      archive,
      offset + 10,
      "central compression method",
    );
    const time = readUInt16(archive, offset + 12, "central modification time");
    const date = readUInt16(archive, offset + 14, "central modification date");
    const crc = readUInt32(archive, offset + 16, "central CRC-32");
    const compressedSize = readUInt32(
      archive,
      offset + 20,
      "central compressed size",
    );
    const uncompressedSize = readUInt32(
      archive,
      offset + 24,
      "central uncompressed size",
    );
    const nameLength = readUInt16(archive, offset + 28, "central name length");
    const extraLength = readUInt16(
      archive,
      offset + 30,
      "central extra length",
    );
    const commentLength = readUInt16(
      archive,
      offset + 32,
      "central comment length",
    );
    const localOffset = readUInt32(
      archive,
      offset + 42,
      "central local header offset",
    );
    const name = readEntryName(
      archive,
      offset + 46,
      nameLength,
      "central entry name",
    );
    const recordLength = 46 + nameLength + extraLength + commentLength;
    assertRange(archive, offset, recordLength, "central directory record");

    assert.equal(flags, 0, `${name} must not use ZIP data descriptors`);
    assert.equal(method, 0, `${name} must use ZIP store compression`);
    assert.equal(
      compressedSize,
      uncompressedSize,
      `${name} must have equal compressed and uncompressed sizes`,
    );
    entries.push({
      compressedSize,
      crc,
      date,
      flags,
      localOffset,
      method,
      name,
      time,
      uncompressedSize,
    });
    offset += recordLength;
  }

  assert.equal(
    offset,
    centralEnd,
    "central directory size must match its records",
  );
  return entries;
}

function parseZip(archive: Buffer): ParsedZip {
  const endOffset = findEndOfCentralDirectory(archive);
  const diskNumber = readUInt16(archive, endOffset + 4, "EOCD disk number");
  const centralDiskNumber = readUInt16(
    archive,
    endOffset + 6,
    "EOCD central directory disk number",
  );
  const entriesOnDisk = readUInt16(
    archive,
    endOffset + 8,
    "EOCD entries on disk",
  );
  const entryCount = readUInt16(archive, endOffset + 10, "EOCD entry count");
  const centralSize = readUInt32(archive, endOffset + 12, "EOCD central size");
  const centralOffset = readUInt32(
    archive,
    endOffset + 16,
    "EOCD central offset",
  );

  assert.equal(diskNumber, 0, "ZIP must be a single-disk archive");
  assert.equal(centralDiskNumber, 0, "ZIP central directory must be on disk 0");
  assert.equal(entriesOnDisk, entryCount, "ZIP entry counts must match");
  assert.equal(
    centralOffset + centralSize,
    endOffset,
    "EOCD must follow central directory",
  );

  return {
    centralEntries: parseCentralEntries(
      archive,
      centralOffset,
      centralSize,
      entryCount,
    ),
    localEntries: parseLocalEntries(archive, centralOffset),
  };
}

function runReleasePackaging(): Promise<void> {
  const command = process.platform === "win32" ? "npm.cmd" : "npm";

  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, ["run", "package:release"], {
      cwd: projectRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      reject(
        new Error(
          `npm run package:release failed (code=${code}, signal=${signal ?? "none"})\nstdout:\n${stdout}\nstderr:\n${stderr}`,
        ),
      );
    });
  });
}

function getEntry(entries: LocalEntry[], name: string): LocalEntry {
  const entry = entries.find((candidate) => candidate.name === name);
  assert.ok(entry, `ZIP entry ${name} is missing`);
  return entry;
}

function assertNoForbiddenEntries(names: string[]): void {
  const forbiddenEntryPattern =
    /(?:^|\/)(?:node_modules|\.git|coverage|tmp|temp)(?:\/|$)|(?:^|\/)(?:\.env(?:\.[^/]*)?|\.DS_Store|Thumbs\.db|.*\.(?:map|log|tmp|temp|swp|swo|pem|key|p12|pfx|jks|jwt|token|secret|secrets))$/iu;

  for (const name of names) {
    assert.doesNotMatch(
      name,
      forbiddenEntryPattern,
      `forbidden release entry: ${name}`,
    );
  }
}

function createSyntheticProviderToken(): string {
  return [
    "sk",
    "-",
    "proj",
    "-",
    "synthetic",
    "_",
    "provider",
    "_",
    "token",
    "_",
    "value12345",
  ].join("");
}

test("release secret scan は分割構築したprovider tokenを検出する", () => {
  const token = createSyntheticProviderToken();
  const findings = findReleaseSecretMatches([
    {
      data: Buffer.from(`const value = ${JSON.stringify(token)};\n`),
      path: "service-worker.js",
    },
  ]);

  assert.ok(
    findings.some(({ detector }) => detector === "OpenAI token"),
    "synthetic provider token must be detected",
  );
});

test("release secret scan はNUL含有bufferをskipする", () => {
  const token = createSyntheticProviderToken();
  const files: ReleaseFile[] = [
    {
      data: Buffer.from(`binary\0${token}`),
      path: "offscreen.js",
    },
  ];

  assert.deepEqual(findReleaseSecretMatches(files), []);
  assert.doesNotThrow(() => assertReleaseFilesHaveNoSecrets(files));
});

test("release secret scanのthrow messageはtoken値を含めない", () => {
  const token = createSyntheticProviderToken();
  const files: ReleaseFile[] = [
    {
      data: Buffer.from(`${token}\n`),
      path: "service-worker.js",
    },
  ];

  assert.throws(
    () => assertReleaseFilesHaveNoSecrets(files),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /Release secret scan failed/u);
      assert.match(error.message, /OpenAI token/u);
      assert.equal(error.message.includes(token), false);
      return true;
    },
  );
});

test("release package は clean build から固定内容の再現可能なZIPを生成する", async () => {
  await runReleasePackaging();
  const packageJson = JSON.parse(
    await readFile(resolve(projectRoot, "package.json"), "utf8"),
  ) as { version?: unknown };
  const sourceManifest = JSON.parse(
    await readFile(resolve(projectRoot, "src/manifest.json"), "utf8"),
  ) as { version?: unknown };
  assert.equal(typeof packageJson.version, "string");
  assert.equal(typeof sourceManifest.version, "string");
  assert.equal(sourceManifest.version, packageJson.version);

  const version = packageJson.version as string;
  const archivePath = resolve(releaseDirectory, `contextfling-v${version}.zip`);
  const checksumPath = `${archivePath}.sha256`;
  const firstArchive = await readFile(archivePath);
  const checksum = await readFile(checksumPath, "utf8");
  const firstDigest = createHash("sha256").update(firstArchive).digest("hex");
  assert.equal(checksum, `${firstDigest}  contextfling-v${version}.zip\n`);

  const firstZip = parseZip(firstArchive);
  assert.deepEqual(
    firstZip.localEntries.map(({ name }) => name),
    expectedEntryNames,
    "local ZIP entries must use the fixed release order",
  );
  assert.deepEqual(
    firstZip.centralEntries.map(({ name }) => name),
    expectedEntryNames,
    "central ZIP entries must use the fixed release order",
  );
  assert.equal(firstZip.localEntries.length, expectedEntryNames.length);
  assert.equal(firstZip.centralEntries.length, expectedEntryNames.length);
  assertNoForbiddenEntries([
    ...firstZip.localEntries.map(({ name }) => name),
    ...firstZip.centralEntries.map(({ name }) => name),
  ]);

  for (const entry of firstZip.localEntries) {
    assert.equal(entry.time, expectedDosTime, `${entry.name} local mtime`);
    assert.equal(entry.date, expectedDosDate, `${entry.name} local mdate`);
  }
  for (const entry of firstZip.centralEntries) {
    assert.equal(entry.time, expectedDosTime, `${entry.name} central mtime`);
    assert.equal(entry.date, expectedDosDate, `${entry.name} central mdate`);
  }

  for (const [index, centralEntry] of firstZip.centralEntries.entries()) {
    const localEntry = firstZip.localEntries[index];
    assert.ok(localEntry);
    assert.equal(centralEntry.name, localEntry.name);
    assert.equal(centralEntry.localOffset, localEntry.offset);
    assert.equal(centralEntry.flags, localEntry.flags);
    assert.equal(centralEntry.method, localEntry.method);
    assert.equal(centralEntry.time, localEntry.time);
    assert.equal(centralEntry.date, localEntry.date);
    assert.equal(centralEntry.crc, localEntry.crc);
    assert.equal(centralEntry.compressedSize, localEntry.compressedSize);
    assert.equal(centralEntry.uncompressedSize, localEntry.uncompressedSize);
  }

  const archiveManifest = JSON.parse(
    getEntry(firstZip.localEntries, "manifest.json").data.toString("utf8"),
  ) as { version?: unknown };
  assert.equal(archiveManifest.version, packageJson.version);

  const unexpectedDistEntryPath = resolve(
    projectRoot,
    "dist",
    ".release-package-test-extra.tmp",
  );
  const originalUnexpectedDistEntry = await readFile(
    unexpectedDistEntryPath,
  ).catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  });
  try {
    await writeFile(
      unexpectedDistEntryPath,
      "temporary release package test entry\n",
    );
    await assert.rejects(
      assertDistLayout(),
      /dist layout is not release-safe/u,
    );
  } finally {
    if (originalUnexpectedDistEntry === null) {
      await rm(unexpectedDistEntryPath, { force: true });
    } else {
      await writeFile(unexpectedDistEntryPath, originalUnexpectedDistEntry);
    }
  }

  const distManifestPath = resolve(projectRoot, "dist", "manifest.json");
  const originalDistManifest = await readFile(distManifestPath);
  try {
    const originalManifestText = originalDistManifest.toString("utf8");
    const modifiedManifestText = originalManifestText.replace(
      /("version"\s*:\s*")([^"]*)(")/u,
      (
        _match: string,
        prefix: string,
        currentVersion: string,
        suffix: string,
      ) => `${prefix}${currentVersion}.mismatch${suffix}`,
    );
    assert.notEqual(modifiedManifestText, originalManifestText);
    await writeFile(distManifestPath, modifiedManifestText);
    await assert.rejects(assertVersionsMatch(), /Version mismatch:/u);
  } finally {
    await writeFile(distManifestPath, originalDistManifest);
  }

  await runReleasePackaging();
  const secondArchive = await readFile(archivePath);
  const secondChecksum = await readFile(checksumPath, "utf8");
  const secondDigest = createHash("sha256").update(secondArchive).digest("hex");
  assert.equal(secondDigest, firstDigest);
  assert.deepEqual(secondArchive, firstArchive);
  assert.equal(secondChecksum, checksum);
});
