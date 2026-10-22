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

const RETRY_MARKER = "you can retry your request";

test("decodeErrorMessage decodes the OpenAI wrapper and top-level shapes", () => {
  const wrapped = decodeErrorMessage(
    '400: {"error":{"message":"bad things","type":"invalid_request_error","code":null,"param":null}}',
  );
  assert.match(wrapped ?? "", /^Novita invalid_request_error \(HTTP 400\): bad things\. /);
  const topLevel = decodeErrorMessage(
    '429: {"message":"slow down","type":"rate_limit_error"}',
  );
  assert.equal(topLevel, "Novita rate_limit_error (HTTP 429): slow down");
  assert.equal(
    decodeErrorMessage('500: {"message":"boom"}'),
    "Novita error (HTTP 500): boom",
  );
  assert.equal(decodeErrorMessage('{"message":"no status","type":"x"}'), "Novita x: no status");
});

test("decodeErrorMessage keeps Novita shape output unchanged", () => {
  assert.equal(
    decodeErrorMessage(
      '400: {"code":400,"reason":"INVALID_REQUEST_BODY","message":"invalid request error trace_id: abc"}',
    ),
    "Novita INVALID_REQUEST_BODY (HTTP 400): invalid request error trace_id: abc. " +
      "The request was rejected. Reduce the context or report a compatibility issue if the request is otherwise valid",
  );
});

test("retry marker appears only for the intermittent 400 signatures", () => {
  const intermittent = [
    "400 status code (no body)",
    '400: {"message":"invalid request error trace_id: abc123","type":"invalid_request_error"}',
    '400: {"error":{"message":"Invalid Request Error: x","type":"invalid_request_error"}}',
  ];
  for (const message of intermittent) {
    assert.ok(decodeErrorMessage(message)?.includes(RETRY_MARKER), message);
  }

  const withoutMarker = [
    '400: {"message":"max_tokens is too large","type":"invalid_request_error"}',
    '400: {"message":"invalid request error","type":"other_error"}',
    '400: {"message":"invalid request error"}',
    '400: {"code":400,"reason":"INVALID_REQUEST_BODY","message":"invalid request error"}',
    "401 status code (no body)",
    "403 status code (no body)",
    "404 status code (no body)",
    "429 status code (no body)",
    "500 status code (no body)",
    "503 status code (no body)",
    '429: {"message":"slow down","type":"rate_limit_error"}',
  ];
  for (const message of withoutMarker) {
    const decoded = decodeErrorMessage(message);
    assert.ok(decoded, message);
    assert.ok(!decoded.includes(RETRY_MARKER), message);
  }
});

test("bodyless failures get status-specific guidance", () => {
  assert.match(decodeErrorMessage("401 status code (no body)") ?? "", /HTTP 401.*\/login.*\/novita/);
  assert.match(decodeErrorMessage("403 status code (no body)") ?? "", /HTTP 403.*balance.*\/novita/);
  assert.match(decodeErrorMessage("404 status code (no body)") ?? "", /HTTP 404.*model.*\/model/);
  assert.match(decodeErrorMessage("429 status code (no body)") ?? "", /429/);
  assert.match(decodeErrorMessage("502 status code (no body)") ?? "", /502/);
  assert.equal(decodeErrorMessage("418 status code (no body)"), null);
  assert.equal(decodeErrorMessage("400 status code (no body) trailing"), null);
});

test("trace_id is surfaced when it is not already in the message", () => {
  assert.equal(
    decodeErrorMessage('400: {"message":"oops","type":"x","detail":"trace_id: zz1"}'),
    "Novita x (HTTP 400): oops (trace_id zz1)",
  );
  const visible = decodeErrorMessage(
    '400: {"message":"failed trace_id=abc-1","type":"x"}',
  );
  assert.equal(visible, "Novita x (HTTP 400): failed trace_id=abc-1");
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
