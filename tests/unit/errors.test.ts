import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { decodeErrorMessage, registerErrorDecoder } from "../../src/errors.js";

const documentedReasons = [
  "INVALID_API_KEY",
  "FAILED_TO_AUTH",
  "NOT_ENOUGH_BALANCE",
  "MODEL_NOT_FOUND",
  "INVALID_REQUEST_BODY",
  "RATE_LIMIT_EXCEEDED",
  "TOKEN_LIMIT_EXCEEDED",
  "SERVICE_NOT_AVAILABLE",
  "ACCESS_DENY",
] as const;

test("decodeErrorMessage adds actionable guidance for every documented LLM reason", () => {
  for (const reason of documentedReasons) {
    const decoded = decodeErrorMessage(
      `403: ${JSON.stringify({ code: 403, reason, message: "provider detail" })}`,
    );
    assert.match(decoded ?? "", new RegExp(reason));
    assert.match(decoded ?? "", /provider detail/);
    assert.ok((decoded?.length ?? 0) > "provider detail".length);
  }
});

test("decodeErrorMessage preserves unknown and plain errors safely", () => {
  assert.equal(decodeErrorMessage("502: plain gateway response"), null);
  assert.equal(
    decodeErrorMessage(
      '499: {"code":499,"reason":"NEW_REASON","message":"new detail"}',
    ),
    "Novita NEW_REASON (HTTP 499): new detail",
  );
});

test("decodeErrorMessage normalizes overflow exactly once", () => {
  assert.equal(
    decodeErrorMessage("400: maximum context length was exceeded"),
    "context_length_exceeded: 400: maximum context length was exceeded",
  );
  assert.equal(
    decodeErrorMessage("context_length_exceeded: already normalized"),
    null,
  );
});

test("registered decoder changes Novita assistant errors only", () => {
  type Handler = (
    event: { message: Record<string, unknown> },
    context: { model?: { provider: string } },
  ) => unknown;
  let handler: Handler | undefined;
  const pi = {
    on: (event: string, value: Handler) => {
      assert.equal(event, "message_end");
      handler = value;
    },
  } as unknown as ExtensionAPI;
  registerErrorDecoder(pi);
  assert.ok(handler);

  const novita = handler(
    {
      message: {
        role: "assistant",
        provider: "novita",
        stopReason: "error",
        errorMessage:
          '403: {"code":403,"reason":"NOT_ENOUGH_BALANCE","message":"empty"}',
      },
    },
    {},
  ) as { message: { errorMessage: string } };
  assert.match(novita.message.errorMessage, /Top up/);

  assert.equal(
    handler(
      {
        message: {
          role: "assistant",
          provider: "other",
          stopReason: "error",
          errorMessage: "maximum context length",
        },
      },
      { model: { provider: "other" } },
    ),
    undefined,
  );
  assert.equal(
    handler(
      {
        message: {
          role: "assistant",
          provider: "other",
          stopReason: "error",
          errorMessage: "maximum context length",
        },
      },
      { model: { provider: "novita" } },
    ),
    undefined,
  );
});
