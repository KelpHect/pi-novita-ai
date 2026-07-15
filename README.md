# pi-novita-ai

A [Pi](https://pi.dev) coding-agent extension that registers
[novita.ai](https://novita.ai) as a custom model provider.

Novita exposes an OpenAI-compatible Chat Completions API at
`https://api.novita.ai/openai` with `Authorization: Bearer` auth. This
extension uses Pi's built-in `openai-completions` streaming implementation — no
custom streaming code required.

## Features

- **`/login` integration** — "Novita AI" appears in Pi's `/login` menu; paste
  your API key and it's stored in `auth.json`
- **Dynamic model discovery** — fetches `/v1/models` at startup and merges with
  a curated metadata map for all Novita recommended models
- **Reasoning / extended thinking** — per-model-family `thinkingFormat`:
  - `qwen` format (`enable_thinking`) for GLM, Kimi, Qwen models
  - `deepseek` format (`thinking: { type }`) for DeepSeek models
  - Standard `reasoning_effort` for Hy3, MiniMax, and others
- **Vision / multimodal** — VLM models (Kimi K2.5, Qwen 3.5, Gemma 4) registered
  with `input: ["text", "image"]`
- **Function calling / tool use** — works automatically via OpenAI-compatible API
- **Interleaved thinking** — `requiresReasoningContentOnAssistantMessages` set
  so reasoning chains are preserved across tool calls
- **Prompt caching** — `cacheRead`/`cacheWrite` cost fields tracked
- **Context overflow recovery** — normalizes Novita's overflow errors so Pi can
  auto-compact and retry

## Install

Clone into Pi's global extensions directory so it is auto-discovered on startup
and supports `/reload`:

```bash
git clone https://github.com/KelpHect/pi-novita-ai.git ~/.pi/agent/extensions/pi-novita-ai
```

(For a quick test only, you can instead load it explicitly with
`pi -e ./pi-novita-ai`, but the auto-discovery location is the intended setup.)

## Configure & use

1. Start Pi.
2. Run `/login` and select **Novita AI** — paste your Novita API key when
   prompted. The key is stored in `~/.pi/agent/auth.json` under `novita`.
   (Get a key from <https://novita.ai/settings/key-management>.)
3. Run `/model` and pick a Novita model, e.g. `novita/tencent-hy3`.

Alternatively, you can set the key via environment variable instead of `/login`:

```bash
export NOVITA_API_KEY=nva_xxxxxxxxxxxxxxxxxxxxxxxx
```

Auth file credentials (`/login`) take priority over the environment variable.

## How it works

- Registers a provider named `novita` with `name: "Novita AI"` (shows in
  `/login`), `baseUrl: https://api.novita.ai/openai`, `authHeader: true`
  (adds `Authorization: Bearer` to every request).
- Uses `api: "openai-completions"` (Novita is OpenAI-compatible).
- On startup, fetches `https://api.novita.ai/openai/v1/models` and registers
  every returned model. Models in the curated `KNOWN_MODELS` map get full
  metadata (reasoning, vision, context window, thinkingFormat, compat);
  discovered models without a curated entry get inferred defaults.
- If the model list can't be fetched (no key / network error), falls back to
  the curated set so the extension still loads.
- A `message_end` handler normalizes Novita's context-overflow errors to
  `context_length_exceeded` so Pi can auto-compact and retry.

## Curated models

All recommended models from [Novita's docs](https://novita.ai/docs/guides/llm-recommended)
are curated with accurate metadata:

| Model ID | Reasoning | Vision | Context | Thinking format |
|----------|-----------|--------|---------|-----------------|
| `tencent/hy3` | yes | — | 256K | `reasoning_effort` |
| `moonshotai/kimi-k2.7-code` | yes | — | 262K | `qwen` (`enable_thinking`) |
| `zai-org/glm-5.2` | yes | — | 1M | `qwen` (`enable_thinking`) |
| `deepseek/deepseek-v4-pro` | yes | — | 1M | `deepseek` |
| `deepseek/deepseek-v3.2` | yes | — | 160K | `deepseek` |
| `qwen/qwen3.5-397b-a17b` | yes | yes | 262K | `qwen` (`enable_thinking`) |
| `minimax/minimax-m3` | yes | — | 1M | `reasoning_effort` |
| `deepseek/deepseek-v4-flash` | yes | — | 1M | `deepseek` |
| `moonshotai/kimi-k2.5` | yes | yes | 262K | `qwen` (`enable_thinking`) |
| `google/gemma-4-31b-it` | — | yes | 262K | — |
| `inclusionai/ling-2.6-flash` | — | — | 262K | — |
| `meta-llama/llama-3.1-8b-instruct` | — | — | 128K | — |
| `google/gemma-4-26b-a4b-it` | — | — | 262K | — |

Pricing is set to $0 where models are in a free promotional tier or where exact
pricing is unconfirmed. Verify actual pricing at
<https://novita.ai/pricing>.

### `tencent/hy3`

Flagship model: 295B/21B active MoE, native 256K context, three reasoning
modes. Registered with `reasoning: true`, `thinkingLevelMap` supporting
`low`/`medium`/`high`/`max` effort levels, and `maxTokens: 262144`.

## License

MIT
