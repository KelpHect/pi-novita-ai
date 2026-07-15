import { BASE_URL, LOG_PREFIX, MODELS_URL } from "./config.js";

interface NovitaModelsResponse {
  data?: Array<{ id?: unknown }>;
}

/** Lists model ids from Novita's /v1/models. Returns null on any failure. */
export async function fetchModelIds(
  apiKey: string,
  signal?: AbortSignal,
): Promise<string[] | null> {
  try {
    const response = await fetch(MODELS_URL, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal,
    });
    if (!response.ok) {
      console.error(
        `${LOG_PREFIX} /v1/models returned ${response.status}: ${await response.text()}`,
      );
      return null;
    }
    const payload = (await response.json()) as NovitaModelsResponse;
    const ids = (payload.data ?? [])
      .map((m) => m.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0);
    return ids.length > 0 ? ids : null;
  } catch (err) {
    console.error(`${LOG_PREFIX} failed to fetch model list: ${String(err)}`);
    return null;
  }
}

/** A key is valid iff it can list models. */
export async function isValidApiKey(apiKey: string): Promise<boolean> {
  return (await fetchModelIds(apiKey)) !== null;
}

export interface ProbeResult {
  ok: boolean;
  detail: string;
}

/**
 * Sends a 1-token chat completion to surface errors Pi swallows — Novita
 * encodes the real failure (INVALID_API_KEY, NOT_ENOUGH_BALANCE, ...) in the
 * response body, but Pi only reports the bare status code.
 */
export async function probeChatCompletion(
  apiKey: string,
  model: string,
): Promise<ProbeResult> {
  try {
    const response = await fetch(`${BASE_URL}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "hi" }],
        max_tokens: 1,
      }),
    });
    if (response.ok) {
      return { ok: true, detail: `${model} responded OK` };
    }
    const body = await response.text();
    let reason = body.slice(0, 200);
    try {
      const parsed = JSON.parse(body) as { reason?: string; message?: string };
      reason = [parsed.reason, parsed.message].filter(Boolean).join(": ") || reason;
    } catch {
      // non-JSON body — report it raw
    }
    return { ok: false, detail: `${model} → HTTP ${response.status} ${reason}` };
  } catch (err) {
    return { ok: false, detail: `request failed: ${String(err)}` };
  }
}
