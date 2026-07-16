import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import {
  API_KEY_ENV,
  KEY_MANAGEMENT_URL,
  PROVIDER_ID,
  PROVIDER_LABEL,
} from "./config.js";
import { probeChatCompletion } from "./novita-api.js";

export type ProbeFunction = typeof probeChatCompletion;

export function selectProbeModel(
  requested: string | undefined,
  current: string | undefined,
  modelIds: readonly string[],
): string | undefined {
  const explicit = requested?.trim();
  if (explicit) return explicit;
  if (current && modelIds.includes(current)) return current;
  return [...modelIds].sort((left, right) => left.localeCompare(right))[0];
}

/**
 * `/novita [model]` checks whether Pi resolves credentials, then live-probes
 * a chat completion and reports Novita's actual error reason (INVALID_API_KEY,
 * NOT_ENOUGH_BALANCE, ...), which Pi's own error display drops.
 */
export function registerStatusCommand(
  pi: ExtensionAPI,
  modelIds: readonly string[],
  probe: ProbeFunction = probeChatCompletion,
): void {
  pi.registerCommand("novita", {
    description: `Show ${PROVIDER_LABEL} auth status and test the API`,
    handler: async (args, ctx) => {
      const apiKey = await ctx.modelRegistry.getApiKeyForProvider(PROVIDER_ID);
      if (!apiKey) {
        ctx.ui.notify(
          `${PROVIDER_LABEL}: not configured. Run /login and select ` +
            `"${PROVIDER_LABEL}", or export ${API_KEY_ENV}. ` +
            `Get a key at ${KEY_MANAGEMENT_URL}`,
          "warning",
        );
        return;
      }

      const currentNovitaModel =
        ctx.model?.provider === PROVIDER_ID ? ctx.model.id : undefined;
      const model = selectProbeModel(args, currentNovitaModel, modelIds);
      if (!model) {
        ctx.ui.notify(`${PROVIDER_LABEL}: no usable model is registered`, "error");
        return;
      }
      ctx.ui.notify(
        `${PROVIDER_LABEL}: Pi resolved credentials, ${modelIds.length} models ` +
          `registered, probing ${model}`,
        "info",
      );
      const result = await probe(apiKey, model);
      ctx.ui.notify(
        `${PROVIDER_LABEL} probe: ${result.detail}`,
        result.ok ? "info" : "error",
      );
    },
  });
}
