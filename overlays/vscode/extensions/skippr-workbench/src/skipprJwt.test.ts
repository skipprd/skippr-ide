import test from "node:test";
import assert from "node:assert/strict";
import { parseJwtEmail, parseJwtTenantId } from "./skipprJwt.js";

function fakeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "none" }), "utf8").toString("base64url");
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${header}.${body}.sig`;
}

test("parseJwtEmail reads email claim", () => {
  const token = fakeJwt({ email: "user@example.com", tenant_id: "t1" });
  assert.equal(parseJwtEmail(token), "user@example.com");
  assert.equal(parseJwtTenantId(token), "t1");
});

test("parseJwtEmail returns undefined when claim missing", () => {
  assert.equal(parseJwtEmail(fakeJwt({ tenant_id: "t1" })), undefined);
});
