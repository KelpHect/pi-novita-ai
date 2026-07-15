export type ThinkingFormat =
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

export interface ModelCompat {
  supportsStore?: boolean;
  supportsDeveloperRole?: boolean;
  supportsReasoningEffort?: boolean;
  supportsUsageInStreaming?: boolean;
  maxTokensField?: "max_completion_tokens" | "max_tokens";
  requiresToolResultName?: boolean;
  requiresAssistantAfterToolResult?: boolean;
  requiresThinkingAsText?: boolean;
  requiresReasoningContentOnAssistantMessages?: boolean;
  thinkingFormat?: ThinkingFormat;
  cacheControlFormat?: "anthropic";
}

export type ThinkingLevel =
  | "off"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";

export type ThinkingLevelMap = Partial<Record<ThinkingLevel, string | null>>;

export interface ModelCost {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface CuratedModel {
  name: string;
  reasoning: boolean;
  input: ("text" | "image")[];
  cost: ModelCost;
  contextWindow: number;
  maxTokens: number;
  thinkingLevelMap?: ThinkingLevelMap;
  compat?: ModelCompat;
}

// Novita is OpenAI Chat Completions compatible: "system" role (not
// "developer"), `max_tokens` (not `max_completion_tokens`), usage present in
// streaming, no Responses-API `store` parameter.
export const BASE_COMPAT: ModelCompat = {
  supportsDeveloperRole: false,
  maxTokensField: "max_tokens",
  supportsUsageInStreaming: true,
  supportsStore: false,
};

// Novita controls thinking per model family:
// - GLM / Kimi / Qwen: top-level `enable_thinking` → Pi's "qwen" format
// - DeepSeek: `thinking: { type }` + `reasoning_effort` → Pi's "deepseek" format
// Novita's interleaved-thinking docs require reasoning_content on subsequent
// assistant messages, hence requiresReasoningContentOnAssistantMessages.
export const QWEN_THINKING_COMPAT: ModelCompat = {
  ...BASE_COMPAT,
  thinkingFormat: "qwen",
  supportsReasoningEffort: false,
  requiresReasoningContentOnAssistantMessages: true,
};

export const DEEPSEEK_THINKING_COMPAT: ModelCompat = {
  ...BASE_COMPAT,
  thinkingFormat: "deepseek",
  supportsReasoningEffort: true,
  requiresReasoningContentOnAssistantMessages: true,
};

export const STANDARD_REASONING_COMPAT: ModelCompat = {
  ...BASE_COMPAT,
  supportsReasoningEffort: true,
  requiresReasoningContentOnAssistantMessages: true,
};

// null hides a level from Pi's thinking selector.
export const THINKING_CAN_DISABLE: ThinkingLevelMap = {
  off: "off",
  minimal: null,
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: null,
  max: null,
};

export const THINKING_FULL_RANGE: ThinkingLevelMap = {
  off: "off",
  minimal: null,
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: null,
  max: "max",
};

const FREE: ModelCost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

// Sources: Novita recommended-models table, model detail pages, and the
// function-calling / vision / structured-outputs / interleaved-thinking docs.
// All costs are $0 because Novita's per-model rates change often; Pi simply
// skips cost estimates for $0 models. Replace with rates from
// https://novita.ai/pricing for accurate tracking.
export const KNOWN_MODELS: Record<string, CuratedModel> = {
  "tencent/hy3": {
    name: "Hy3 (Tencent Hunyuan)",
    reasoning: true,
    input: ["text"],
    cost: FREE,
    contextWindow: 262144,
    maxTokens: 262144,
    thinkingLevelMap: THINKING_FULL_RANGE,
    compat: STANDARD_REASONING_COMPAT,
  },

  "moonshotai/kimi-k2.7-code": {
    name: "Kimi K2.7 Code (Moonshot)",
    reasoning: true,
    input: ["text"],
    cost: FREE,
    contextWindow: 262144,
    maxTokens: 65536,
    thinkingLevelMap: THINKING_CAN_DISABLE,
    compat: QWEN_THINKING_COMPAT,
  },

  "zai-org/glm-5.2": {
    name: "GLM 5.2 (Zhipu)",
    reasoning: true,
    input: ["text"],
    cost: FREE,
    contextWindow: 1048576,
    maxTokens: 65536,
    thinkingLevelMap: THINKING_CAN_DISABLE,
    compat: QWEN_THINKING_COMPAT,
  },

  "deepseek/deepseek-v4-pro": {
    name: "DeepSeek V4 Pro",
    reasoning: true,
    input: ["text"],
    cost: FREE,
    contextWindow: 1048576,
    maxTokens: 65536,
    thinkingLevelMap: THINKING_CAN_DISABLE,
    compat: DEEPSEEK_THINKING_COMPAT,
  },

  "deepseek/deepseek-v3.2": {
    name: "DeepSeek V3.2",
    reasoning: true,
    input: ["text"],
    cost: FREE,
    contextWindow: 163840,
    maxTokens: 32768,
    thinkingLevelMap: THINKING_CAN_DISABLE,
    compat: DEEPSEEK_THINKING_COMPAT,
  },

  "qwen/qwen3.5-397b-a17b": {
    name: "Qwen 3.5 397B (17B active)",
    reasoning: true,
    input: ["text", "image"],
    cost: FREE,
    contextWindow: 262144,
    maxTokens: 32768,
    thinkingLevelMap: THINKING_CAN_DISABLE,
    compat: QWEN_THINKING_COMPAT,
  },

  "minimax/minimax-m3": {
    name: "MiniMax M3",
    reasoning: true,
    input: ["text"],
    cost: FREE,
    contextWindow: 1048576,
    maxTokens: 65536,
    thinkingLevelMap: THINKING_CAN_DISABLE,
    compat: STANDARD_REASONING_COMPAT,
  },

  "deepseek/deepseek-v4-flash": {
    name: "DeepSeek V4 Flash",
    reasoning: true,
    input: ["text"],
    cost: FREE,
    contextWindow: 1048576,
    maxTokens: 65536,
    thinkingLevelMap: THINKING_CAN_DISABLE,
    compat: DEEPSEEK_THINKING_COMPAT,
  },

  "moonshotai/kimi-k2.5": {
    name: "Kimi K2.5 (Moonshot)",
    reasoning: true,
    input: ["text", "image"],
    cost: FREE,
    contextWindow: 262144,
    maxTokens: 32768,
    thinkingLevelMap: THINKING_CAN_DISABLE,
    compat: QWEN_THINKING_COMPAT,
  },

  "google/gemma-4-31b-it": {
    name: "Gemma 4 31B (Google)",
    reasoning: false,
    input: ["text", "image"],
    cost: FREE,
    contextWindow: 262144,
    maxTokens: 8192,
    compat: BASE_COMPAT,
  },

  "inclusionai/ling-2.6-flash": {
    name: "Ling 2.6 Flash (InclusionAI)",
    reasoning: false,
    input: ["text"],
    cost: FREE,
    contextWindow: 262144,
    maxTokens: 8192,
    compat: BASE_COMPAT,
  },

  "meta-llama/llama-3.1-8b-instruct": {
    name: "Llama 3.1 8B (Meta)",
    reasoning: false,
    input: ["text"],
    cost: FREE,
    contextWindow: 131072,
    maxTokens: 8192,
    compat: BASE_COMPAT,
  },

  "google/gemma-4-26b-a4b-it": {
    name: "Gemma 4 26B A4B (Google)",
    reasoning: false,
    input: ["text"],
    cost: FREE,
    contextWindow: 262144,
    maxTokens: 8192,
    compat: BASE_COMPAT,
  },

  "deepseek/deepseek_v3": {
    name: "DeepSeek V3",
    reasoning: false,
    input: ["text"],
    cost: FREE,
    contextWindow: 163840,
    maxTokens: 8192,
    compat: BASE_COMPAT,
  },

  "mistralai/mistral-7b-instruct": {
    name: "Mistral 7B Instruct",
    reasoning: false,
    input: ["text"],
    cost: FREE,
    contextWindow: 32768,
    maxTokens: 4096,
    compat: BASE_COMPAT,
  },

  // Curated explicitly: the "qwen" heuristic would misclassify this
  // vision-only model as reasoning.
  "qwen/qwen2.5-vl-72b-instruct": {
    name: "Qwen 2.5 VL 72B (Vision)",
    reasoning: false,
    input: ["text", "image"],
    cost: FREE,
    contextWindow: 131072,
    maxTokens: 8192,
    compat: BASE_COMPAT,
  },

  "minimax/minimax-m2": {
    name: "MiniMax M2",
    reasoning: true,
    input: ["text"],
    cost: FREE,
    contextWindow: 1048576,
    maxTokens: 65536,
    thinkingLevelMap: THINKING_CAN_DISABLE,
    compat: STANDARD_REASONING_COMPAT,
  },

  // Legacy models from Novita's migration table.
  "deepseek/deepseek-r1-0528": {
    name: "DeepSeek R1 (0528) — legacy",
    reasoning: true,
    input: ["text"],
    cost: FREE,
    contextWindow: 163840,
    maxTokens: 32768,
    thinkingLevelMap: THINKING_CAN_DISABLE,
    compat: DEEPSEEK_THINKING_COMPAT,
  },

  "zai-org/glm-4.5": {
    name: "GLM 4.5 (Zhipu) — legacy",
    reasoning: true,
    input: ["text"],
    cost: FREE,
    contextWindow: 131072,
    maxTokens: 8192,
    thinkingLevelMap: THINKING_CAN_DISABLE,
    compat: QWEN_THINKING_COMPAT,
  },

  "moonshotai/kimi-k2-instruct": {
    name: "Kimi K2 Instruct (Moonshot) — legacy",
    reasoning: true,
    input: ["text"],
    cost: FREE,
    contextWindow: 262144,
    maxTokens: 32768,
    thinkingLevelMap: THINKING_CAN_DISABLE,
    compat: QWEN_THINKING_COMPAT,
  },

  "qwen/qwen3-coder-480b-a35b-instruct": {
    name: "Qwen 3 Coder 480B (35B active) — legacy",
    reasoning: false,
    input: ["text"],
    cost: FREE,
    contextWindow: 262144,
    maxTokens: 32768,
    compat: BASE_COMPAT,
  },

  "meta-llama/llama-4-maverick": {
    name: "Llama 4 Maverick (Meta) — legacy",
    reasoning: false,
    input: ["text", "image"],
    cost: FREE,
    contextWindow: 1048576,
    maxTokens: 8192,
    compat: BASE_COMPAT,
  },

  "meta-llama/llama-4-scout": {
    name: "Llama 4 Scout (Meta) — legacy",
    reasoning: false,
    input: ["text", "image"],
    cost: FREE,
    contextWindow: 1048576,
    maxTokens: 8192,
    compat: BASE_COMPAT,
  },
};

export const DISCOVERED_MODEL_DEFAULTS = {
  cost: FREE,
  contextWindow: 128000,
  maxTokens: 8192,
} as const;
