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
  assert.equal(manifest.version, "0.1.1");
  assert.equal(manifest.minimum_chrome_version, "116");

  const background = manifest.background;
  assert.ok(isRecord(background));
  assert.equal(background.service_worker, "service-worker.js");
  assert.equal(background.type, "module");

  const permissions = manifest.permissions ?? [];
  const optionalPermissions = manifest.optional_permissions ?? [];
  const optionalHostPermissions = manifest.optional_host_permissions ?? [];
  assert.ok(Array.isArray(permissions));
  assert.ok(Array.isArray(optionalPermissions));
  assert.ok(Array.isArray(optionalHostPermissions));
  assert.deepEqual(permissions, [
    "activeTab",
    "contextMenus",
    "scripting",
    "storage",
  ]);
  assert.deepEqual(optionalPermissions, ["offscreen", "clipboardWrite"]);
  assert.deepEqual(optionalHostPermissions, ["https://chatgpt.com/*"]);

  const action = manifest.action;
  assert.ok(isRecord(action));
  assert.equal(action.default_title, "ContextFling の設定を開く");
  assert.equal(manifest.options_page, "settings/settings.html");

  const contentSecurityPolicy = manifest.content_security_policy;
  assert.ok(isRecord(contentSecurityPolicy));
  assert.equal(
    contentSecurityPolicy.extension_pages,
    "script-src 'self'; object-src 'self'",
  );

  const serializedManifest = JSON.stringify(manifest) ?? "";
  assert.doesNotMatch(serializedManifest, /<all_urls>/i);
  assert.doesNotMatch(serializedManifest, /unsafe-(?:eval|inline)/i);
  assert.doesNotMatch(
    serializedManifest,
    /(?:https?|wss?):\/\/(?!chatgpt\.com\/)/i,
  );
  assert.doesNotMatch(
    serializedManifest,
    /\b(?:tabs|notifications|alarms|cookies|history|<all_urls>)\b/i,
  );
});
