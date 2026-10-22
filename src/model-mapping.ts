import type {
  NovitaBillingTier,
  NovitaModel,
  NovitaPricing,
} from "./novita-api.js";
import {
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_MAX_TOKENS,
} from "./config.js";

export interface ModelCostRates {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface ModelCost extends ModelCostRates {
  tiers?: (ModelCostRates & { inputTokensAbove: number })[];
}

export interface OpenAICompletionsCompat {
  supportsStore?: boolean;
  supportsDeveloperRole?: boolean;
  supportsReasoningEffort?: boolean;
  supportsUsageInStreaming?: boolean;
  supportsStrictMode?: boolean;
  maxTokensField?: "max_completion_tokens" | "max_tokens";
  requiresReasoningContentOnAssistantMessages?: boolean;
  thinkingFormat?: "qwen" | "deepseek" | "zai";
}

export interface ProviderModel {
  id: string;
  name: string;
  reasoning: boolean;
  input: ("text" | "image")[];
  cost: ModelCost;
  contextWindow: number;
  maxTokens: number;
  thinkingLevelMap?: Partial<
    Record<"off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", string | null>
  >;
  compat: OpenAICompletionsCompat;
}

// Novita's API accepts OpenAI Chat Completions requests with these deviations
// (all verified against https://novita.ai/docs/api-reference/model-apis-llm-create-chat-completion):
// - "system" role only; the "developer" role is not supported
// - `max_tokens` only; `max_completion_tokens` is not supported
// - no Responses-API `store` parameter
// - usage is present in streaming responses via stream_options.include_usage
// Explicit compat matters: Pi's auto-detection assumes OpenAI defaults for
// unknown base URLs (developer role, max_completion_tokens, store).
const BASE_COMPAT: OpenAICompletionsCompat = {
  supportsDeveloperRole: false,
  maxTokensField: "max_tokens",
  supportsUsageInStreaming: true,
  supportsStore: false,
  supportsStrictMode: true,
};

// Novita's own docs (api-reference/model-apis-llm-create-chat-completion,
// re-checked 2026-09-07) document only the top-level `enable_thinking`
// boolean (default true, exactly Pi's "qwen" thinkingFormat) for a fixed set
// of models (zai-org/glm-4.5, deepseek/deepseek-v3.1*); `reasoning_effort`
// appears nowhere in Novita's docs. The effort-based families below therefore
// pin their `reasoning_effort` vocabulary from the upstream vendor docs
// (DeepSeek and Z.ai) instead of Novita's. Novita's interleaved-thinking
// guide requires echoing reasoning back on subsequent assistant messages,
// hence requiresReasoningContentOnAssistantMessages.
const REASONING_COMPAT: OpenAICompletionsCompat = {
  ...BASE_COMPAT,
  thinkingFormat: "qwen",
  supportsReasoningEffort: false,
  requiresReasoningContentOnAssistantMessages: true,
};

// In "qwen" format only on/off reaches the wire (enable_thinking: boolean).
// The enabled Pi labels are equivalent because these models expose no effort
// level through Novita.
const REASONING_LEVELS: ProviderModel["thinkingLevelMap"] = {
  off: "off",
  minimal: null,
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: null,
  max: null,
};

// Effort-based reasoning families carry the effort through the documented
// `reasoning_effort` param instead of `enable_thinking`. The interleaved-
// thinking echo requirement is unchanged.
const EFFORT_REASONING_COMPAT: OpenAICompletionsCompat = {
  ...BASE_COMPAT,
  supportsReasoningEffort: true,
  requiresReasoningContentOnAssistantMessages: true,
};

// DeepSeek v4 toggles thinking with `thinking: { type }` (exactly Pi's
// "deepseek" thinkingFormat) on top of `reasoning_effort`.
const DEEPSEEK_EFFORT_COMPAT: OpenAICompletionsCompat = {
  ...EFFORT_REASONING_COMPAT,
  thinkingFormat: "deepseek",
};

// GLM-5.2/5.3 keep thinking at its API default (enabled for 5.2, forced
// enabled for 5.3) and carry effort through `reasoning_effort` on top of the
// vendor thinking envelope: pi-ai's "zai" thinkingFormat sends
// thinking:{type:"enabled",clear_thinking:false} when an effort is selected
// (z.ai recommends clear_thinking:false for 5.3-Flash) and
// thinking:{type:"disabled"} when off is picked, plus the mapped
// reasoning_effort. Live-probed against Novita's endpoint: both shapes
// accepted, thinking stops on the disabled envelope.
const GLM_EFFORT_COMPAT: OpenAICompletionsCompat = {
  ...EFFORT_REASONING_COMPAT,
  thinkingFormat: "zai",
};

/**
 * A family of reasoning models sharing one `reasoning_effort` vocabulary on
 * Novita, verified against the upstream vendor docs (Novita's own docs do not
 * document the parameter). Supported `levels` map 1:1 (pi name == API value);
 * anything else is hidden (`null`) so pi only offers the real distinct
 * levels. `off` is the value that disables thinking (`null` when the family
 * has forced thinking - pi then omits the off level entirely).
 */
interface ThinkingFamily {
  /** Model-id prefixes identifying the family; first match wins. */
  prefixes: readonly string[];
  /** pi effort levels the family distinguishes natively. */
  levels: readonly ("minimal" | "low" | "medium" | "high" | "xhigh" | "max")[];
  /** Value that disables thinking; null when impossible. */
  off: string | null;
  /** pi-ai thinkingFormat producing the family's wire shape. */
  thinkingFormat: "deepseek" | "zai";
  /** Reference documenting the family's reasoning vocabulary. */
  docs: string;
}

// Scoping is conservative: only versions whose upstream vocabulary is
// verified get effort-based compat. deepseek-v3.2/r1 and GLM versions older
// than 5.2 keep the generic enable_thinking behavior.
const THINKING_FAMILIES: readonly ThinkingFamily[] = [
  {
    // DeepSeek v4 (flash/pro): reasoning_effort accepts ONLY low/high/max
    // (medium == high, xhigh == high); thinking toggles via thinking.type
    // enabled/disabled, so off stays reachable (pi's "deepseek" format).
    prefixes: ["deepseek/deepseek-v4"],
    levels: ["low", "high", "max"],
    off: "off",
    thinkingFormat: "deepseek",
    docs: "https://api-docs.deepseek.com/guides/thinking_mode/",
  },
  {
    // GLM-5.3 and 5.3-Flash use forced thinking - no off value exists.
    // none/minimal/low -> low, medium/high -> high, xhigh/max -> max.
    prefixes: ["zai-org/glm-5.3"],
    levels: ["low", "high", "max"],
    off: null,
    thinkingFormat: "zai",
    docs: "https://docs.z.ai/guides/llm/glm-5.3",
  },
  {
    // GLM-5.2: none disables thinking; low/medium -> high and xhigh -> max
    // are aliases, so high/max are the distinct on levels. Older GLM
    // versions do not support reasoning_effort at all (z.ai documents it
    // from GLM-5.2 up), so they keep the generic qwen behavior.
    prefixes: ["zai-org/glm-5.2"],
    levels: ["high", "max"],
    off: "none",
    thinkingFormat: "zai",
    docs: "https://docs.z.ai/guides/capabilities/thinking",
  },
];

const EFFORT_LEVELS = ["minimal", "low", "medium", "high", "xhigh", "max"] as const;

/** Derive a family's thinkingLevelMap from its supported levels + off value. */
function buildThinkingMap(family: ThinkingFamily): ProviderModel["thinkingLevelMap"] {
  const map: ProviderModel["thinkingLevelMap"] = { off: family.off };
  for (const level of EFFORT_LEVELS) {
    map[level] = family.levels.includes(level) ? level : null;
  }
  return map;
}

interface ResolvedThinkingFamily {
  thinkingLevelMap: ProviderModel["thinkingLevelMap"];
  compat: OpenAICompletionsCompat;
}

/** Derived per-family maps and compat, built once at module load. */
const THINKING_FAMILIES_RESOLVED: ReadonlyArray<
  ResolvedThinkingFamily & { prefixes: readonly string[] }
> = THINKING_FAMILIES.map((family) => ({
  prefixes: family.prefixes,
  thinkingLevelMap: buildThinkingMap(family),
  compat:
    family.thinkingFormat === "deepseek"
      ? DEEPSEEK_EFFORT_COMPAT
      : GLM_EFFORT_COMPAT,
}));

function thinkingFamilyFor(id: string): ResolvedThinkingFamily | undefined {
  return THINKING_FAMILIES_RESOLVED.find((family) =>
    family.prefixes.some((prefix) => id.startsWith(prefix)),
  );
}

// Novita prices are USD per million tokens in units of $0.0001
// (input_token_price_per_m: 2690 = $0.269/M).
const PRICE_UNITS_PER_USD = 10000;

/**
 * Maps a Novita /v1/models entry to a Pi model config, or null for entries
 * Pi cannot serve (non-chat model types, no chat/completions endpoint).
 */
export function toProviderModel(model: NovitaModel): ProviderModel | null {
  if (model.model_type && model.model_type !== "chat") return null;
  if (model.endpoints && !model.endpoints.includes("chat/completions")) {
    return null;
  }

  const reasoning = model.features?.includes("reasoning") ?? false;
  const contextWindow = model.context_size ?? DEFAULT_CONTEXT_WINDOW;
  const advertisedMax = model.max_output_tokens ?? DEFAULT_MAX_TOKENS;
  const maxTokens = Math.min(advertisedMax, contextWindow);

  const family = reasoning ? thinkingFamilyFor(model.id) : undefined;

  return {
    id: model.id,
    name: model.display_name || model.id,
    reasoning,
    input: model.input_modalities?.includes("image") ? ["text", "image"] : ["text"],
    cost: toCost(model),
    contextWindow,
    maxTokens,
    ...(reasoning
      ? { thinkingLevelMap: family ? family.thinkingLevelMap : REASONING_LEVELS }
      : {}),
    compat: reasoning ? (family ? family.compat : REASONING_COMPAT) : BASE_COMPAT,
  };
}

function toCost(model: NovitaModel): ModelCost {
  const tiers = model.tiered_billing_configs;
  if (tiers && tiers.length > 0) {
    const [first, ...rest] = tiers as [
      NovitaBillingTier,
      ...NovitaBillingTier[],
    ];
    const firstIsBase = first.min_tokens <= 1;
    const baseRates = firstIsBase ? ratesFromPricing(first.pricing) : flatCost(model);
    const alternateTiers = firstIsBase ? rest : tiers;
    return {
      ...baseRates,
      tiers: alternateTiers.map((tier) => ({
        // Pi activates a tier when input is strictly greater than this value.
        // Novita names the lower boundary min_tokens, so subtract one to make
        // the tier active at that inclusive boundary.
        inputTokensAbove: Math.max(0, tier.min_tokens - 1),
        ...ratesFromPricing(tier.pricing),
      })),
    };
  }

  if (model.pricing) return ratesFromPricing(model.pricing);

  return flatCost(model);
}

function flatCost(model: NovitaModel): ModelCostRates {
  return {
    input: toUsd(model.input_token_price_per_m),
    output: toUsd(model.output_token_price_per_m),
    cacheRead: 0,
    cacheWrite: 0,
  };
}

function ratesFromPricing(pricing: NovitaPricing): ModelCostRates {
  return {
    input: toUsd(pricing.prompt?.price_per_m),
    output: toUsd(pricing.completion?.price_per_m),
    // Caching is implicit on Novita (no cache_control params) and writes are
    // not billed separately on non-tiered models.
    cacheRead: toUsd(pricing.input_cache_read?.price_per_m),
    cacheWrite: 0,
  };
}

function toUsd(pricePerM: number | undefined): number {
  return (pricePerM ?? 0) / PRICE_UNITS_PER_USD;
}
