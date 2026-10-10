import assert from "node:assert/strict";
import { test } from "node:test";
import { riskLabel, riskScore } from "../lib/detector/risk-score.ts";

test("concern score stays clear for harmless calls and escalates for validated threats", () => {
  assert.equal(riskScore([]), 0);
  assert.equal(riskScore([{ concernLevel: "low", categories: [] }]), 20);
  assert.equal(riskScore([{ concernLevel: "medium", categories: ["credential_theft"] }]), 60);
  assert.equal(riskScore([{ concernLevel: "high", categories: ["kidnapping_claim"] }]), 95);
  assert.equal(riskLabel(95), "High concern");
});
