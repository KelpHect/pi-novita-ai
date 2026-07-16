import assert from "node:assert/strict";
import test from "node:test";

import { calculateCost, type Model, type Usage } from "@earendil-works/pi-ai";

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
