import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import {
  registerStatusCommand,
  selectProbeModel,
  type ProbeFunction,
} from "../../src/status-command.js";

test("selectProbeModel uses explicit, current, then stable catalog order", () => {
  const ids = ["z/model", "b/model", "a/model"];
  assert.equal(selectProbeModel(" custom/model ", "z/model", ids), "custom/model");
  assert.equal(selectProbeModel(undefined, "z/model", ids), "z/model");
  assert.equal(selectProbeModel(undefined, "other/model", ids), "a/model");
  assert.equal(selectProbeModel(undefined, undefined, ["z/model", "a/model"]), "a/model");
  assert.equal(selectProbeModel(undefined, undefined, []), undefined);
});

test("/novita explains missing credentials without probing", async () => {
  let handler: ((args: string, context: unknown) => Promise<void>) | undefined;
  const pi = {
    registerCommand: (_name: string, options: { handler: typeof handler }) => {
      handler = options.handler;
    },
  } as unknown as ExtensionAPI;
  let probed = false;
  const probe: ProbeFunction = async () => {
    probed = true;
    return { ok: true, detail: "unexpected" };
  };
  registerStatusCommand(pi, ["vendor/model"], probe);
  assert.ok(handler);

  const notices: Array<[string, string]> = [];
  await handler("", {
    modelRegistry: { getApiKeyForProvider: async () => undefined },
    ui: { notify: (message: string, level: string) => notices.push([message, level]) },
  });
  assert.equal(probed, false);
  assert.match(notices[0]?.[0] ?? "", /Run \/login/);
  assert.equal(notices[0]?.[1], "warning");
});

test("/novita probes the selected model and reports provider detail", async () => {
  let handler: ((args: string, context: unknown) => Promise<void>) | undefined;
  const pi = {
    registerCommand: (_name: string, options: { handler: typeof handler }) => {
      handler = options.handler;
    },
  } as unknown as ExtensionAPI;
  let inputs: [string, string] | undefined;
  registerStatusCommand(pi, ["vendor/model"], async (key, model) => {
    inputs = [key, model];
    return {
      ok: false,
      status: 403,
      detail: `${model}: HTTP 403 NOT_ENOUGH_BALANCE: top up`,
    };
  });
  assert.ok(handler);

  const notices: Array<[string, string]> = [];
  await handler("vendor/explicit", {
    modelRegistry: { getApiKeyForProvider: async () => "resolved-key" },
    model: { provider: "novita", id: "vendor/model" },
    ui: { notify: (message: string, level: string) => notices.push([message, level]) },
  });
  assert.deepEqual(inputs, ["resolved-key", "vendor/explicit"]);
  assert.match(notices[0]?.[0] ?? "", /Pi resolved credentials/);
  assert.match(notices[1]?.[0] ?? "", /NOT_ENOUGH_BALANCE/);
  assert.equal(notices[1]?.[1], "error");
});
