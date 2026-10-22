import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { KEY_MANAGEMENT_URL, PROVIDER_ID } from "./config.js";
import { parseNovitaError, parseOpenAIStyleError } from "./novita-api.js";

// Documented at https://novita.ai/docs/api-reference/basic-error-code.
const GUIDANCE: Record<string, string> = {
  INVALID_API_KEY: `No valid API key was sent. Run /login and select "Novita AI", or check /novita. Keys: ${KEY_MANAGEMENT_URL}`,
  FAILED_TO_AUTH: `The API key was rejected. Re-run /login with a fresh key from ${KEY_MANAGEMENT_URL}`,
  NOT_ENOUGH_BALANCE:
    "Your Novita account balance is empty. Top up or redeem credits at https://novita.ai/billing",
  MODEL_NOT_FOUND: "This model id is not available on Novita. Pick another with /model",
  INVALID_REQUEST_BODY: "The request was rejected. Reduce the context or report a compatibility issue if the request is otherwise valid",
  RATE_LIMIT_EXCEEDED: "Novita rate limit hit. Retry shortly, or raise limits at https://novita.ai/quota-limits/llm",
  TOKEN_LIMIT_EXCEEDED: "Novita token-throughput limit hit. Retry shortly, or raise limits at https://novita.ai/quota-limits/llm",
  SERVICE_NOT_AVAILABLE: "Novita reports the service is temporarily unavailable. Retry shortly",
  ACCESS_DENY: "Novita denied access to this model or endpoint for your account",
};

// Pi triggers auto-compaction + retry when an error message contains this
// marker. Novita normally absorbs overflow by lowering max_tokens, but
// INVALID_REQUEST_BODY responses can still carry overflow phrasing.
const OVERFLOW_MARKER = "context_length_exceeded";
const OVERFLOW_PATTERN =
  /context\s*(length|window|limit)|input\s*length\s*exceed|exceeds?\s*(?:the\s*)?context|too\s*many\s*tokens|maximum\s*context/i;

// Pi's auto-retry (utils/retry.js) matches this phrase and gives a bounded
// automatic retry. Only the intermittent upstream rejection signature may
// carry it.
const RETRY_MARKER = "you can retry your request";
const INTERMITTENT_REJECTION_PREFIX = /^invalid request error/i;
const INTERMITTENT_REJECTION_GUIDANCE = `This is usually an intermittent upstream rejection of a tool-calling continuation; ${RETRY_MARKER}. If it keeps failing, report it to Novita`;

const NO_BODY_PATTERN = /^(\d{3}) status code \(no body\)$/;
const STATUS_PREFIX_PATTERN = /^(\d{3}):\s*/;
const TRACE_ID_PATTERN = /trace_id[:=]?\s*([\w-]+)/i;

/**
 * Pi surfaces provider failures as "<status>: <body>". Novita's body is
 * {code, reason, message}; OpenAI-shaped bodies ({error:{message,type}} or
 * {message,type}) and bodyless failures are decoded too. This handler turns
 * them into actionable messages and normalizes context-overflow errors so Pi
 * can auto-compact.
 */
export function registerErrorDecoder(pi: ExtensionAPI): void {
  pi.on("message_end", (event) => {
    const message = event.message;
    if (message.role !== "assistant" || message.stopReason !== "error") return;
    if (message.provider !== PROVIDER_ID) return;

    const decoded = decodeErrorMessage(message.errorMessage ?? "");
    if (!decoded) return;
    return { message: { ...message, errorMessage: decoded } };
  });
}

/** Returns the rewritten error message, or null to leave it unchanged. */
export function decodeErrorMessage(errorMessage: string): string | null {
  if (errorMessage.includes(OVERFLOW_MARKER)) return null;

  if (OVERFLOW_PATTERN.test(errorMessage)) {
    return `${OVERFLOW_MARKER}: ${errorMessage}`;
  }

  const noBody = NO_BODY_PATTERN.exec(errorMessage);
  if (noBody) return decodeNoBody(Number(noBody[1]));

  const statusMatch = STATUS_PREFIX_PATTERN.exec(errorMessage);
  const body = statusMatch ? errorMessage.slice(statusMatch[0].length) : errorMessage;
  const error = parseNovitaError(body);
  if (error) {
    const guidance = GUIDANCE[error.reason];
    return guidance
      ? `Novita ${error.reason} (HTTP ${error.code}): ${error.message}. ${guidance}`
      : `Novita ${error.reason} (HTTP ${error.code}): ${error.message}`;
  }

  const openai = parseOpenAIStyleError(body);
  if (!openai) return null;
  return decodeOpenAIStyle(openai, statusMatch ? statusMatch[1] : undefined, body);
}

function decodeOpenAIStyle(
  error: { message: string; type?: string },
  status: string | undefined,
  body: string,
): string {
  const type = error.type ?? "error";
  const where = status ? ` (HTTP ${status})` : "";
  let text = `Novita ${type}${where}: ${error.message}`;
  if (type === "invalid_request_error") {
    text += INTERMITTENT_REJECTION_PREFIX.test(error.message)
      ? `. ${INTERMITTENT_REJECTION_GUIDANCE}`
      : `. ${GUIDANCE.INVALID_REQUEST_BODY}`;
  }
  const traceId = TRACE_ID_PATTERN.exec(error.message) ?? TRACE_ID_PATTERN.exec(body);
  if (traceId?.[1] && !text.includes(traceId[1])) {
    text += ` (trace_id ${traceId[1]})`;
  }
  return text;
}

function decodeNoBody(status: number): string | null {
  const prefix = `Novita returned HTTP ${status} without a readable error body.`;
  if (status === 400) {
    return `${prefix} This is usually an intermittent upstream rejection of a tool-calling continuation; ${RETRY_MARKER}. If it keeps failing, report it to Novita.`;
  }
  if (status === 401 || status === 403) {
    return `${prefix} The API key may be missing or rejected, or the account balance may be empty. Run /login to set a key and check /novita. Keys: ${KEY_MANAGEMENT_URL}`;
  }
  if (status === 404) {
    return `${prefix} The model id is probably not available on Novita. Pick another with /model`;
  }
  if (status === 429) {
    return `${prefix} Novita rate limit (HTTP 429). Retry shortly, or raise limits at https://novita.ai/quota-limits/llm`;
  }
  if (status >= 500 && status <= 599) {
    return `${prefix} Novita reports a server error (HTTP ${status}). Retry shortly`;
  }
  return null;
}
