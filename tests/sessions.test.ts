import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { admitArchiveAccess, admitParticipant, createSession, issueArchiveAccess, sessionSigningConfigured } from "../lib/sessions.ts";

process.env.SESSION_SIGNING_SECRET = randomBytes(32).toString("hex");

test("signed invitations retain caller and receiver roles in a different server process", () => {
  const session = createSession();
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import { admitParticipant } from './lib/sessions.ts';
    const session = JSON.parse(process.env.TEST_SESSION);
    console.log(JSON.stringify([
      admitParticipant(session.roomId, session.callerAccessKey),
      admitParticipant(session.roomId, session.receiverAccessKey),
    ]));
  `], { encoding: "utf8", env: { ...process.env, TEST_SESSION: JSON.stringify(session) } });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), ["caller", "receiver"]);
});

test("rejects signature changes, role changes, another room, malformed and expired invitations", () => {
  const session = createSession();
  const [payload, signature] = session.receiverAccessKey.split(".");
  const forged = JSON.parse(Buffer.from(payload, "base64url").toString());
  forged.role = "caller";
  assert.equal(admitParticipant(session.roomId, `${Buffer.from(JSON.stringify(forged)).toString("base64url")}.${signature}`), null);
  assert.equal(admitParticipant(session.roomId, `${payload}.${signature.slice(0, -1)}${signature.endsWith("A") ? "B" : "A"}`), null);
  assert.equal(admitParticipant(createSession().roomId, session.receiverAccessKey), null);
  for (const bad of ["", "invalid", "a.b.c", "💥.x", "a".repeat(2049)]) {
    assert.equal(admitParticipant(session.roomId, bad), null);
  }
  const realNow = Date.now;
  try {
    Date.now = () => session.expiresAt + 1;
    assert.equal(admitParticipant(session.roomId, session.receiverAccessKey), null);
  } finally { Date.now = realNow; }
});

test("changing the signing secret invalidates old invitations", () => {
  const session = createSession();
  const previous = process.env.SESSION_SIGNING_SECRET;
  try {
    process.env.SESSION_SIGNING_SECRET = randomBytes(32).toString("hex");
    assert.equal(admitParticipant(session.roomId, session.callerAccessKey), null);
    process.env.SESSION_SIGNING_SECRET = "replace-with-a-random-64-character-hex-value";
    assert.equal(sessionSigningConfigured(), false);
  } finally { process.env.SESSION_SIGNING_SECRET = previous; }
});

test("call log access is room-scoped and remains valid after the invitation expires", () => {
  const session = createSession();
  const archiveKey = issueArchiveAccess(session.roomId);
  assert.equal(admitArchiveAccess(session.roomId, archiveKey), true);
  assert.equal(admitArchiveAccess(createSession().roomId, archiveKey), false);
  const realNow = Date.now;
  try {
    Date.now = () => session.expiresAt + 1;
    assert.equal(admitParticipant(session.roomId, session.callerAccessKey), null);
    assert.equal(admitArchiveAccess(session.roomId, archiveKey), true);
    Date.now = () => session.expiresAt + 31 * 24 * 60 * 60 * 1000;
    assert.equal(admitArchiveAccess(session.roomId, archiveKey), false);
  } finally { Date.now = realNow; }
});
