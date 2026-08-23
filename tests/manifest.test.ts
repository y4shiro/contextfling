import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

type JsonRecord = Record<string, unknown>;

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = resolve(projectRoot, "src", "manifest.json");

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

test("Manifest は MV3 の最小権限ベースラインを維持する", async () => {
  const manifest: unknown = JSON.parse(await readFile(manifestPath, "utf8"));

  assert.ok(isRecord(manifest));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.name, "ContextFling");
  assert.equal(manifest.version, "0.0.0");

  const background = manifest.background;
  assert.ok(isRecord(background));
  assert.equal(background.service_worker, "service-worker.js");
  assert.equal(background.type, "module");

  const permissions = manifest.permissions ?? [];
  const optionalPermissions = manifest.optional_permissions ?? [];
  const hostPermissions = manifest.host_permissions ?? [];
  assert.ok(Array.isArray(permissions));
  assert.ok(Array.isArray(optionalPermissions));
  assert.ok(Array.isArray(hostPermissions));
  assert.deepEqual(permissions, []);
  assert.deepEqual(optionalPermissions, []);
  assert.deepEqual(hostPermissions, []);

  const serializedManifest = JSON.stringify(manifest) ?? "";
  assert.doesNotMatch(serializedManifest, /<all_urls>/i);
  assert.doesNotMatch(serializedManifest, /unsafe-(?:eval|inline)/i);
  assert.doesNotMatch(serializedManifest, /(?:https?|wss?):\/\//i);
});
