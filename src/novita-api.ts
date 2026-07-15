import { BASE_URL, LOG_PREFIX, MODELS_URL } from "./config.js";

// Model entry from GET /openai/v1/models. Only the fields this extension
// consumes; the endpoint returns more. Prices are USD per million tokens in
// units of $0.0001 (e.g. 2690 = $0.269/M).
export interface NovitaModel {
  id: string;
  display_name?: string;
  context_size?: number;
  max_output_tokens?: number;
  features?: string[];
  input_modalities?: string[];
  model_type?: string;
  endpoints?: string[];
  input_token_price_per_m?: number;
  output_token_price_per_m?: number;
  pricing?: NovitaPricing;
  tiered_billing_configs?: NovitaBillingTier[];
}

export interface NovitaPricing {
  prompt?: NovitaPrice;
  completion?: NovitaPrice;
  input_cache_read?: NovitaPrice;
}

export interface NovitaPrice {
  price_per_m: number;
}

export interface NovitaBillingTier {
  min_tokens: number;
  max_tokens: number;
  pricing: NovitaPricing;
}

// Error body shape for all Novita API errors (documented at
// /docs/api-reference/basic-error-code). Not OpenAI's {"error":{...}} envelope.
export interface NovitaError {
  code: number;
  reason: string;
  message: string;
}

/** GET /v1/models requires no authentication. Returns null on any failure. */
export async function fetchModels(
  signal?: AbortSignal,
): Promise<NovitaModel[] | null> {
  try {
    const response = await fetch(MODELS_URL, { signal });
    if (!response.ok) {
      console.error(`${LOG_PREFIX} /v1/models returned ${response.status}`);
      return null;
    }
    const payload = (await response.json()) as { data?: NovitaModel[] };
    const models = (payload.data ?? []).filter((m) => typeof m.id === "string");
    return models.length > 0 ? models : null;
  } catch (err) {
    console.error(`${LOG_PREFIX} failed to fetch model list: ${String(err)}`);
    return null;
  }
}

export interface ProbeResult {
  ok: boolean;
  status?: number;
  error?: NovitaError;
  detail: string;
}

/**
 * Sends a 1-token chat completion. Novita encodes the real failure cause
 * (INVALID_API_KEY, NOT_ENOUGH_BALANCE, ...) in the response body.
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
      return { ok: true, status: response.status, detail: `${model} responded OK` };
    }
    const body = await response.text();
    const error = parseNovitaError(body);
    const detail = error
      ? `${model} → HTTP ${response.status} ${error.reason}: ${error.message}`
      : `${model} → HTTP ${response.status} ${body.slice(0, 200)}`;
    return { ok: false, status: response.status, error: error ?? undefined, detail };
  } catch (err) {
    return { ok: false, detail: `request failed: ${String(err)}` };
  }
}

export function parseNovitaError(body: string): NovitaError | null {
  try {
    const parsed = JSON.parse(body) as Partial<NovitaError>;
    if (typeof parsed.reason === "string" && typeof parsed.message === "string") {
      return { code: parsed.code ?? 0, reason: parsed.reason, message: parsed.message };
    }
  } catch {
    // not JSON
  }
  return null;
}

const AUTH_FAILURE_REASONS = new Set(["INVALID_API_KEY", "FAILED_TO_AUTH"]);

/**
 * Validates a key by probing a chat completion, since /v1/models accepts
 * unauthenticated requests. Only authentication failures reject the key —
 * a NOT_ENOUGH_BALANCE or rate-limit response proves the key itself is valid.
 */
export async function isValidApiKey(
  apiKey: string,
  probeModel: string,
): Promise<boolean> {
  const probe = await probeChatCompletion(apiKey, probeModel);
  if (probe.ok) return true;
  if (probe.error) return !AUTH_FAILURE_REASONS.has(probe.error.reason);
  return false;
}
