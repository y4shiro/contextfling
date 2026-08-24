import assert from "node:assert/strict";
import test from "node:test";
import { findSecretMatches } from "../scripts/check-secrets.mjs";

test("secret scan detects high-confidence provider tokens", () => {
  const githubToken = `ghp_${"a".repeat(36)}`;
  const matches = findSecretMatches(`token = "${githubToken}"`);

  assert.ok(matches.some(({ detector }) => detector === "GitHub token"));
});

test("secret scan detects private keys and credential assignments", () => {
  const privateKeyHeader = ["-----BEGIN ", "RSA ", "PRIVATE KEY-----"].join("");
  const matches = findSecretMatches(
    [privateKeyHeader, `API_KEY=${"a".repeat(24)}`].join("\n"),
  );

  assert.ok(matches.some(({ detector }) => detector === "private key"));
  assert.ok(
    matches.some(({ detector }) => detector === "credential assignment"),
  );
});

test("safe placeholders used by third-party guidance are ignored", () => {
  const bearerPlaceholder = ["$", "{token}"].join("");
  const matches = findSecretMatches(
    [
      "const API_KEY = 'YOUR_API_KEY_HERE';",
      '"key": "MIIBIjANBgkqhk...your-public-key-here...",',
      `Authorization: Bearer ${bearerPlaceholder}`,
    ].join("\n"),
  );

  assert.deepEqual(matches, []);
});
