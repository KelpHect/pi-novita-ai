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
  thinkingFormat?: "qwen";
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

// The only thinking control Novita documents is the top-level
// `enable_thinking` boolean (default true), exactly Pi's "qwen"
// thinkingFormat. `reasoning_effort` and `thinking: { type }` appear nowhere
// in Novita's docs, so no model gets effort-based compat. Novita's
// interleaved-thinking guide requires echoing reasoning back on subsequent
// assistant messages, hence requiresReasoningContentOnAssistantMessages.
const REASONING_COMPAT: OpenAICompletionsCompat = {
  ...BASE_COMPAT,
  thinkingFormat: "qwen",
  supportsReasoningEffort: false,
  requiresReasoningContentOnAssistantMessages: true,
};

// In "qwen" format only on/off reaches the wire (enable_thinking: boolean).
// The enabled Pi labels are equivalent because Novita exposes no effort level.
const REASONING_LEVELS: ProviderModel["thinkingLevelMap"] = {
  off: "off",
  minimal: null,
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: null,
  max: null,
};

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

  return {
    id: model.id,
    name: model.display_name || model.id,
    reasoning,
    input: model.input_modalities?.includes("image") ? ["text", "image"] : ["text"],
    cost: toCost(model),
    contextWindow,
    maxTokens,
    ...(reasoning ? { thinkingLevelMap: REASONING_LEVELS } : {}),
    compat: reasoning ? REASONING_COMPAT : BASE_COMPAT,
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
