import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { novitaOAuth, resolveEnvApiKey } from "./auth.js";
import {
  API_KEY_ENV,
  BASE_URL,
  LOG_PREFIX,
  PROVIDER_ID,
  PROVIDER_LABEL,
} from "./config.js";
import { buildModelList } from "./model-list.js";
import { fetchModelIds } from "./novita-api.js";
import { registerOverflowRecovery } from "./overflow.js";
import { registerStatusCommand } from "./status-command.js";

export default async function novita(pi: ExtensionAPI): Promise<void> {
  // Startup discovery needs the env key; /login users still get the full
  // curated catalog, and their stored key authenticates the actual requests.
  const envKey = resolveEnvApiKey();
  const discoveredIds = envKey ? await fetchModelIds(envKey) : null;
  if (!discoveredIds) {
    console.error(
      `${LOG_PREFIX} ${envKey ? "model discovery failed" : `${API_KEY_ENV} not set`}; ` +
        `using the curated model list. Run /novita to check auth status.`,
    );
  }
  const models = buildModelList(discoveredIds);

  pi.registerProvider(PROVIDER_ID, {
    name: PROVIDER_LABEL,
    baseUrl: BASE_URL,
    apiKey: `$${API_KEY_ENV}`,
    authHeader: true,
    api: "openai-completions",
    models,
    oauth: novitaOAuth,
  });

  registerOverflowRecovery(pi);
  registerStatusCommand(pi, models.length);
}
