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
import { resolveEnvApiKey } from "./auth.js";

const AUTH_FILE = join(homedir(), ".pi", "agent", "auth.json");

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
 * `/novita` — shows which auth path is active and how many models are
 * registered. A missing key is the usual cause of Novita's 403
 * INVALID_API_KEY, so this is the first thing to check.
 */
export function registerStatusCommand(
  pi: ExtensionAPI,
  modelCount: number,
): void {
  pi.registerCommand("novita", {
    description: `Show ${PROVIDER_LABEL} auth status and registered models`,
    handler: async (_args, ctx) => {
      const loggedIn = await hasStoredLogin();
      const envKeySet = resolveEnvApiKey() != null;

      const auth = loggedIn
        ? "logged in via /login (auth.json)"
        : envKeySet
          ? `using ${API_KEY_ENV} environment variable`
          : `NOT CONFIGURED — run /login and select "${PROVIDER_LABEL}", ` +
            `or export ${API_KEY_ENV}. Without a key Novita returns 403 ` +
            `INVALID_API_KEY. Get a key at ${KEY_MANAGEMENT_URL}`;

      ctx.ui.notify(
        `${PROVIDER_LABEL}: ${modelCount} models registered · auth: ${auth}`,
        loggedIn || envKeySet ? "info" : "warning",
      );
    },
  });
}
