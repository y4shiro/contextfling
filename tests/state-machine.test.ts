import assert from "node:assert/strict";
import { test } from "node:test";
import {
  approvePending,
  claimPending,
  createPendingPayload,
  isClaimable,
  isExpired,
  transitionPending,
} from "../src/state/machine.js";

function pending(
  state: "awaitingConsent" | "queued" | "injecting" = "awaitingConsent",
) {
  return createPendingPayload({
    id: "request-1",
    state,
    sourceUrl: "https://x.com/alice/status/42",
    selectionText: "hello",
    prompt: "prompt",
    createdAt: 1_000,
    expiresAt: 2_000,
  });
}

test("awaitingConsent から approve で queued へ進む", () => {
  const queued = approvePending(pending(), 1_001);
  assert.equal(queued?.state, "queued");
  assert.equal(queued?.claimId, undefined);
  assert.equal(queued?.targetTabId, undefined);
  assert.equal(approvePending(pending("queued"), 1_001), null);
});

test("queued は request ID 単位の claim で一度だけ injecting になる", () => {
  const queued = approvePending(pending(), 1_001);
  assert.ok(queued);
  assert.equal(isClaimable(queued, 1_002), true);
  const claimed = claimPending(queued, "claim-1", 12, 1_002);
  assert.equal(claimed?.state, "injecting");
  assert.equal(claimed?.claimId, "claim-1");
  assert.equal(claimed?.targetTabId, 12);
  assert.equal(claimPending(queued, "claim-2", 13, 1_003)?.claimId, "claim-2");
  assert.ok(claimed);
  assert.equal(claimPending(claimed, "claim-2", 13, 1_003), null);
});

test("期限切れと terminal は null を返し、自動 retry を表現しない", () => {
  const queued = approvePending(pending(), 1_001);
  assert.ok(queued);
  assert.equal(isExpired(queued, 2_000), true);
  assert.equal(isClaimable(queued, 2_000), false);
  assert.equal(claimPending(queued, "claim-1", undefined, 2_000), null);
  assert.equal(transitionPending(queued, { type: "terminal" }, 1_100), null);
  const claimed = claimPending(queued, "claim-1", 12, 1_100);
  assert.ok(claimed);
  assert.equal(transitionPending(claimed, { type: "approve" }, 1_100), null);
});

test("不正 claim id や target tab id は拒否する", () => {
  const queued = approvePending(pending(), 1_001);
  assert.ok(queued);
  assert.equal(claimPending(queued, "   ", 12, 1_002), null);
  assert.equal(claimPending(queued, "claim-1", -1, 1_002), null);
  assert.equal(claimPending(queued, "claim-1", 1.5, 1_002), null);
});
