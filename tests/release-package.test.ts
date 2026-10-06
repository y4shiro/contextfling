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

function runCommand(command: string, args: string[]): Promise<Buffer> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdout.push(Buffer.from(chunk));
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr.push(Buffer.from(chunk));
    });
    child.once("error", (error) => {
      reject(new Error(`${command} is unavailable: ${error.message}`));
    });
    child.once("close", (code, signal) => {
      if (code === 0) {
        resolvePromise(Buffer.concat(stdout));
        return;
      }
      reject(
        new Error(
          command +
            " failed (code=" +
            code +
            ", signal=" +
            (signal ?? "none") +
            ")\n" +
            Buffer.concat(stderr).toString("utf8"),
        ),
      );
    });
  });
}

async function runReleasePackaging(): Promise<void> {
  const command = process.platform === "win32" ? "npm.cmd" : "npm";
  await runCommand(command, ["run", "package:release"]);
}

function runUnzip(args: string[]): Promise<Buffer> {
  return runCommand("unzip", args);
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

test("release package はclean buildから固定内容の再現可能なZIPを生成する", async () => {
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

  await runUnzip(["-t", archivePath]);
  const fixedTimestamps = (await runUnzip(["-Z", "-T", archivePath]))
    .toString("utf8")
    .match(/19800101\.000000/gu);
  assert.equal(fixedTimestamps?.length, expectedEntryNames.length);
  const entryNames = (await runUnzip(["-Z1", archivePath]))
    .toString("utf8")
    .trimEnd()
    .split(/\r?\n/u);
  assert.deepEqual(entryNames, expectedEntryNames);

  const archiveManifest = JSON.parse(
    (await runUnzip(["-p", archivePath, "manifest.json"])).toString("utf8"),
  ) as { version?: unknown };
  assert.equal(archiveManifest.version, packageJson.version);

  for (const relativePath of expectedEntryNames) {
    const archivedFile = await runUnzip(["-p", archivePath, relativePath]);
    const distFile = await readFile(resolve(projectRoot, "dist", relativePath));
    assert.deepEqual(archivedFile, distFile, `${relativePath} must match dist`);
  }

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
