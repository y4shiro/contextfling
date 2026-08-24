import { execFile } from "node:child_process";
import { lstat, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const MAX_BUFFER = 20 * 1024 * 1024;

const PROVIDER_PATTERNS = [
  {
    name: "GitHub token",
    pattern:
      /(?:^|[^A-Za-z0-9])(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})(?:$|[^A-Za-z0-9_])/,
  },
  {
    name: "OpenAI token",
    pattern:
      /(?:^|[^A-Za-z0-9])sk-(?:proj-|live-|test-)?[A-Za-z0-9_-]{20,}(?:$|[^A-Za-z0-9_])/,
  },
  {
    name: "Google API key",
    pattern: /(?:^|[^A-Za-z0-9])AIza[0-9A-Za-z_-]{30,}(?:$|[^A-Za-z0-9_])/,
  },
  {
    name: "AWS access key",
    pattern: /(?:^|[^A-Za-z0-9])(?:AKIA|ASIA)[0-9A-Z]{16}(?:$|[^A-Za-z0-9])/,
  },
  {
    name: "Slack token",
    pattern: /(?:^|[^A-Za-z0-9])xox[baprs]-[A-Za-z0-9-]{20,}(?:$|[^A-Za-z0-9])/,
  },
  {
    name: "npm token",
    pattern: /(?:^|[^A-Za-z0-9])npm_[A-Za-z0-9]{30,}(?:$|[^A-Za-z0-9])/,
  },
  {
    name: "PyPI token",
    pattern: /(?:^|[^A-Za-z0-9])pypi-[A-Za-z0-9_-]{20,}(?:$|[^A-Za-z0-9])/,
  },
  {
    name: "SendGrid token",
    pattern:
      /(?:^|[^A-Za-z0-9])SG\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}(?:$|[^A-Za-z0-9])/,
  },
  {
    name: "JWT",
    pattern:
      /(?:^|[^A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}(?:$|[^A-Za-z0-9_-])/,
  },
];

const PRIVATE_KEY_PATTERN = /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/;
const BEARER_TOKEN_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]{24,}\b/i;
const QUOTED_CREDENTIAL_PATTERN =
  /\b(?:api[_-]?key|access[_-]?(?:key|token)|auth[_-]?token|client[_-]?secret|password|secret|token)\b\s*[:=]\s*["'`]([A-Za-z0-9][A-Za-z0-9._~+/=-]{19,})["'`]/i;
const UNQUOTED_CREDENTIAL_PATTERN =
  /\b(?:api[_-]?key|access[_-]?(?:key|token)|auth[_-]?token|client[_-]?secret|password|secret|token)\b\s*[:=]\s*([A-Za-z0-9][A-Za-z0-9._~+/=-]{19,})(?:\s*(?:#.*)?$)/i;

const PLACEHOLDER_PATTERN =
  /^(?:your|my|replace|change|insert|enter|example|sample|dummy|fake|test|mock|placeholder|redacted|todo|xxx+|abc+)[a-z0-9_.-]*(?:_here)?$/i;

function isPlaceholder(value) {
  return PLACEHOLDER_PATTERN.test(value) || /(?:\.\.\.|…|<[^>]+>)/u.test(value);
}

function findCredentialAssignment(line) {
  const match =
    QUOTED_CREDENTIAL_PATTERN.exec(line) ??
    UNQUOTED_CREDENTIAL_PATTERN.exec(line);
  if (match === null) return false;
  const value = match[1];
  return typeof value === "string" && !isPlaceholder(value);
}

const DETECTORS = [
  ...PROVIDER_PATTERNS.map(({ name, pattern }) => ({
    name,
    matches: (line) => pattern.test(line),
  })),
  { name: "private key", matches: (line) => PRIVATE_KEY_PATTERN.test(line) },
  { name: "Bearer token", matches: (line) => BEARER_TOKEN_PATTERN.test(line) },
  { name: "credential assignment", matches: findCredentialAssignment },
];

/**
 * Find high-confidence secret patterns in text without returning the secret value.
 * @param {string} text
 * @returns {Array<{detector: string, line: number}>}
 */
export function findSecretMatches(text) {
  const findings = [];
  const lines = text.split(/\r?\n/u);

  for (const [index, line] of lines.entries()) {
    for (const detector of DETECTORS) {
      if (detector.matches(line)) {
        findings.push({ detector: detector.name, line: index + 1 });
      }
    }
  }

  return findings;
}

async function runGit(args) {
  const { stdout } = await execFileAsync("git", args, {
    cwd: projectRoot,
    encoding: "utf8",
    maxBuffer: MAX_BUFFER,
  });
  return stdout;
}

function splitNullSeparatedList(value) {
  return value.split("\0").filter(Boolean);
}

async function readWorktreeFile(relativePath) {
  const absolutePath = resolve(projectRoot, relativePath);
  try {
    const metadata = await lstat(absolutePath);
    if (!metadata.isFile()) return null;
    return await readFile(absolutePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function readIndexFile(relativePath) {
  try {
    return await runGit(["show", `:${relativePath}`]);
  } catch (error) {
    // Deleted, conflicted, or submodule entries have no readable blob.
    if (error?.code === "ENOENT" || error?.code === 128) return null;
    throw error;
  }
}

function addFindings(findings, relativePath, snapshot, text) {
  // Binary files are not useful text scan inputs; their staged blob is still listed.
  if (text.includes("\0")) return;

  for (const match of findSecretMatches(text)) {
    const key = `${relativePath}:${match.line}:${match.detector}`;
    const existing = findings.get(key);
    if (existing) {
      existing.snapshots.add(snapshot);
    } else {
      findings.set(key, {
        detector: match.detector,
        line: match.line,
        path: relativePath,
        snapshots: new Set([snapshot]),
      });
    }
  }
}

async function main() {
  const trackedPaths = splitNullSeparatedList(await runGit(["ls-files", "-z"]));
  const stagedPaths = splitNullSeparatedList(
    await runGit([
      "diff",
      "--cached",
      "--name-only",
      "-z",
      "--diff-filter=ACMRTUXB",
    ]),
  );
  const findings = new Map();
  let snapshotsScanned = 0;

  for (const relativePath of trackedPaths) {
    const text = await readWorktreeFile(relativePath);
    if (text === null) continue;
    snapshotsScanned += 1;
    addFindings(findings, relativePath, "worktree", text);
  }

  for (const relativePath of stagedPaths) {
    const text = await readIndexFile(relativePath);
    if (text === null) continue;
    snapshotsScanned += 1;
    addFindings(findings, relativePath, "index", text);
  }

  if (findings.size > 0) {
    console.error(
      `Secret scan failed: ${findings.size} potential secret(s) found.`,
    );
    for (const finding of findings.values()) {
      const snapshots = [...finding.snapshots].join(", ");
      console.error(
        `- ${finding.path}:${finding.line} (${finding.detector}; ${snapshots})`,
      );
    }
    process.exitCode = 1;
    return;
  }

  console.log(
    `Secret scan passed: ${snapshotsScanned} tracked/staged snapshot(s) checked.`,
  );
}

const invokedPath =
  process.argv[1] === undefined ? "" : resolve(process.argv[1]);
if (invokedPath === fileURLToPath(import.meta.url)) {
  await main().catch((error) => {
    console.error("Secret scan could not inspect the Git repository.");
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 2;
  });
}
