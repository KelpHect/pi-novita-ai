import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import {
  API_KEY_ENV,
  KEY_MANAGEMENT_URL,
  PROVIDER_ID,
  PROVIDER_LABEL,
} from "./config.js";
import { probeChatCompletion } from "./novita-api.js";

const AUTH_FILE = join(homedir(), ".pi", "agent", "auth.json");
const PROBE_MODEL = "tencent/hy3";

async function hasStoredLogin(): Promise<boolean> {
  try {
    const auth = JSON.parse(await readFile(AUTH_FILE, "utf8")) as Record<
      string,
      unknown
    >;
    return auth[PROVIDER_ID] != null;
  } catch {
    return false;
  }
}

/**
 * `/novita [model]` — shows the active auth path, then live-probes a chat
 * completion and reports Novita's actual error reason (INVALID_API_KEY,
 * NOT_ENOUGH_BALANCE, ...), which Pi's own error display drops.
 */
export function registerStatusCommand(
  pi: ExtensionAPI,
  modelCount: number,
): void {
  pi.registerCommand("novita", {
    description: `Show ${PROVIDER_LABEL} auth status and test the API`,
    handler: async (args, ctx) => {
      const authSource = (await hasStoredLogin())
        ? "logged in via /login (auth.json)"
        : process.env[API_KEY_ENV]
          ? `using ${API_KEY_ENV} environment variable`
          : null;

      if (!authSource) {
        ctx.ui.notify(
          `${PROVIDER_LABEL}: NOT CONFIGURED — run /login and select ` +
            `"${PROVIDER_LABEL}", or export ${API_KEY_ENV}. ` +
            `Get a key at ${KEY_MANAGEMENT_URL}`,
          "warning",
        );
        return;
      }

      const apiKey = await ctx.modelRegistry.getApiKeyForProvider(PROVIDER_ID);
      if (!apiKey) {
        ctx.ui.notify(
          `${PROVIDER_LABEL}: ${authSource}, but Pi could not resolve an API key from it`,
          "error",
        );
        return;
      }

      const currentNovitaModel =
        ctx.model?.provider === PROVIDER_ID ? ctx.model.id : undefined;
      const model = args?.trim() || currentNovitaModel || PROBE_MODEL;
      ctx.ui.notify(
        `${PROVIDER_LABEL}: ${modelCount} models · ${authSource} · probing ${model}…`,
        "info",
      );
      const probe = await probeChatCompletion(apiKey, model);
      ctx.ui.notify(
        `${PROVIDER_LABEL} probe: ${probe.detail}`,
        probe.ok ? "info" : "error",
      );
    },
  });
}
