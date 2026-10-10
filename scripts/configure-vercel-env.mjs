// Run manually only when updating this project's deployment configuration.
// Values travel through stdin, never command-line arguments or console output.
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

process.loadEnvFile(".env.local");
const project = JSON.parse(readFileSync(".vercel/project.json", "utf8"));
if (!project.projectName.startsWith("call-safety") || !project.orgId) {
  throw new Error("This script must be linked to the Call Safety hackathon project.");
}
const names = ["LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET", "SESSION_SIGNING_SECRET"];
const workerUrl = process.env.DEPLOY_TRANSCRIPTION_WORKER_URL;
if (workerUrl) {
  if (new URL(workerUrl).protocol !== "https:") throw new Error("A public HTTPS worker URL is required.");
  process.env.TRANSCRIPTION_WORKER_URL = workerUrl;
  names.push("TRANSCRIPTION_WORKER_URL", "TRANSCRIPTION_WORKER_SECRET");
}
for (const name of names) {
  if (!process.env[name]?.trim()) throw new Error(`Missing ${name}.`);
}
for (const target of ["production,preview"]) {
  for (const name of names) {
    const value = process.env[name].trim();
    const type = name.endsWith("_URL") ? "config" : "secret";
    const args = ["env", "add", name, target, "--type", type, "--yes", "--force", "--scope", project.orgId];
    // A caller can select an already installed CLI; values only travel via stdin.
    const cliPath = process.env.VERCEL_CLI_PATH;
    const result = cliPath ? spawnSync(process.execPath, [cliPath, ...args], {
      input: value,
      encoding: "utf8",
    }) : spawnSync("npx", ["--yes", "vercel", ...args], {
      shell: process.platform === "win32",
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
