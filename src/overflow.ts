import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { PROVIDER_ID } from "./config.js";

// Matches overflow-like phrases only — never rate-limit / throttling errors.
const OVERFLOW_PATTERN =
  /context\s*(length|window|limit)|input\s*length\s*exceed|exceeds?\s*(?:the\s*)?context|too\s*many\s*tokens|maximum\s*context/i;

/**
 * Novita reports context overflow as generic 400 errors that Pi's built-in
 * patterns don't recognize. Prefixing them with `context_length_exceeded`
 * (Pi's generic fallback marker) enables auto-compaction + retry.
 */
export function registerOverflowRecovery(pi: ExtensionAPI): void {
  pi.on("message_end", (event, ctx) => {
    const message = event.message;
    if (message.role !== "assistant" || message.stopReason !== "error") return;
    if (
      message.provider !== PROVIDER_ID &&
      ctx.model?.provider !== PROVIDER_ID
    ) {
      return;
    }

    const errorMessage = message.errorMessage ?? "";
    if (errorMessage.includes("context_length_exceeded")) return;
    if (!OVERFLOW_PATTERN.test(errorMessage)) return;

    return {
      message: {
        ...message,
        errorMessage: `context_length_exceeded: ${errorMessage}`,
      },
    };
  });
}
