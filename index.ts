/**
 * Pi extension: novita.ai custom provider
 *
 * Registers https://novita.ai as a custom model provider for the Pi coding
 * agent. Novita exposes an OpenAI-compatible Chat Completions API at
 * https://api.novita.ai/openai with `Authorization: Bearer` auth, so we use
 * Pi's built-in `openai-completions` streaming implementation — no custom
 * streaming code required.
 *
 * # /login
 *
 * The provider appears as "Novita AI" in Pi's `/login` menu. Users select it,
 * paste their Novita API key, and Pi stores it in `~/.pi/agent/auth.json` under
 * the `novita` key. The `apiKey: "$NOVITA_API_KEY"` config serves as an
 * environment-variable fallback if the user prefers not to use `/login`.
 *
 * # Features supported (via Novita's OpenAI-compatible API)
 *
 * - Chat Completions (streaming + non-streaming)
 * - Function calling / tool use
 * - Structured outputs (`json_object` response_format)
 * - Vision / multimodal input (image_url + text) for VLM models
 * - Reasoning / extended thinking with per-model-family thinkingFormat:
 *     - `qwen` format (top-level `enable_thinking`) for GLM, Kimi, Qwen
 *     - `deepseek` format (`thinking: { type: enabled|disabled }`) for DeepSeek
 * - Interleaved thinking (reasoning_content / reasoning_details between tool calls)
 * - Prompt caching (cacheRead/cacheWrite cost tracking)
 *
 * # Model discovery
 *
 * The model list is discovered at startup from Novita's `/v1/models` endpoint
 * and merged with a curated metadata map (`KNOWN_MODELS`) that supplies
 * accurate reasoning flags, vision support, context windows, max output
 * tokens, thinkingFormat, and compat settings for every recommended model
 * from Novita's docs. Discovered models without a curated entry get sensible
 * defaults. If discovery fails (no key / network error), the curated set is
 * used alone so the extension still loads.
 *
 * # Context overflow recovery
 *
 * A `message_end` handler normalizes Novita's context-overflow error messages
 * so Pi can auto-compact and retry when a request exceeds the context window.
 *
 * Usage:
 *   1. Place in ~/.pi/agent/extensions/ for auto-discovery (+ /reload support)
 *   2. Run /login, select "Novita AI", paste your API key
 *   3. Run /model and pick a Novita model (e.g. novita/tencent-hy3)
 *
 *   Alternatively: export NOVITA_API_KEY=nva_xxx
 *   Get a key at https://novita.ai/settings/key-management
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
// Types
// ---------------------------------------------------------------------------

type ThinkingFormat =
  | "openai"
  | "openrouter"
  | "deepseek"
  | "together"
  | "zai"
  | "qwen"
  | "chat-template"
  | "qwen-chat-template"
  | "string-thinking"
  | "ant-ling";

type MaxTokensField = "max_completion_tokens" | "max_tokens";

interface ModelCompat {
  supportsStore?: boolean;
  supportsDeveloperRole?: boolean;
  supportsReasoningEffort?: boolean;
  supportsUsageInStreaming?: boolean;
  maxTokensField?: MaxTokensField;
  requiresToolResultName?: boolean;
  requiresAssistantAfterToolResult?: boolean;
  requiresThinkingAsText?: boolean;
  requiresReasoningContentOnAssistantMessages?: boolean;
  thinkingFormat?: ThinkingFormat;
  cacheControlFormat?: "anthropic";
}

type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
type ThinkingLevelMap = Partial<Record<ThinkingLevel, string | null>>;

interface CuratedModel {
  name: string;
  reasoning: boolean;
  input: ("text" | "image")[];
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
  contextWindow: number;
  maxTokens: number;
  thinkingLevelMap?: ThinkingLevelMap;
  compat?: ModelCompat;
}

// ---------------------------------------------------------------------------
// Base compat settings — apply to ALL Novita models
//
// Novita's API is OpenAI Chat Completions compatible:
// - Uses "system" role, not "developer" → supportsDeveloperRole: false
// - Uses `max_tokens` parameter (not `max_completion_tokens`)
// - Returns usage in streaming responses
// - Does not support the OpenAI Responses API `store` parameter
// ---------------------------------------------------------------------------

const BASE_COMPAT: ModelCompat = {
  supportsDeveloperRole: false,
  maxTokensField: "max_tokens",
  supportsUsageInStreaming: true,
  supportsStore: false,
};

// ---------------------------------------------------------------------------
// Per-family compat for reasoning models
//
// Novita supports two thinking-control mechanisms depending on model family:
// - `enable_thinking: true/false` (top-level) → Pi's "qwen" thinkingFormat
//   Used by: GLM, Kimi, Qwen
// - `thinking: { type: "enabled" | "disabled" }` + `reasoning_effort` → Pi's
//   "deepseek" thinkingFormat. Used by: DeepSeek
//
// Novita's interleaved thinking docs require including reasoning_content in
// subsequent assistant messages, so we set requiresReasoningContentOnAssistantMessages.
// ---------------------------------------------------------------------------

const QWEN_THINKING_COMPAT: ModelCompat = {
  ...BASE_COMPAT,
  thinkingFormat: "qwen",
  supportsReasoningEffort: false,
  requiresReasoningContentOnAssistantMessages: true,
};

const DEEPSEEK_THINKING_COMPAT: ModelCompat = {
  ...BASE_COMPAT,
  thinkingFormat: "deepseek",
  supportsReasoningEffort: true,
  requiresReasoningContentOnAssistantMessages: true,
};

const STANDARD_REASONING_COMPAT: ModelCompat = {
  ...BASE_COMPAT,
  supportsReasoningEffort: true,
  requiresReasoningContentOnAssistantMessages: true,
};

// ---------------------------------------------------------------------------
// Thinking level maps
//
// null = level is hidden (unsupported by the model).
// For qwen-format models, non-null = enable_thinking: true is sent.
// For deepseek-format models, non-null = thinking is enabled + reasoning_effort
// is set to the mapped value.
// ---------------------------------------------------------------------------

// Models where thinking can be disabled and supports low/medium/high effort.
const THINKING_CAN_DISABLE: ThinkingLevelMap = {
  off: "off",
  minimal: null,
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: null,
  max: null,
};

// Models where thinking cannot be disabled (always-on reasoning).
const THINKING_ALWAYS_ON: ThinkingLevelMap = {
  off: null,
  minimal: null,
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: null,
  max: null,
};

// Models that support extended reasoning including max effort.
const THINKING_FULL_RANGE: ThinkingLevelMap = {
  off: "off",
  minimal: null,
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: null,
  max: "max",
};

// ---------------------------------------------------------------------------
// Curated model metadata
//
// Source: Novita "Recommended Models" docs (https://novita.ai/docs/guides/llm-recommended)
// and individual model detail pages. Context windows are taken from the
// recommended models table. Pricing should be verified at
// https://novita.ai/pricing — values here are set to $0 where the model is in
// a free promotional tier or where exact pricing is not confirmed.
// ---------------------------------------------------------------------------

const KNOWN_MODELS: Record<string, CuratedModel> = {
  // =========================================================================
  // Flagship
  // =========================================================================

  // Tencent Hy3 — 295B/21B active MoE, native 256K context, three reasoning
  // modes. Free promotional tier ($0 in / $0 out) per model detail page.
  "tencent/hy3": {
    name: "Hy3 (Tencent Hunyuan)",
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 262144,
    maxTokens: 262144,
    thinkingLevelMap: THINKING_FULL_RANGE,
    compat: STANDARD_REASONING_COMPAT,
  },

  // =========================================================================
  // Code generation & reasoning
  // =========================================================================

  "moonshotai/kimi-k2.7-code": {
    name: "Kimi K2.7 Code (Moonshot)",
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 262144,
    maxTokens: 65536,
    thinkingLevelMap: THINKING_CAN_DISABLE,
    compat: QWEN_THINKING_COMPAT,
  },

  "zai-org/glm-5.2": {
    name: "GLM 5.2 (Zhipu)",
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1048576,
    maxTokens: 65536,
    thinkingLevelMap: THINKING_CAN_DISABLE,
    compat: QWEN_THINKING_COMPAT,
  },

  "deepseek/deepseek-v4-pro": {
    name: "DeepSeek V4 Pro",
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1048576,
    maxTokens: 65536,
    thinkingLevelMap: THINKING_CAN_DISABLE,
    compat: DEEPSEEK_THINKING_COMPAT,
  },

  // =========================================================================
  // General reasoning & planning
  // =========================================================================

  "deepseek/deepseek-v3.2": {
    name: "DeepSeek V3.2",
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 163840,
    maxTokens: 32768,
    thinkingLevelMap: THINKING_CAN_DISABLE,
    compat: DEEPSEEK_THINKING_COMPAT,
  },

  // Also listed under Vision & document understanding — supports image input.
  "qwen/qwen3.5-397b-a17b": {
    name: "Qwen 3.5 397B (17B active)",
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 262144,
    maxTokens: 32768,
    thinkingLevelMap: THINKING_CAN_DISABLE,
    compat: QWEN_THINKING_COMPAT,
  },

  // =========================================================================
  // Agents, function calling & tool use
  // =========================================================================

  "minimax/minimax-m3": {
    name: "MiniMax M3",
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1048576,
    maxTokens: 65536,
    thinkingLevelMap: THINKING_CAN_DISABLE,
    compat: STANDARD_REASONING_COMPAT,
  },

  // =========================================================================
  // Long context & summarization
  // =========================================================================

  "deepseek/deepseek-v4-flash": {
    name: "DeepSeek V4 Flash",
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1048576,
    maxTokens: 65536,
    thinkingLevelMap: THINKING_CAN_DISABLE,
    compat: DEEPSEEK_THINKING_COMPAT,
  },

  // =========================================================================
  // Vision & document understanding
  // =========================================================================

  "moonshotai/kimi-k2.5": {
    name: "Kimi K2.5 (Moonshot)",
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 262144,
    maxTokens: 32768,
    thinkingLevelMap: THINKING_CAN_DISABLE,
    compat: QWEN_THINKING_COMPAT,
  },

  "google/gemma-4-31b-it": {
    name: "Gemma 4 31B (Google)",
    reasoning: false,
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 262144,
    maxTokens: 8192,
    compat: BASE_COMPAT,
  },

  // =========================================================================
  // Low-latency NLU & extraction
  // =========================================================================

  "inclusionai/ling-2.6-flash": {
    name: "Ling 2.6 Flash (InclusionAI)",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 262144,
    maxTokens: 8192,
    compat: BASE_COMPAT,
  },

  "meta-llama/llama-3.1-8b-instruct": {
    name: "Llama 3.1 8B (Meta)",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 131072,
    maxTokens: 8192,
    compat: BASE_COMPAT,
  },

  "google/gemma-4-26b-a4b-it": {
    name: "Gemma 4 26B A4B (Google)",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 262144,
    maxTokens: 8192,
    compat: BASE_COMPAT,
  },
};

// ---------------------------------------------------------------------------
// Defaults for discovered models not in KNOWN_MODELS
// ---------------------------------------------------------------------------

const DEFAULT_MODEL: CuratedModel = {
  name: "",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128000,
  maxTokens: 8192,
  compat: BASE_COMPAT,
};

// Heuristic: infer reasoning support from model id for discovered models.
function inferReasoning(id: string): boolean {
  const lower = id.toLowerCase();
  return (
    lower.includes("r1") ||
    lower.includes("reason") ||
    lower.includes("think") ||
    lower.includes("hy3") ||
    lower.includes("k2") ||
    lower.includes("glm-5") ||
    lower.includes("v4") ||
    lower.includes("v3.2") ||
    lower.includes("qwen3") ||
    lower.includes("minimax-m") ||
    lower.includes("deepseek-r")
  );
}

// Heuristic: infer vision support from model id for discovered models.
function inferVision(id: string): boolean {
  const lower = id.toLowerCase();
  return (
    lower.includes("vl") ||
    lower.includes("vision") ||
    lower.includes("k2.5") ||
    lower.includes("gemma-4") ||
    lower.includes("qwen3.5")
  );
}

// Heuristic: infer thinking format from model id for discovered reasoning models.
function inferCompat(id: string, reasoning: boolean): ModelCompat {
  if (!reasoning) return BASE_COMPAT;
  const lower = id.toLowerCase();
  if (lower.includes("deepseek")) return DEEPSEEK_THINKING_COMPAT;
  if (
    lower.includes("glm") ||
    lower.includes("kimi") ||
    lower.includes("qwen") ||
    lower.includes("moonshot")
  ) {
    return QWEN_THINKING_COMPAT;
  }
  return STANDARD_REASONING_COMPAT;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface NovitaModelsResponse {
  data?: Array<{ id: string; object?: string }>;
}

function prettyName(id: string): string {
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
// Context overflow error normalization
//
// Novita returns 400 errors when input exceeds the context window. The error
// messages may not match Pi's built-in overflow patterns, so we normalize them
// to `context_length_exceeded` — the generic fallback Pi recognizes. This
// enables Pi's auto-compaction + retry recovery.
//
// We carefully scope this to the novita provider and match only overflow-like
// phrases, never rate-limit or throttling errors.
// ---------------------------------------------------------------------------

const NOVITA_OVERFLOW_PATTERN =
  /context\s*(length|window|limit)|input\s*length\s*exceed|exceeds?\s*(?:the\s*)?context|too\s*many\s*tokens|maximum\s*context/i;

// ---------------------------------------------------------------------------
// Extension entry point
// ---------------------------------------------------------------------------

export default async function novitaProvider(pi: ExtensionAPI): Promise<void> {
  const apiKey = process.env[API_KEY_ENV];

  if (!apiKey) {
    console.error(
      `[pi-novita] ${API_KEY_ENV} is not set. Run /login in Pi and select ` +
        `"${PROVIDER_DISPLAY_NAME}" to store your key in auth.json, or export ` +
        `${API_KEY_ENV}. Get a key at https://novita.ai/settings/key-management.`,
    );
  }

  // -------------------------------------------------------------------------
  // Build the model list
  // -------------------------------------------------------------------------
  // Prefer dynamic discovery from /v1/models; fall back to the curated set so
  // the extension still works offline / without a valid key.
  // -------------------------------------------------------------------------

  let modelIds: string[];
  const discovered = apiKey ? await discoverModels(apiKey) : null;
  if (discovered) {
    modelIds = discovered;
  } else {
    modelIds = Object.keys(KNOWN_MODELS);
    console.error(
      `[pi-novita] using curated model list (${modelIds.length} models).`,
    );
  }

  // Ensure all curated models are always present even if /v1/models omits them.
  for (const id of Object.keys(KNOWN_MODELS)) {
    if (!modelIds.includes(id)) modelIds.push(id);
  }

  const models = modelIds.map((id) => {
    const known = KNOWN_MODELS[id];

    if (known) {
      return {
        id,
        name: known.name,
        reasoning: known.reasoning,
        input: known.input,
        cost: known.cost,
        contextWindow: known.contextWindow,
        maxTokens: known.maxTokens,
        ...(known.thinkingLevelMap
          ? { thinkingLevelMap: known.thinkingLevelMap }
          : {}),
        ...(known.compat ? { compat: known.compat } : {}),
      };
    }

    // Discovered model not in curated list — infer metadata from id.
    const reasoning = inferReasoning(id);
    const input: ("text" | "image")[] = inferVision(id)
      ? ["text", "image"]
      : ["text"];
    const compat = inferCompat(id, reasoning);

    return {
      id,
      name: prettyName(id),
      reasoning,
      input,
      cost: DEFAULT_MODEL.cost,
      contextWindow: DEFAULT_MODEL.contextWindow,
      maxTokens: DEFAULT_MODEL.maxTokens,
      ...(reasoning
        ? {
            thinkingLevelMap: THINKING_CAN_DISABLE,
            compat,
          }
        : { compat }),
    };
  });

  // -------------------------------------------------------------------------
  // Register the provider
  // -------------------------------------------------------------------------
  // `name` makes "Novita AI" appear in /login.
  // `authHeader: true` adds `Authorization: Bearer <key>` to every request.
  // `apiKey: "$NOVITA_API_KEY"` is the env-var fallback (auth.json via /login
  //   takes priority over this).
  // -------------------------------------------------------------------------

  pi.registerProvider(PROVIDER_NAME, {
    name: PROVIDER_DISPLAY_NAME,
    baseUrl: BASE_URL,
    apiKey: `$${API_KEY_ENV}`,
    authHeader: true,
    api: "openai-completions",
    models,
  });

  // -------------------------------------------------------------------------
  // Context overflow error normalization
  // -------------------------------------------------------------------------
  // Rewrites Novita's overflow error messages so Pi recognizes them and can
  // auto-compact + retry. Runs before Pi tracks the assistant message for
  // auto-compaction, so the rewritten errorMessage is what Pi checks.
  // -------------------------------------------------------------------------

  pi.on("message_end", (event, ctx) => {
    const message = event.message;
    if (message.role !== "assistant") return;
    if (message.stopReason !== "error") return;

    // Scope to our provider only — never touch other providers' errors.
    if (
      message.provider !== PROVIDER_NAME &&
      ctx.model?.provider !== PROVIDER_NAME
    ) {
      return;
    }

    const errorMessage = message.errorMessage ?? "";

    // Skip if already normalized (idempotent).
    if (errorMessage.includes("context_length_exceeded")) return;

    // Only match overflow-like phrases, never rate-limit / throttling errors.
    if (!NOVITA_OVERFLOW_PATTERN.test(errorMessage)) return;

    return {
      message: {
        ...message,
        errorMessage: `context_length_exceeded: ${errorMessage}`,
      },
    };
  });
}
