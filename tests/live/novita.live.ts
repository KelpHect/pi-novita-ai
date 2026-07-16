import assert from "node:assert/strict";
import test from "node:test";

import { BASE_URL, MODELS_URL } from "../../src/config.js";
import { fetchModels, validateApiKey } from "../../src/novita-api.js";

const apiKey = process.env.NOVITA_API_KEY;
const keySkip = apiKey ? false : "NOVITA_API_KEY is not set";
const chatModel = process.env.NOVITA_TEST_MODEL;
const toolModel = process.env.NOVITA_TOOL_TEST_MODEL;
const reasoningModel = process.env.NOVITA_REASONING_TEST_MODEL;

async function postChat(body: Record<string, unknown>): Promise<Response> {
  assert.ok(apiKey);
  return fetch(`${BASE_URL}/v1/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
}

async function responseJson(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  assert.equal(response.ok, true, `HTTP ${response.status}: ${text.slice(0, 500)}`);
  const payload = JSON.parse(text) as unknown;
  assert.equal(typeof payload, "object");
  assert.notEqual(payload, null);
  return payload as Record<string, unknown>;
}

test("live catalog is reachable and validates against the defensive parser", { skip: keySkip }, async () => {
  assert.ok(apiKey);
  const catalog = await fetchModels({
    apiKey,
    signal: AbortSignal.timeout(15_000),
  });
  assert.ok(catalog);
  assert.ok(catalog.models.length > 0);
  if (chatModel) {
    assert.ok(catalog.models.some((model) => model.id === chatModel));
  }

  const raw = await fetch(MODELS_URL, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(15_000),
  });
  assert.equal(raw.ok, true);
});

test("live balance endpoint positively validates the configured key", { skip: keySkip }, async () => {
  assert.ok(apiKey);
  const validation = await validateApiKey(apiKey, {
    signal: AbortSignal.timeout(15_000),
  });
  assert.equal(validation.status, "valid", validation.detail);
});

test("live streaming completion reports content, DONE, and usage", {
  skip: !apiKey
    ? "NOVITA_API_KEY is not set"
    : !chatModel
      ? "NOVITA_TEST_MODEL is not set"
      : false,
}, async () => {
  assert.ok(chatModel);
  const response = await postChat({
    model: chatModel,
    messages: [{ role: "user", content: "Reply with exactly OK." }],
    max_tokens: 8,
    stream: true,
    stream_options: { include_usage: true },
  });
  if (!response.ok) {
    assert.fail(`HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`);
  }
  assert.ok(response.body);

  const text = await response.text();
  const frames = text
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data: "))
    .map((line) => line.slice(6));
  assert.ok(frames.includes("[DONE]"), "stream did not terminate with [DONE]");
  const payloads = frames
    .filter((frame) => frame !== "[DONE]")
    .map((frame) => JSON.parse(frame) as Record<string, unknown>);
  assert.ok(payloads.length > 0);
  assert.ok(payloads.some((payload) => payload.usage !== undefined));
});

test(
  "live tool-call round trip preserves assistant reasoning fields",
  {
    skip: !apiKey
      ? "NOVITA_API_KEY is not set"
      : !toolModel
        ? "NOVITA_TOOL_TEST_MODEL is not set"
        : false,
  },
  async () => {
    assert.ok(toolModel);
    const first = await responseJson(
      await postChat({
        model: toolModel,
        messages: [
          {
            role: "user",
            content: "Use lookup_code to retrieve alpha. Do not answer directly.",
          },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "lookup_code",
              description: "Retrieve a short code",
              parameters: {
                type: "object",
                properties: { name: { type: "string" } },
                required: ["name"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "lookup_code" } },
        max_tokens: 128,
      }),
    );
    const firstChoices = first.choices as Array<{ message: Record<string, unknown> }>;
    const assistant = firstChoices[0]?.message;
    assert.ok(assistant);
    const toolCalls = assistant.tool_calls as Array<{ id: string }>;
    assert.ok(toolCalls?.[0]?.id);

    const second = await responseJson(
      await postChat({
        model: toolModel,
        messages: [
          {
            role: "user",
            content: "Use lookup_code to retrieve alpha. Do not answer directly.",
          },
          assistant,
          {
            role: "tool",
            tool_call_id: toolCalls[0].id,
            content: '{"code":"ALPHA-42"}',
          },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "lookup_code",
              description: "Retrieve a short code",
              parameters: { type: "object", properties: {} },
            },
          },
        ],
        max_tokens: 64,
      }),
    );
    const secondChoices = second.choices as Array<{ message: { content?: string } }>;
    assert.match(secondChoices[0]?.message.content ?? "", /ALPHA-42/i);
  },
);

test(
  "live reasoning model emits a documented reasoning field",
  {
    skip: !apiKey
      ? "NOVITA_API_KEY is not set"
      : !reasoningModel
        ? "NOVITA_REASONING_TEST_MODEL is not set"
        : false,
  },
  async () => {
    assert.ok(reasoningModel);
    const payload = await responseJson(
      await postChat({
        model: reasoningModel,
        messages: [{ role: "user", content: "What is 17 plus 25?" }],
        enable_thinking: true,
        max_tokens: 128,
      }),
    );
    const choices = payload.choices as Array<{ message: Record<string, unknown> }>;
    const message = choices[0]?.message;
    assert.ok(message);
    assert.ok(
      typeof message.reasoning_content === "string" ||
        Array.isArray(message.reasoning_details),
      "response contained neither reasoning_content nor reasoning_details",
    );
  },
);
