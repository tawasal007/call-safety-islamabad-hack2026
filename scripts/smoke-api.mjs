import assert from "node:assert/strict";

const base = process.env.TEST_BASE_URL || "http://localhost:3000";
const joinBase = process.env.TEST_JOIN_BASE_URL || base;
const create = await fetch(`${base}/api/rooms`, { method: "POST", headers: { Origin: new URL(base).origin } });
assert.equal(create.status, 200, "Room creation failed; check server environment variables.");
const session = await create.json();
assert.equal(new URL(session.inviteUrl).origin, new URL(base).origin);
const receiverKey = new URL(session.inviteUrl).searchParams.get("invite");
for (const [accessKey, role] of [[session.callerAccessKey, "caller"], [receiverKey, "receiver"]]) {
  const response = await fetch(`${joinBase}/api/rooms/join`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ roomId: session.roomId, accessKey }),
  });
  assert.equal(response.status, 200, `${role} token request failed.`);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const data = await response.json();
  assert.equal(data.role, role);
  assert.match(data.serverUrl, /^wss?:\/\//);
  const claims = JSON.parse(Buffer.from(data.token.split(".")[1], "base64url").toString());
  assert.equal(claims.sub, `${role}-${session.roomId}`);
  assert.equal(claims.video.room, session.roomId);
  assert.deepEqual(claims.video.canPublishSources, ["microphone"]);
  assert.equal(claims.video.canPublishData, false);
}
for (const [body, expected] of [[{ roomId: session.roomId, accessKey: "invalid" }, 403], [{ roomId: 42, accessKey: receiverKey }, 400]]) {
  const response = await fetch(`${joinBase}/api/rooms/join`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  assert.equal(response.status, expected);
}
console.log("API smoke test passed: invitation origin, both roles, microphone-only grants, no-store responses, invalid access and malformed input.");
if (joinBase !== base) console.log("Invitations verified across separate running app instances.");
