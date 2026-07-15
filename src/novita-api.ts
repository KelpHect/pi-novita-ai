import { LOG_PREFIX, MODELS_URL } from "./config.js";

interface NovitaModelsResponse {
  data?: Array<{ id?: unknown }>;
}

/** Lists model ids from Novita's /v1/models. Returns null on any failure. */
export async function fetchModelIds(
  apiKey: string,
  signal?: AbortSignal,
): Promise<string[] | null> {
  try {
    const response = await fetch(MODELS_URL, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal,
    });
    if (!response.ok) {
      console.error(
        `${LOG_PREFIX} /v1/models returned ${response.status}: ${await response.text()}`,
      );
      return null;
    }
    const payload = (await response.json()) as NovitaModelsResponse;
    const ids = (payload.data ?? [])
      .map((m) => m.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0);
    return ids.length > 0 ? ids : null;
  } catch (err) {
    console.error(`${LOG_PREFIX} failed to fetch model list: ${String(err)}`);
    return null;
  }
}

/** A key is valid iff it can list models. */
export async function isValidApiKey(apiKey: string): Promise<boolean> {
  return (await fetchModelIds(apiKey)) !== null;
}
