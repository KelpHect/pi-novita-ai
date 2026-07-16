import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { FALLBACK_MODELS } from "../../src/fallback-models.js";
import { registerNovita } from "../../src/index.js";

interface RegistrationCapture {
  providerId?: string;
  provider?: Record<string, unknown>;
  command?: string;
  event?: string;
}

function fakePi(capture: RegistrationCapture): ExtensionAPI {
  return {
    registerProvider: (id: string, provider: Record<string, unknown>) => {
      capture.providerId = id;
      capture.provider = provider;
    },
    registerCommand: (name: string) => {
      capture.command = name;
    },
    on: (event: string) => {
      capture.event = event;
    },
  } as unknown as ExtensionAPI;
}

function liveCatalog(data: unknown[]): typeof fetch {
  return async () =>
    new Response(JSON.stringify({ data }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
}

test("registerNovita wires a validated live catalog into Pi", async () => {
  const capture: RegistrationCapture = {};
  await registerNovita(fakePi(capture), {
    fetchOptions: {
      fetchImpl: liveCatalog([
        {
          id: "vendor/live-chat",
          display_name: "Live Chat",
          model_type: "chat",
          endpoints: ["chat/completions"],
          context_size: 32_000,
          max_output_tokens: 4_000,
        },
      ]),
    },
  });

  assert.equal(capture.providerId, "novita");
  assert.equal(capture.provider?.name, "Novita AI");
  assert.equal(capture.provider?.baseUrl, "https://api.novita.ai/openai");
  assert.equal(capture.provider?.apiKey, "$NOVITA_API_KEY");
  assert.equal(capture.provider?.authHeader, true);
  assert.equal(capture.provider?.api, "openai-completions");
  assert.equal(capture.command, "novita");
  assert.equal(capture.event, "message_end");
  const models = capture.provider?.models as Array<{ id: string }>;
  assert.deepEqual(models.map((model) => model.id), ["vendor/live-chat"]);
  assert.equal(typeof capture.provider?.oauth, "object");
});

test("registerNovita uses fallback for network and schema failure", async (t) => {
  t.mock.method(console, "error", () => {});
  for (const fetchImpl of [
    async () => Promise.reject(new Error("offline")),
    async () => new Response('{"unexpected":true}', { status: 200 }),
    async () => new Response("not-json", { status: 200 }),
  ] satisfies Array<typeof fetch>) {
    const capture: RegistrationCapture = {};
    await registerNovita(fakePi(capture), { fetchOptions: { fetchImpl } });
    const models = capture.provider?.models as Array<{ id: string }>;
    assert.equal(models.length, FALLBACK_MODELS.length);
  }
});

test("registerNovita falls back when discovery has no usable chat models", async (t) => {
  t.mock.method(console, "error", () => {});
  const capture: RegistrationCapture = {};
  await registerNovita(fakePi(capture), {
    fetchOptions: {
      fetchImpl: liveCatalog([
        { id: "image-only", model_type: "image" },
        { id: "wrong-endpoint", endpoints: ["anthropic"] },
      ]),
    },
  });
  const models = capture.provider?.models as Array<{ id: string }>;
  assert.equal(models.length, FALLBACK_MODELS.length);
});

test("PI_OFFLINE skips all discovery network access", async () => {
  const previous = process.env.PI_OFFLINE;
  process.env.PI_OFFLINE = "true";
  let called = false;
  try {
    const capture: RegistrationCapture = {};
    await registerNovita(fakePi(capture), {
      fetchOptions: {
        fetchImpl: async () => {
          called = true;
          throw new Error("must not be called");
        },
      },
    });
    const models = capture.provider?.models as Array<{ id: string }>;
    assert.equal(called, false);
    assert.equal(models.length, FALLBACK_MODELS.length);
  } finally {
    if (previous === undefined) delete process.env.PI_OFFLINE;
    else process.env.PI_OFFLINE = previous;
  }
});
