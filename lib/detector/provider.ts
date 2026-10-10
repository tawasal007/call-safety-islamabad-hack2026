// LLM provider adapter. Server-side only: reads secrets from env and must never
// be imported by client components.

export type ChatMessage = { role: "system" | "user"; content: string };

export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  /** Returns the raw text content of the model's reply. */
  complete(messages: ChatMessage[], options: { signal: AbortSignal }): Promise<string>;
}

export class ProviderError extends Error {
  readonly retryable: boolean;
  readonly retryAfterMs?: number;
  constructor(message: string, retryable: boolean, retryAfterMs?: number) {
    super(message);
    this.name = "ProviderError";
    this.retryable = retryable;
    this.retryAfterMs = retryAfterMs;
  }
}

// OpenAI-compatible chat-completions endpoints.
const BASE_URLS: Record<string, string> = {
  groq: "https://api.groq.com/openai/v1",
  openrouter: "https://openrouter.ai/api/v1",
  openai: "https://api.openai.com/v1",
};

// Only the Groq default has been checked against a live account for this
// project. Other providers need LLM_MODEL set explicitly.
const DEFAULT_MODELS: Record<string, string> = {
  groq: "openai/gpt-oss-120b",
};

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export function createOpenAiCompatibleProvider(options: {
  name: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  fetchImpl?: FetchLike;
}): LlmProvider {
  const fetchImpl: FetchLike = options.fetchImpl ?? ((input, init) => fetch(input, init));
  const endpoint = `${options.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  return {
    name: options.name,
    model: options.model,
    async complete(messages, { signal }) {
      const body: Record<string, unknown> = {
        model: options.model,
        messages,
        temperature: 0,
        response_format: { type: "json_object" },
        // Replies use ~120-200 tokens; a low cap also keeps free-tier token budgets usable.
        max_completion_tokens: 600,
      };
      // gpt-oss models are reasoning models; low effort keeps latency down.
      if (options.name === "groq" && options.model.startsWith("openai/gpt-oss")) body.reasoning_effort = "low";
      let response: Response;
      try {
        response = await fetchImpl(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${options.apiKey}` },
          body: JSON.stringify(body),
          signal,
        });
      } catch (error) {
        if (signal.aborted) throw new ProviderError("Detector request timed out", true);
        throw new ProviderError(`Detector request failed: ${error instanceof Error ? error.name : "network error"}`, true);
      }
      // Never include the response body or key in errors; status is enough.
      if (response.status === 429) {
        const seconds = Number(response.headers.get("retry-after"));
        throw new ProviderError("Detector rate limited (HTTP 429)", true, Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : undefined);
      }
      if (response.status >= 500) throw new ProviderError(`Detector provider error (HTTP ${response.status})`, true);
      if (!response.ok) throw new ProviderError(`Detector request rejected (HTTP ${response.status})`, false);
      let data: unknown;
      try { data = await response.json(); }
      catch { throw new ProviderError("Detector returned a non-JSON HTTP body", true); }
      const content = (data as { choices?: { message?: { content?: unknown } }[] })?.choices?.[0]?.message?.content;
      if (typeof content !== "string" || !content.trim()) throw new ProviderError("Detector returned an empty reply", true);
      return content;
    },
  };
}

export type ProviderConfigStatus =
  | { configured: true; provider: LlmProvider }
  | { configured: false; reason: string };

/** Builds the provider from LLM_PROVIDER, LLM_MODEL, LLM_API_KEY (and optional LLM_BASE_URL). */
export function providerFromEnv(env: Record<string, string | undefined> = process.env): ProviderConfigStatus {
  const name = env.LLM_PROVIDER?.trim().toLowerCase() || "groq";
  const apiKey = env.LLM_API_KEY?.trim();
  const baseUrl = env.LLM_BASE_URL?.trim() || BASE_URLS[name];
  const model = env.LLM_MODEL?.trim() || DEFAULT_MODELS[name];
  if (!apiKey || apiKey.startsWith("replace-with") || apiKey.startsWith("your_")) {
    return { configured: false, reason: "LLM_API_KEY is not set" };
  }
  if (!baseUrl) return { configured: false, reason: `Unknown LLM_PROVIDER "${name}"; set LLM_BASE_URL` };
  if (!model) return { configured: false, reason: "LLM_MODEL is not set" };
  return { configured: true, provider: createOpenAiCompatibleProvider({ name, baseUrl, model, apiKey }) };
}