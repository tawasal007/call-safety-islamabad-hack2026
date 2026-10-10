import "server-only";

export async function workerRequest(path: string, body?: unknown) {
  const url = process.env.TRANSCRIPTION_WORKER_URL?.trim();
  const secret = process.env.TRANSCRIPTION_WORKER_SECRET?.trim();
  if (!url || !secret || secret.length < 32) throw new Error("Transcription worker is not configured. Audio calls remain available.");
  const endpoint = new URL(url);
  if (process.env.NODE_ENV === "production" && endpoint.protocol !== "https:" &&
      !["127.0.0.1", "localhost"].includes(endpoint.hostname)) {
    throw new Error("The transcription service requires HTTPS.");
  }
  const response = await fetch(new URL(path, endpoint), {
    method: body === undefined ? "GET" : "POST",
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store", signal: AbortSignal.timeout(18000),
  });
  if (!response.ok) {
    // Keep upstream URLs, credentials and diagnostic stack traces server-side.
    if (response.status === 404) throw new Error("No saved call log yet.");
    throw new Error("Transcription service is unavailable. Check the worker; your audio call can continue.");
  }
  return response.json();
}
