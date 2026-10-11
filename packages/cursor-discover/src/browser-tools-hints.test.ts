import assert from "node:assert/strict";
import { test } from "node:test";
import { networkSnapshotHints } from "./browser-tools.js";

test("networkSnapshotHints empty when captured > 0", () => {
  assert.deepEqual(networkSnapshotHints({ captured: 3 }), []);
});

test("networkSnapshotHints suggests SPA flow when captured 0", () => {
  const hints = networkSnapshotHints({ captured: 0 });
  assert.ok(hints.some((h) => h.includes("network_mark")));
});

test("networkSnapshotHints detects login page", () => {
  const hints = networkSnapshotHints({
    captured: 0,
    title: "User Login | Hotel Link",
    pageUrl: "https://example.com/#/login",
  });
  assert.ok(hints.some((h) => h.includes("login") || h.includes("CAPTCHA")));
});
