import {
  BASE_COMPAT,
  DEEPSEEK_THINKING_COMPAT,
  DISCOVERED_MODEL_DEFAULTS,
  KNOWN_MODELS,
  QWEN_THINKING_COMPAT,
  STANDARD_REASONING_COMPAT,
  THINKING_CAN_DISABLE,
  type CuratedModel,
  type ModelCompat,
} from "./catalog.js";

export interface ProviderModel {
  id: string;
  name: string;
  reasoning: boolean;
  input: ("text" | "image")[];
  cost: CuratedModel["cost"];
  contextWindow: number;
  maxTokens: number;
  thinkingLevelMap?: CuratedModel["thinkingLevelMap"];
  compat?: ModelCompat;
}

/**
 * Builds Pi model configs from discovered model ids merged with the curated
 * catalog. Curated models are always included; discovered ids without a
 * catalog entry get metadata inferred from their id.
 */
export function buildModelList(discoveredIds: string[] | null): ProviderModel[] {
  const ids = discoveredIds ? [...discoveredIds] : Object.keys(KNOWN_MODELS);
  for (const id of Object.keys(KNOWN_MODELS)) {
    if (!ids.includes(id)) ids.push(id);
  }
  return ids.map((id) => KNOWN_MODELS[id] ? fromCatalog(id, KNOWN_MODELS[id]) : fromHeuristics(id));
}

function fromCatalog(id: string, model: CuratedModel): ProviderModel {
  return { id, ...model };
}

function fromHeuristics(id: string): ProviderModel {
  const reasoning = inferReasoning(id);
  return {
    id,
    name: prettyName(id),
    reasoning,
    input: inferVision(id) ? ["text", "image"] : ["text"],
    ...DISCOVERED_MODEL_DEFAULTS,
    ...(reasoning ? { thinkingLevelMap: THINKING_CAN_DISABLE } : {}),
    compat: inferCompat(id, reasoning),
  };
}

// "qwen3" deliberately excludes qwen2.5-vl (vision-only, no reasoning);
// misclassifications belong in the curated catalog, not extra branches here.
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

function inferCompat(id: string, reasoning: boolean): ModelCompat {
  if (!reasoning) return BASE_COMPAT;
  const lower = id.toLowerCase();
  if (lower.includes("deepseek")) return DEEPSEEK_THINKING_COMPAT;
  if (/glm|kimi|qwen|moonshot/.test(lower)) return QWEN_THINKING_COMPAT;
  return STANDARD_REASONING_COMPAT;
}

function prettyName(id: string): string {
  const [vendor, ...rest] = id.split("/");
  const base = (rest.length ? rest.join("/") : vendor) ?? id;
  const pretty = base
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
  return rest.length ? `${pretty} (${vendor})` : pretty;
}
