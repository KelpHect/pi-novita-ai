import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateCost,
  getSupportedThinkingLevels,
  type Model,
  type Usage,
} from "@earendil-works/pi-ai";

import { toProviderModel } from "../../src/model-mapping.js";
import type { NovitaModel } from "../../src/novita-api.js";

function map(model: NovitaModel) {
  const mapped = toProviderModel(model);
  assert.ok(mapped);
  return mapped;
}

function usage(input: number): Usage {
  return {
    input,
    output: 1_000,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: input + 1_000,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

test("toProviderModel filters unsupported API entries", () => {
  assert.equal(toProviderModel({ id: "image", model_type: "image" }), null);
  assert.equal(
    toProviderModel({ id: "anthropic-only", endpoints: ["anthropic"] }),
    null,
  );
});

test("toProviderModel maps defaults, vision, names, and output bounds", () => {
  const defaults = map({ id: "plain" });
  assert.equal(defaults.name, "plain");
  assert.equal(defaults.contextWindow, 128_000);
  assert.equal(defaults.maxTokens, 4_096);
  assert.deepEqual(defaults.input, ["text"]);

  const vision = map({
    id: "vision",
    display_name: "Vision",
    context_size: 4_000,
    max_output_tokens: 8_000,
    input_modalities: ["text", "image"],
  });
  assert.equal(vision.name, "Vision");
  assert.equal(vision.maxTokens, 4_000);
  assert.deepEqual(vision.input, ["text", "image"]);
});

test("compatibility flags match Novita Chat Completions semantics", () => {
  const plain = map({ id: "plain" });
  assert.deepEqual(plain.compat, {
    supportsDeveloperRole: false,
    maxTokensField: "max_tokens",
    supportsUsageInStreaming: true,
    supportsStore: false,
    supportsStrictMode: true,
  });

  const reasoning = map({ id: "reasoning", features: ["reasoning"] });
  assert.equal(reasoning.reasoning, true);
  assert.equal(reasoning.compat.thinkingFormat, "qwen");
  assert.equal(reasoning.compat.supportsReasoningEffort, false);
  assert.equal(
    reasoning.compat.requiresReasoningContentOnAssistantMessages,
    true,
  );
  assert.equal(reasoning.thinkingLevelMap?.minimal, null);
  assert.equal(reasoning.thinkingLevelMap?.high, "high");
});

test("flat and cache pricing convert Novita units to USD per million tokens", () => {
  const flat = map({
    id: "flat",
    input_token_price_per_m: 2690,
    output_token_price_per_m: 3400,
  });
  assert.deepEqual(flat.cost, {
    input: 0.269,
    output: 0.34,
    cacheRead: 0,
    cacheWrite: 0,
  });

  const rich = map({
    id: "rich",
    pricing: {
      prompt: { price_per_m: 10_000 },
      completion: { price_per_m: 20_000 },
      input_cache_read: { price_per_m: 1_000 },
    },
  });
  assert.deepEqual(rich.cost, {
    input: 1,
    output: 2,
    cacheRead: 0.1,
    cacheWrite: 0,
  });

  assert.deepEqual(map({ id: "zero", input_token_price_per_m: 0 }).cost, {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
  });
  assert.deepEqual(map({ id: "missing-price" }).cost, {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
  });
});

test("deepseek-v4 family matches effort compat and distinct low/high/max levels", () => {
  for (const id of [
    "deepseek/deepseek-v4-flash",
    "deepseek/deepseek-v4-pro",
  ]) {
    const model = map({ id, features: ["reasoning"] });
    assert.equal(model.compat.thinkingFormat, "deepseek", id);
    assert.equal(model.compat.supportsReasoningEffort, true, id);
    assert.equal(
      model.compat.requiresReasoningContentOnAssistantMessages,
      true,
      id,
    );
    // DeepSeek accepts only low/high/max; medium == high and xhigh == high.
    assert.deepEqual(model.thinkingLevelMap, {
      off: "off",
      minimal: null,
      low: "low",
      medium: null,
      high: "high",
      xhigh: null,
      max: "max",
    }, id);
    // off stays reachable (thinking.type: disabled).
    assert.ok(getSupportedThinkingLevels(model as never).includes("off"), id);
  }
});

test("glm-5.3 family has forced thinking with no off level", () => {
  for (const id of ["zai-org/glm-5.3-flash"]) {
    const model = map({ id, features: ["reasoning"] });
    assert.equal(model.compat.thinkingFormat, "zai", id);
    assert.equal(model.compat.supportsReasoningEffort, true, id);
    assert.equal(
      model.compat.requiresReasoningContentOnAssistantMessages,
      true,
      id,
    );
    assert.deepEqual(model.thinkingLevelMap, {
      off: null,
      minimal: null,
      low: "low",
      medium: null,
      high: "high",
      xhigh: null,
      max: "max",
    }, id);
    const levels = getSupportedThinkingLevels(model as never);
    assert.ok(!levels.includes("off"), id);
    assert.deepEqual(levels, ["low", "high", "max"], id);
  }
});

test("glm-5.2 family disables thinking via reasoning_effort none", () => {
  const model = map({ id: "zai-org/glm-5.2", features: ["reasoning"] });
  assert.equal(model.compat.thinkingFormat, "zai");
  assert.equal(model.compat.supportsReasoningEffort, true);
  assert.equal(
    model.compat.requiresReasoningContentOnAssistantMessages,
    true,
  );
  // low/medium -> high and xhigh -> max are aliases, so high/max are the
  // distinct on levels; off maps to the documented "none" value.
  assert.deepEqual(model.thinkingLevelMap, {
    off: "none",
    minimal: null,
    low: null,
    medium: null,
    high: "high",
    xhigh: null,
    max: "max",
  });
  const levels = getSupportedThinkingLevels(model as never);
  assert.deepEqual(levels, ["off", "high", "max"]);
});

test("max is selectable without clamping for effort-based families", () => {
  for (const id of [
    "deepseek/deepseek-v4-flash",
    "deepseek/deepseek-v4-pro",
    "zai-org/glm-5.2",
    "zai-org/glm-5.3-flash",
  ]) {
    const model = map({ id, features: ["reasoning"] });
    assert.equal(getSupportedThinkingLevels(model as never).includes("max"), true, id);
  }
});

test("non-family reasoning models keep the generic enable_thinking behavior", () => {
  for (const id of [
    "deepseek/deepseek-v3.2",
    // Real Novita model from Novita's separate_reasoning documentation.
    "deepseek/deepseek-r1-turbo",
    // Pre-5.2 GLM: real historical model, z.ai documents reasoning_effort
    // only from GLM-5.2 up, so it keeps the generic enable_thinking path.
    "zai-org/glm-4.5",
    "qwen/qwen3.5-397b-a17b",
    "moonshotai/kimi-k2.5",
    "minimax/minimax-m3",
    "google/gemma-4-31b-it",
  ]) {
    const model = map({ id, features: ["reasoning"] });
    assert.equal(model.compat.thinkingFormat, "qwen", id);
    assert.equal(model.compat.supportsReasoningEffort, false, id);
    assert.equal(
      model.compat.requiresReasoningContentOnAssistantMessages,
      true,
      id,
    );
    assert.deepEqual(
      model.thinkingLevelMap,
      {
        off: "off",
        minimal: null,
        low: "low",
        medium: "medium",
        high: "high",
        xhigh: null,
        max: null,
      },
      id,
    );
  }
});

test("family matching is scoped to the exact versions", () => {
  // Prefix edges that must NOT match a family.
  assert.equal(
    map({ id: "deepseek/deepseek-v3.2", features: ["reasoning"] }).compat
      .thinkingFormat,
    "qwen",
  );
  // Intentional negative control: a lookalike id from another org must stay
  // generic, proving the deepseek family is scoped to the deepseek/ org.
  assert.equal(
    map({ id: "vendor/deepseek-v4-mimic", features: ["reasoning"] }).compat
      .thinkingFormat,
    "qwen",
  );
  // Intentional out-of-family control: pre-5.2 GLM versions have no effort
  // vocabulary (z.ai documents reasoning_effort from GLM-5.2 up).
  assert.equal(
    map({ id: "zai-org/glm-4.5-air", features: ["reasoning"] }).compat
      .thinkingFormat,
    "qwen",
  );
  // Non-reasoning models get no map and the base compat even in a family.
  const plain = map({ id: "deepseek/deepseek-v4-flash" });
  assert.equal(plain.reasoning, false);
  assert.equal(plain.thinkingLevelMap, undefined);
  assert.equal("thinkingFormat" in plain.compat, false);
  assert.equal("supportsReasoningEffort" in plain.compat, false);
});

test("tier boundaries activate at Novita's inclusive min_tokens value", () => {
  const mapped = map({
    id: "tiered",
    tiered_billing_configs: [
      {
        min_tokens: 1,
        max_tokens: 524_288,
        pricing: {
          prompt: { price_per_m: 10_000 },
          completion: { price_per_m: 20_000 },
        },
      },
      {
        min_tokens: 524_288,
        max_tokens: 1_000_000,
        pricing: {
          prompt: { price_per_m: 30_000 },
          completion: { price_per_m: 40_000 },
        },
      },
    ],
  });
  assert.equal(mapped.cost.tiers?.[0]?.inputTokensAbove, 524_287);

  const model = mapped as unknown as Model<"openai-completions">;
  assert.equal(calculateCost(model, usage(524_287)).input, 0.524287);
  assert.equal(calculateCost(model, usage(524_288)).input, 1.572864);
});
