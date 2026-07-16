import type {
  OAuthCredentials,
  OAuthLoginCallbacks,
} from "@earendil-works/pi-ai";

import { KEY_MANAGEMENT_URL, LOG_PREFIX, PROVIDER_LABEL } from "./config.js";
import { validateApiKey } from "./novita-api.js";
import type { ApiKeyValidationResult } from "./novita-api.js";

// Novita keys never expire, so credentials get a far-future expiry and
// refreshToken returns them unchanged.
const NON_EXPIRING_MS = 9_999_999_999_999;

/**
 * Pi `/login` flow for Novita. The documented balance endpoint validates the
 * key without sending a prompt or consuming model tokens.
 */
export type ApiKeyValidator = (
  apiKey: string,
) => Promise<ApiKeyValidationResult>;

export function createNovitaOAuth(
  validator: ApiKeyValidator = validateApiKey,
): {
  name: string;
  login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials>;
  refreshToken(credentials: OAuthCredentials): Promise<OAuthCredentials>;
  getApiKey(credentials: OAuthCredentials): string;
} {
  return {
    name: PROVIDER_LABEL,

    async login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
      const key = (
        await callbacks.onPrompt({
          message: `Paste your Novita API key (from ${KEY_MANAGEMENT_URL}):`,
        })
      ).trim();

      if (!key) {
        throw new Error(`${LOG_PREFIX} No API key entered.`);
      }
      const validation = await validator(key);
      if (validation.status === "invalid") {
        throw new Error(
          `${LOG_PREFIX} Novita rejected this key. Double-check it was copied ` +
            `correctly from ${KEY_MANAGEMENT_URL}.`,
        );
      }
      if (validation.status === "indeterminate") {
        throw new Error(
          `${LOG_PREFIX} Could not validate the key right now: ` +
            `${validation.detail}. Try again shortly.`,
        );
      }

      return { access: key, refresh: key, expires: NON_EXPIRING_MS };
    },

    async refreshToken(
      credentials: OAuthCredentials,
    ): Promise<OAuthCredentials> {
      return credentials;
    },

    getApiKey(credentials: OAuthCredentials): string {
      return credentials.access;
    },
  };
}

export const novitaOAuth = createNovitaOAuth();
