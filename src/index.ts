import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { novitaOAuth } from "./auth.js";
import {
  API_KEY_ENV,
  BASE_URL,
  LOG_PREFIX,
  PROVIDER_ID,
  PROVIDER_LABEL,
} from "./config.js";
import { registerErrorDecoder } from "./errors.js";
import { FALLBACK_MODELS } from "./fallback-models.js";
import { toProviderModel } from "./model-mapping.js";
import { fetchModels } from "./novita-api.js";
import { registerStatusCommand } from "./status-command.js";

const DISCOVERY_TIMEOUT_MS = 5000;

export default async function novita(pi: ExtensionAPI): Promise<void> {
  // /v1/models is unauthenticated, so discovery works before any key is
  // configured. The endpoint is the single source of truth for names,
  // capabilities, context windows, and pricing.
  const discovered = await fetchModels(AbortSignal.timeout(DISCOVERY_TIMEOUT_MS));
  if (!discovered) {
    console.error(
      `${LOG_PREFIX} could not reach ${BASE_URL} — registering the bundled ` +
        `snapshot of Novita's recommended models instead.`,
    );
  }

  const models = (discovered ?? FALLBACK_MODELS)
    .map(toProviderModel)
    .filter((model) => model !== null);

  pi.registerProvider(PROVIDER_ID, {
    name: PROVIDER_LABEL,
    baseUrl: BASE_URL,
    apiKey: `$${API_KEY_ENV}`,
    authHeader: true,
    api: "openai-completions",
    models,
    oauth: novitaOAuth,
  });

  registerErrorDecoder(pi);
  registerStatusCommand(pi, models.length);
}
