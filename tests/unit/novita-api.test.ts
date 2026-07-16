import assert from "node:assert/strict";
import test from "node:test";

import {
  fetchModels,
  isAuthenticationFailure,
  parseModelCatalog,
  parseNovitaError,
  probeChatCompletion,
  validateApiKey,
} from "../../src/novita-api.js";

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("parseModelCatalog validates rich metadata and removes unknown values", () => {
  const parsed = parseModelCatalog({
    data: [
      {
        id: "vendor/model-1",
        display_name: " Model One ",
        context_size: 131_072,
        max_output_tokens: 8_192,
        model_type: "chat",
        endpoints: ["chat/completions", "chat/completions", 42],
        features: ["reasoning", "function-calling", "future-feature"],
        input_modalities: ["text", "image", "file"],
        output_modalities: ["text", "binary"],
        input_token_price_per_m: 2690,
        output_token_price_per_m: 3400,
        pricing: {
          prompt: { price_per_m: 2690 },
          completion: { price_per_m: 3400 },
          input_cache_read: { price_per_m: 300 },
        },
        tiered_billing_configs: [
          {
            min_tokens: 524_288,
            max_tokens: 1_000_000,
            pricing: { prompt: { price_per_m: 5000 } },
          },
          {
            min_tokens: 1,
            max_tokens: 524_288,
            pricing: { prompt: { price_per_m: 2690 } },
          },
        ],
      },
    ],
  });

  assert.ok(parsed);
  assert.equal(parsed.rejectedEntries, 0);
  assert.deepEqual(parsed.models[0], {
    id: "vendor/model-1",
    display_name: "Model One",
    context_size: 131_072,
    max_output_tokens: 8_192,
    model_type: "chat",
    endpoints: ["chat/completions"],
    features: ["reasoning", "function-calling"],
    input_modalities: ["text", "image"],
    output_modalities: ["text"],
    input_token_price_per_m: 2690,
    output_token_price_per_m: 3400,
    pricing: {
      prompt: { price_per_m: 2690 },
      completion: { price_per_m: 3400 },
      input_cache_read: { price_per_m: 300 },
    },
    tiered_billing_configs: [
      {
        min_tokens: 1,
        max_tokens: 524_288,
        pricing: { prompt: { price_per_m: 2690 } },
      },
      {
        min_tokens: 524_288,
        max_tokens: 1_000_000,
        pricing: { prompt: { price_per_m: 5000 } },
      },
    ],
  });
});

test("parseModelCatalog rejects unsafe entries and deterministically deduplicates", () => {
  assert.equal(parseModelCatalog(null), null);
  assert.equal(parseModelCatalog({ data: "not-an-array" }), null);

  const parsed = parseModelCatalog({
    data: [
      null,
      { id: "" },
      { id: "bad id" },
      { id: "valid/model", input_token_price_per_m: -1 },
      { id: "valid/model", display_name: "first" },
      { id: "valid/model", display_name: "duplicate" },
    ],
  });
  assert.ok(parsed);
  assert.equal(parsed.rejectedEntries, 4);
  assert.equal(parsed.duplicateEntries, 1);
  assert.equal(parsed.models[0]?.display_name, "first");
});

test("parseModelCatalog normalizes invalid optional limits instead of poisoning a model", () => {
  const parsed = parseModelCatalog({
    data: [
      {
        id: "valid/model",
        context_size: 0,
        max_output_tokens: Number.POSITIVE_INFINITY,
        pricing: { prompt: { price_per_m: "not-a-number" } },
        tiered_billing_configs: [
          { min_tokens: -1, max_tokens: 10, pricing: {} },
        ],
      },
    ],
  });
  assert.ok(parsed);
  assert.deepEqual(parsed.models, [{ id: "valid/model" }]);
});

test("fetchModels sends optional auth and fails closed on bad responses", async () => {
  let authorization: string | null = null;
  const fetchImpl: typeof fetch = async (_input, init) => {
    authorization = new Headers(init?.headers).get("authorization");
    return jsonResponse({ data: [{ id: "vendor/model" }] });
  };
  const result = await fetchModels({ apiKey: "test-key", fetchImpl });
  assert.equal(authorization, "Bearer test-key");
  assert.equal(result?.models[0]?.id, "vendor/model");

  assert.equal(
    await fetchModels({ fetchImpl: async () => new Response("no", { status: 503 }) }),
    null,
  );
  assert.equal(
    await fetchModels({ fetchImpl: async () => jsonResponse({ data: [] }) }),
    null,
  );
  assert.equal(
    await fetchModels({ fetchImpl: async () => Promise.reject(new Error("offline")) }),
    null,
  );
  assert.equal(
    await fetchModels({
      fetchImpl: async () => new Response("not-json", { status: 200 }),
    }),
    null,
  );

  const controller = new AbortController();
  controller.abort();
  assert.equal(
    await fetchModels({
      signal: controller.signal,
      fetchImpl: async () => {
        throw new DOMException("aborted", "AbortError");
      },
    }),
    null,
  );
});

test("parseNovitaError accepts only the documented structured shape", () => {
  assert.deepEqual(
    parseNovitaError('{"code":401,"reason":"UNAUTHORIZED","message":"key not found"}'),
    { code: 401, reason: "UNAUTHORIZED", message: "key not found" },
  );
  assert.equal(parseNovitaError("gateway unavailable"), null);
  assert.equal(parseNovitaError('{"code":"401","reason":"x","message":"y"}'), null);
});

test("validateApiKey distinguishes valid, invalid, and indeterminate results", async () => {
  const valid = await validateApiKey("key", {
    fetchImpl: async () => jsonResponse({ availableBalance: "123" }),
  });
  assert.equal(valid.status, "valid");

  const invalid = await validateApiKey("key", {
    fetchImpl: async () =>
      jsonResponse(
        { code: 401, reason: "UNAUTHORIZED", message: "key not found" },
        401,
      ),
  });
  assert.equal(invalid.status, "invalid");
  assert.equal(invalid.error?.reason, "UNAUTHORIZED");

  const malformed = await validateApiKey("key", {
    fetchImpl: async () => jsonResponse({ balance: 123 }),
  });
  assert.equal(malformed.status, "indeterminate");

  const unavailable = await validateApiKey("key", {
    fetchImpl: async () =>
      jsonResponse(
        { code: 503, reason: "SERVICE_NOT_AVAILABLE", message: "retry" },
        503,
      ),
  });
  assert.equal(unavailable.status, "indeterminate");

  for (const reason of [
    "NOT_ENOUGH_BALANCE",
    "RATE_LIMIT_EXCEEDED",
    "MODEL_NOT_FOUND",
  ]) {
    const modelSpecific = await validateApiKey("key", {
      fetchImpl: async () =>
        jsonResponse({ code: 403, reason, message: "not an auth failure" }, 403),
    });
    assert.equal(modelSpecific.status, "indeterminate");
  }

  const invalidReason = await validateApiKey("key", {
    fetchImpl: async () =>
      jsonResponse(
        { code: 403, reason: "FAILED_TO_AUTH", message: "rejected" },
        403,
      ),
  });
  assert.equal(invalidReason.status, "invalid");
});

test("authentication failure classification uses status and provider reason", () => {
  assert.equal(isAuthenticationFailure(401, null), true);
  assert.equal(
    isAuthenticationFailure(403, {
      code: 403,
      reason: "INVALID_API_KEY",
      message: "bad key",
    }),
    true,
  );
  assert.equal(
    isAuthenticationFailure(403, {
      code: 403,
      reason: "ACCESS_DENY",
      message: "model denied",
    }),
    false,
  );
});

test("probeChatCompletion validates success and preserves structured failures", async () => {
  let requestBody: unknown;
  const success = await probeChatCompletion("secret", "vendor/model", {
    fetchImpl: async (_input, init) => {
      requestBody = JSON.parse(String(init?.body)) as unknown;
      return jsonResponse({ choices: [{ message: { content: "OK" } }] });
    },
  });
  assert.equal(success.ok, true);
  assert.deepEqual(requestBody, {
    model: "vendor/model",
    messages: [{ role: "user", content: "Reply with OK." }],
    max_tokens: 1,
  });

  const malformed = await probeChatCompletion("secret", "vendor/model", {
    fetchImpl: async () => jsonResponse({ id: "missing-choices" }),
  });
  assert.match(malformed.detail, /malformed completion JSON/);

  const denied = await probeChatCompletion("secret", "vendor/model", {
    fetchImpl: async () =>
      jsonResponse(
        { code: 403, reason: "NOT_ENOUGH_BALANCE", message: "top up" },
        403,
      ),
  });
  assert.equal(denied.error?.reason, "NOT_ENOUGH_BALANCE");
  assert.doesNotMatch(denied.detail, /secret/);

  const invalidJson = await probeChatCompletion("secret", "vendor/model", {
    fetchImpl: async () => new Response("not-json", { status: 200 }),
  });
  assert.match(invalidJson.detail, /invalid completion JSON/);

  const plainText = await probeChatCompletion("secret", "vendor/model", {
    fetchImpl: async () => new Response("gateway unavailable", { status: 502 }),
  });
  assert.match(plainText.detail, /HTTP 502: gateway unavailable/);

  const network = await probeChatCompletion("secret", "vendor/model", {
    fetchImpl: async () => Promise.reject(new Error("connection reset with secret")),
  });
  assert.match(network.detail, /network request failed/);
  assert.doesNotMatch(network.detail, /secret/);
});

test("request helpers classify abort and timeout errors without leaking secrets", async () => {
  const controller = new AbortController();
  controller.abort();
  const abortingFetch: typeof fetch = async () => {
    throw new DOMException("aborted", "AbortError");
  };
  const probe = await probeChatCompletion("do-not-leak", "vendor/model", {
    signal: controller.signal,
    fetchImpl: abortingFetch,
  });
  assert.match(probe.detail, /timed out or was aborted/);
  assert.doesNotMatch(probe.detail, /do-not-leak/);

  const validation = await validateApiKey("do-not-leak", {
    fetchImpl: async () => {
      const error = new Error("expired");
      error.name = "TimeoutError";
      throw error;
    },
  });
  assert.equal(validation.status, "indeterminate");
  assert.match(validation.detail, /timed out/);
});
