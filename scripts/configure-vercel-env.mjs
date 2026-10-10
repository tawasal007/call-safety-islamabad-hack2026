// Run manually only when updating this project's deployment configuration.
// Values travel through stdin, never command-line arguments or console output.
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

process.loadEnvFile(".env.local");
const project = JSON.parse(readFileSync(".vercel/project.json", "utf8"));
if (project.projectName !== "call-safety-islamabad-hack2026") {
  throw new Error("This script must be linked to the Call Safety hackathon project.");
}
const names = ["LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET", "SESSION_SIGNING_SECRET"];
for (const name of names) {
  if (!process.env[name]?.trim()) throw new Error(`Missing ${name}.`);
}
for (const target of ["production", "preview"]) {
  for (const name of names) {
    const value = process.env[name].trim();
    const type = name === "LIVEKIT_URL" ? "config" : "secret";
    const result = spawnSync(`npx --yes vercel env add ${name} ${target} --type ${type} --yes --scope tawasal1`, {
      shell: true,
      input: value,
      encoding: "utf8",
    });
    // Defensive redaction even if CLI behavior changes.
    let output = `${result.stdout || ""}${result.stderr || ""}`;
    for (const key of names) output = output.replaceAll(process.env[key].trim(), "[redacted]");
    if (result.status !== 0) throw new Error(`${name} ${target}: ${output}`);
    console.log(`Configured ${name} for ${target}.`);
  }
}
