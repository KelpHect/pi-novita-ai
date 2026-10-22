import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import test, { after, before } from "node:test";

import type { Context, Model, ThinkingLevel } from "@earendil-works/pi-ai";
import { streamSimple } from "@earendil-works/pi-ai/compat";

import { decodeErrorMessage } from "../../src/errors.js";
import { toProviderModel } from "../../src/model-mapping.js";
import type { NovitaModel } from "../../src/novita-api.js";

interface Reply {
  status: number;
  body: string;
}

let server: Server;
let baseUrl = "";
let bodies: Record<string, unknown>[] = [];
let reply: Reply | null = null;

before(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      bodies.push(
        JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<
          string,
          unknown
        >,
      );
      if (reply) {
        res.writeHead(reply.status, { "content-type": "application/json" });
        res.end(reply.body);
        return;
      }
      res.writeHead(200, { "content-type": "text/event-stream" });
      const chunk = (delta: object, finish: string | null, extra = {}) =>
        `data: ${JSON.stringify({
          id: "chatcmpl-test",
          object: "chat.completion.chunk",
          created: 1,
          model: "test",
          choices: [{ index: 0, delta, finish_reason: finish }],
          ...extra,
        })}\n\n`;
      res.write(chunk({ role: "assistant", content: "ok" }, null));
      res.write(
        chunk({}, "stop", {
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
      );
      res.end("data: [DONE]\n\n");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function wireModel(id: string): Model<"openai-completions"> {
  const novita: NovitaModel = { id, features: ["reasoning"] };
  const mapped = toProviderModel(novita);
  assert.ok(mapped);
  return {
    ...mapped,
    api: "openai-completions",
    provider: "novita",
    baseUrl,
  } as Model<"openai-completions">;
}

const context: Context = {
  messages: [{ role: "user", content: "hi", timestamp: 1 }],
};

async function captureBody(
  id: string,
  reasoning?: ThinkingLevel,
): Promise<Record<string, unknown>> {
  bodies = [];
  reply = null;
  const result = await streamSimple(wireModel(id), context, {
    apiKey: "test",
    reasoning,
  }).result();
  assert.equal(result.stopReason, "stop", result.errorMessage);
  assert.equal(bodies.length, 1);
  return bodies[0]!;
}

async function errorMessageFor(status: number, body: string): Promise<string> {
  bodies = [];
  reply = { status, body };
  const result = await streamSimple(wireModel("deepseek/deepseek-v4-flash"), context, {
    apiKey: "test",
    maxRetries: 0,
  }).result();
  reply = null;
  assert.equal(result.stopReason, "error");
  return result.errorMessage ?? "";
}

test("deepseek v4 sends the thinking envelope plus reasoning_effort", async () => {
  const on = await captureBody("deepseek/deepseek-v4-flash", "high");
  assert.deepEqual(on.thinking, { type: "enabled" });
  assert.equal(on.reasoning_effort, "high");

  const off = await captureBody("deepseek/deepseek-v4-flash");
  assert.deepEqual(off.thinking, { type: "disabled" });
  assert.ok(!("reasoning_effort" in off));
});

test("glm-5.3 sends no thinking envelope when no effort is selected", async () => {
  for (const id of ["zai-org/glm-5.3", "zai-org/glm-5.3-flash"]) {
    const body = await captureBody(id);
    assert.ok(!("thinking" in body), id);
    assert.ok(!("reasoning_effort" in body), id);
    assert.ok(!("enable_thinking" in body), id);
  }
});

test("glm-5.3 forwards reasoning_effort max without a thinking envelope", async () => {
  for (const id of ["zai-org/glm-5.3", "zai-org/glm-5.3-flash"]) {
    const body = await captureBody(id, "max");
    assert.equal(body.reasoning_effort, "max", id);
    assert.ok(!("thinking" in body), id);
    assert.ok(!("enable_thinking" in body), id);
  }
});

test("glm-5.2 keeps the zai thinking envelope", async () => {
  const on = await captureBody("zai-org/glm-5.2", "max");
  assert.deepEqual(on.thinking, { type: "enabled", clear_thinking: false });
  assert.equal(on.reasoning_effort, "max");

  const off = await captureBody("zai-org/glm-5.2");
  assert.deepEqual(off.thinking, { type: "disabled" });
  assert.ok(!("reasoning_effort" in off));
});

test("generic reasoning models send enable_thinking", async () => {
  const on = await captureBody("qwen/qwen3.5-397b-a17b", "high");
  assert.equal(on.enable_thinking, true);
  const off = await captureBody("qwen/qwen3.5-397b-a17b");
  assert.equal(off.enable_thinking, false);
});

test("pi 1.x surfaces top-level and wrapped error bodies, and decodes them", async () => {
  const intermittent = "invalid request error trace_id: abc123";
  const cases = [
    {
      name: "top-level OpenAI shape",
      body: JSON.stringify({ message: intermittent, type: "invalid_request_error" }),
      errorMessage: `400: {"message":"${intermittent}","type":"invalid_request_error"}`,
      decoded: `Novita invalid_request_error (HTTP 400): ${intermittent}. This is usually an intermittent upstream rejection of a tool-calling continuation; you can retry your request. If it keeps failing, report it to Novita`,
    },
    {
      name: "Novita shape",
      body: JSON.stringify({ code: 400, reason: "INVALID_REQUEST_BODY", message: "bad field" }),
      errorMessage: '400: {"code":400,"reason":"INVALID_REQUEST_BODY","message":"bad field"}',
      decoded:
        "Novita INVALID_REQUEST_BODY (HTTP 400): bad field. The request was rejected. Reduce the context or report a compatibility issue if the request is otherwise valid",
    },
    {
      name: "wrapped OpenAI shape",
      body: JSON.stringify({
        error: { message: intermittent, type: "invalid_request_error", code: null, param: null },
      }),
      errorMessage: `400: {"message":"${intermittent}","type":"invalid_request_error","code":null,"param":null}`,
      decoded: `Novita invalid_request_error (HTTP 400): ${intermittent}. This is usually an intermittent upstream rejection of a tool-calling continuation; you can retry your request. If it keeps failing, report it to Novita`,
    },
    {
      name: "empty body",
      body: "",
      errorMessage: "400 status code (no body)",
      decoded:
        "Novita returned HTTP 400 without a readable error body. This is usually an intermittent upstream rejection of a tool-calling continuation; you can retry your request. If it keeps failing, report it to Novita.",
    },
  ];
  for (const { name, body, errorMessage, decoded } of cases) {
    const observed = await errorMessageFor(400, body);
    assert.equal(observed, errorMessage, name);
    assert.equal(decodeErrorMessage(observed), decoded, name);
  }
});
