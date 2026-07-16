import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { novitaOAuth } from "./auth.js";
import {
  API_KEY_ENV,
  BASE_URL,
  LOG_PREFIX,
  PROVIDER_ID,
  PROVIDER_LABEL,
  REQUEST_TIMEOUT_MS,
} from "./config.js";
import { registerErrorDecoder } from "./errors.js";
import { FALLBACK_MODELS } from "./fallback-models.js";
import { toProviderModel } from "./model-mapping.js";
import { fetchModels, type FetchModelsOptions } from "./novita-api.js";
import { registerStatusCommand } from "./status-command.js";

export interface RegistrationOptions {
  fetchOptions?: Omit<FetchModelsOptions, "signal" | "apiKey">;
}

function isOffline(): boolean {
  return /^(1|true|yes)$/i.test(process.env.PI_OFFLINE ?? "");
}

export async function registerNovita(
  pi: ExtensionAPI,
  options: RegistrationOptions = {},
): Promise<void> {
  // Novita documents authentication for /v1/models, but the endpoint also
  // works without a key as of the fallback refresh date. Use an environment
  // key when available and always retain the bundled fallback.
  const discovered = isOffline()
    ? null
    : await fetchModels({
        ...options.fetchOptions,
        apiKey: process.env[API_KEY_ENV],
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
  if (!discovered && !isOffline()) {
    console.error(
      `${LOG_PREFIX} live model discovery failed. Registering the bundled ` +
        `fallback catalog instead.`,
    );
  } else if (
    discovered &&
    (discovered.rejectedEntries > 0 || discovered.duplicateEntries > 0)
  ) {
    console.warn(
      `${LOG_PREFIX} ignored ${discovered.rejectedEntries} malformed and ` +
        `${discovered.duplicateEntries} duplicate model entries`,
    );
  }

  let models = (discovered?.models ?? FALLBACK_MODELS)
    .map(toProviderModel)
    .filter((model) => model !== null);
  if (models.length === 0 && discovered) {
    console.error(
      `${LOG_PREFIX} live discovery returned no Pi-compatible chat models. ` +
        `Registering the bundled fallback catalog instead.`,
    );
    models = FALLBACK_MODELS.map(toProviderModel).filter(
      (model) => model !== null,
    );
  }

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
  registerStatusCommand(
    pi,
    models.map((model) => model.id),
  );
}

export default function novita(pi: ExtensionAPI): Promise<void> {
  return registerNovita(pi);
}
