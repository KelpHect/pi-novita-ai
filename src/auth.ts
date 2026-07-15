import {
  API_KEY_ENV,
  KEY_MANAGEMENT_URL,
  LOG_PREFIX,
  MODELS_URL,
  PROVIDER_LABEL,
} from "./config.js";
import { isValidApiKey } from "./novita-api.js";

// Structural match for Pi's OAuthCredentials (not re-exported by the
// package's main entry point).
interface OAuthCredentials {
  refresh: string;
  access: string;
  expires: number;
  [key: string]: unknown;
}

interface OAuthLoginCallbacks {
  onPrompt(params: { message: string }): Promise<string>;
}

// Novita keys never expire, so credentials get a far-future expiry and
// refreshToken returns them unchanged.
const NON_EXPIRING_MS = 9_999_999_999_999;

export function resolveEnvApiKey(): string | undefined {
  return process.env[API_KEY_ENV];
}

/**
 * Pi `/login` flow for Novita: paste an API key (Novita has no browser
 * OAuth), validate it against /v1/models, and let Pi persist it to auth.json.
 */
export const novitaOAuth = {
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
    if (!(await isValidApiKey(key))) {
      throw new Error(
        `${LOG_PREFIX} Key rejected by ${MODELS_URL}. Double-check it was copied correctly.`,
      );
    }

    return { access: key, refresh: key, expires: NON_EXPIRING_MS };
  },

  async refreshToken(credentials: OAuthCredentials): Promise<OAuthCredentials> {
    return credentials;
  },

  getApiKey(credentials: OAuthCredentials): string {
    return credentials.access;
  },
};
