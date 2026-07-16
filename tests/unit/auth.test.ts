import assert from "node:assert/strict";
import test from "node:test";
import type { OAuthLoginCallbacks } from "@earendil-works/pi-ai";

import { createNovitaOAuth } from "../../src/auth.js";

function callbacks(value: string): OAuthLoginCallbacks {
  return {
    onAuth: () => {},
    onDeviceCode: () => {},
    onPrompt: async () => value,
    onSelect: async () => undefined,
  };
}

test("login trims and stores a key only after positive validation", async () => {
  let validated = "";
  const oauth = createNovitaOAuth(async (key) => {
    validated = key;
    return { status: "valid", detail: "accepted" };
  });
  const credentials = await oauth.login(callbacks("  key-value  "));
  assert.equal(validated, "key-value");
  assert.equal(credentials.access, "key-value");
  assert.equal(credentials.refresh, "key-value");
  assert.ok(credentials.expires > Date.now());
  assert.equal(oauth.getApiKey(credentials), "key-value");
  assert.equal(await oauth.refreshToken(credentials), credentials);
});

test("login rejects empty, invalid, and indeterminate keys", async () => {
  const valid = createNovitaOAuth(async () => ({
    status: "valid",
    detail: "accepted",
  }));
  await assert.rejects(() => valid.login(callbacks("   ")), /No API key entered/);

  const invalid = createNovitaOAuth(async () => ({
    status: "invalid",
    detail: "rejected",
  }));
  await assert.rejects(() => invalid.login(callbacks("key")), /rejected this key/);

  const unavailable = createNovitaOAuth(async () => ({
    status: "indeterminate",
    detail: "service unavailable",
  }));
  await assert.rejects(
    () => unavailable.login(callbacks("key")),
    /Could not validate.*service unavailable/,
  );
});
