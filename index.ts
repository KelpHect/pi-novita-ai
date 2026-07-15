/**
 * Pi extension: novita.ai custom provider
 *
 * Registers https://novita.ai as a custom model provider for the Pi coding
 * agent. Novita exposes an OpenAI-compatible Chat Completions API at
 * https://api.novita.ai/openai, so we use the built-in `openai-completions`
 * streaming implementation.
 *
 * Model list is discovered at startup from Novita's `/v1/models` endpoint and
 * merged with a curated metadata map (`KNOWN_MODELS`) that supplies accurate
 * reasoning flags, context windows, max output tokens and pricing for the
 * models we know about (notably `tencent/hy3`). Discovered models without a
 * curated entry get sensible defaults.
 *
 * Usage:
 *   # Set your Novita API key (https://novita.ai -> API Keys)
 *   export NOVITA_API_KEY=nva_xxx
 *
 *   # Load this extension
 *   pi -e /path/to/pi-novita-ai
 *
 *   # Or place it in ~/.pi/agent/extensions/ for auto-discovery + /reload
 *
 * Then use /model to select novita/tencent-hy3 (or any other Novita model).
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// ---------------------------------------------------------------------------
// Provider configuration
// ---------------------------------------------------------------------------

const PROVIDER_NAME = "novita";
const PROVIDER_DISPLAY_NAME = "Novita AI";
const BASE_URL = "https://api.novita.ai/openai";
const MODELS_URL = `${BASE_URL}/v1/models`;
const API_KEY_ENV = "NOVITA_API_KEY";

// ---------------------------------------------------------------------------
// Curated model metadata
//
// Novita's `/v1/models` endpoint returns model ids but not the richer
// metadata Pi needs (reasoning support, context window, max output, pricing).
// We maintain a curated map for the models we know about. Values are taken
// from Novita's model detail pages. Pricing is in USD per million tokens.
// ---------------------------------------------------------------------------

interface CuratedModel {
  name: string;
  reasoning: boolean;
  input: ("text" | "image")[];
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
  contextWindow: number;
  maxTokens: number;
  thinkingLevelMap?: Record<string, string | null>;
  compat?: Record<string, unknown>;
}

const KNOWN_MODELS: Record<string, CuratedModel> = {
  // Flagship: Tencent Hy3 — 295B/21B active MoE, native 256K context, three
  // reasoning modes. Currently in a free promotional tier ($0 in / $0 out).
  "tencent/hy3": {
    name: "Hy3 (Tencent Hunyuan)",
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 262144,
    maxTokens: 262144,
    // Hy3 exposes discrete reasoning modes rather than a continuous effort
    // slider. Map Pi's levels onto the standard OpenAI `reasoning_effort`
    // values; null hides unsupported levels.
    thinkingLevelMap: {
      off: null,
      minimal: null,
      low: "low",
      medium: "medium",
      high: "high",
      xhigh: null,
      max: "max",
    },
    compat: {
      supportsDeveloperRole: false,
      supportsReasoningEffort: true,
      maxTokensField: "max_tokens",
    },
  },
};

// Defaults applied to any model discovered from /v1/models that is not in
// KNOWN_MODELS. These are conservative, safe defaults.
const DEFAULT_MODEL: CuratedModel = {
  name: "",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128000,
  maxTokens: 8192,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface NovitaModelsResponse {
  data?: Array<{ id: string; object?: string }>;
}

function prettyName(id: string): string {
  // "tencent/hy3" -> "Hy3 (Tencent)"; "deepseek/deepseek-r1" -> "Deepseek R1"
  const [vendor, ...rest] = id.split("/");
  const base = (rest.length ? rest.join("/") : vendor) ?? id;
  const pretty = base
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
  return rest.length ? `${pretty} (${vendor})` : pretty;
}

async function discoverModels(
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
        `[pi-novita] /v1/models returned ${response.status}: ${await response.text()}`,
      );
      return null;
    }
    const payload = (await response.json()) as NovitaModelsResponse;
    const ids = (payload.data ?? [])
      .map((m) => m.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0);
    return ids.length > 0 ? ids : null;
  } catch (err) {
    console.error(`[pi-novita] failed to fetch model list: ${String(err)}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Extension entry point
// ---------------------------------------------------------------------------

export default async function novitaProvider(pi: ExtensionAPI): Promise<void> {
  const apiKey = process.env[API_KEY_ENV];

  if (!apiKey) {
    console.error(
      `[pi-novita] ${API_KEY_ENV} is not set. Run /login in Pi and select ` +
        `"${PROVIDER_DISPLAY_NAME}" to store your key in auth.json, or export ` +
        `${API_KEY_ENV}. Get a key at https://novita.ai -> API Keys.`,
    );
  }

  // Build the model list. Prefer dynamic discovery; fall back to the curated
  // set so the extension still works offline / without a valid key.
  let modelIds: string[];
  const discovered = apiKey ? await discoverModels(apiKey) : null;
  if (discovered) {
    modelIds = discovered;
  } else {
    modelIds = Object.keys(KNOWN_MODELS);
    console.error(
      `[pi-novita] using curated model list (${modelIds.join(", ")}).`,
    );
  }

  // Ensure curated flagships are always present even if /v1/models omits them.
  for (const id of Object.keys(KNOWN_MODELS)) {
    if (!modelIds.includes(id)) modelIds.push(id);
  }

  const models = modelIds.map((id) => {
    const known = KNOWN_MODELS[id];
    const base = known ?? DEFAULT_MODEL;
    return {
      id,
      name: base.name || prettyName(id),
      reasoning: base.reasoning,
      input: base.input,
      cost: base.cost,
      contextWindow: base.contextWindow,
      maxTokens: base.maxTokens,
      ...(base.thinkingLevelMap ? { thinkingLevelMap: base.thinkingLevelMap } : {}),
      ...(base.compat ? { compat: base.compat } : {}),
    };
  });

  pi.registerProvider(PROVIDER_NAME, {
    name: PROVIDER_DISPLAY_NAME,
    baseUrl: BASE_URL,
    apiKey: `$${API_KEY_ENV}`,
    authHeader: true,
    api: "openai-completions",
    models,
  });
}
