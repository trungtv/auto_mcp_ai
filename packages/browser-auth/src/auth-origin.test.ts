import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  authHeadersForOrigin,
  recordAuthHeaders,
  snapshotAuthFields,
  stripAuthorization,
} from "./auth-origin.js";

describe("auth-origin", () => {
  it("records headers per origin without last-write-wins across hosts", () => {
    const store: Record<string, Record<string, string>> = {};
    recordAuthHeaders(
      store,
      "https://idp.example/token",
      { authorization: "Bearer idp" },
    );
    recordAuthHeaders(
      store,
      "https://app.example/api/x",
      { authorization: "Bearer api" },
    );
    assert.equal(store["https://idp.example"]?.authorization, "Bearer idp");
    assert.equal(store["https://app.example"]?.authorization, "Bearer api");
    const fields = snapshotAuthFields(store, "https://app.example");
    assert.equal(fields.authHeaders.authorization, "Bearer api");
    assert.equal(
      fields.authHeadersByOrigin["https://idp.example"]?.authorization,
      "Bearer idp",
    );
  });

  it("authHeadersForOrigin prefers by-origin map", () => {
    const headers = authHeadersForOrigin(
      {
        origin: "https://app.example",
        authHeaders: { authorization: "Bearer stale" },
        authHeadersByOrigin: {
          "https://app.example": { authorization: "Bearer fresh" },
        },
      },
      "https://app.example/api/accounts",
    );
    assert.equal(headers.authorization, "Bearer fresh");
  });

  it("stripAuthorization drops only Authorization", () => {
    const out = stripAuthorization({
      Authorization: "Bearer x",
      Accept: "application/json",
    });
    assert.deepEqual(out, { Accept: "application/json" });
  });
});
