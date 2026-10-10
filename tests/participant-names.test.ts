import assert from "node:assert/strict";
import test from "node:test";
import { makeParticipantToken } from "../lib/livekit.ts";

const config = { browserUrl: "wss://example.invalid", apiKey: "test-key", apiSecret: "test-secret-used-only-for-unit-tests" };

test("participant tokens carry display names while retaining role-based identity", async () => {
  for (const role of ["caller", "receiver"] as const) {
    const token = await makeParticipantToken("call-test", role, config, "en", "  Alex  ");
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
    assert.equal(payload.name, "Alex");
    assert.equal(payload.sub, `${role}-call-test`);
  }
});

test("missing names use a neutral label and long names are bounded", async () => {
  for (const name of [undefined, "   ", "A".repeat(80)]) {
    const token = await makeParticipantToken("call-test", "receiver", config, "en", name);
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
    assert.equal(payload.name, name?.trim() ? "A".repeat(60) : "Other person");
  }
});
