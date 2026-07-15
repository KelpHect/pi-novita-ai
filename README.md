# pi-novita-ai

A [Pi](https://pi.dev) coding-agent extension that registers
[novita.ai](https://novita.ai) as a custom model provider.

Novita exposes an OpenAI-compatible Chat Completions API at
`https://api.novita.ai/openai` with `Authorization: Bearer` auth. This
extension uses Pi's built-in `openai-completions` streaming implementation — no
custom streaming code required.

## Features

- **`/login` integration** — "Novita AI" appears in Pi's `/login` menu; paste
  your API key, it's validated with a live probe, and stored in `auth.json`
- **Full live model catalog** — every chat model from `/v1/models`
  (no auth required), with names, context windows, max output tokens,
  reasoning and vision capabilities taken directly from the API
- **Accurate cost tracking** — real per-model USD pricing including cache-read
  rates and Novita's tiered billing (mapped to Pi's native cost tiers)
- **Reasoning / extended thinking** — `enable_thinking` toggle (the control
  Novita documents), with reasoning content echoed across tool calls per
  Novita's interleaved-thinking requirements
- **Vision** — models with `image` in `input_modalities` accept images
- **Function calling & structured outputs** — via the OpenAI-compatible API
- **Prompt caching** — implicit on Novita; cache-read costs tracked
- **Decoded errors** — Novita's `{code, reason, message}` bodies become
  actionable messages ("NOT_ENOUGH_BALANCE → top up at novita.ai/billing"),
  and context-overflow errors are normalized so Pi can auto-compact and retry
- **`/novita [model]` command** — shows the active auth path and runs a live
  1-token probe that reports Novita's real error reason
- **Offline resilience** — if `/v1/models` is unreachable, a bundled snapshot
  of Novita's recommended models registers instead

## Install

### Via `pi install` (recommended)

```bash
pi install npm:pi-novita-ai
```

This installs the package from npm and registers it in `~/.pi/agent/settings.json`.
Pi loads it automatically on every startup.

To try it without installing:

```bash
pi -e npm:pi-novita-ai
```

To install at project level (shared with your team via `.pi/settings.json`):

```bash
pi install -l npm:pi-novita-ai
```

To update:

```bash
pi update npm:pi-novita-ai
```

To remove:

```bash
pi remove npm:pi-novita-ai
```

### Via git

```bash
pi install git:github.com/KelpHect/pi-novita-ai
```

### Manual (clone to extensions directory)

```bash
git clone https://github.com/KelpHect/pi-novita-ai.git ~/.pi/agent/extensions/pi-novita-ai
```

## Configure & use

1. Start Pi.
2. Run `/login` and select **Novita AI** — paste your Novita API key when
   prompted. The key is verified against `/v1/models` and stored in
   `~/.pi/agent/auth.json` under `novita`.
   (Get a key from <https://novita.ai/settings/key-management>.)
3. Run `/model` and pick a Novita model, e.g. `novita/tencent-hy3`.

Alternatively, you can set the key via environment variable instead of `/login`:

```bash
export NOVITA_API_KEY=nva_xxxxxxxxxxxxxxxxxxxxxxxx
```

`/login` credentials take priority over the environment variable. If neither
is configured, Novita returns `HTTP 403 INVALID_API_KEY` for every request,
regardless of which model you pick. Run `/novita` at any time to see which
auth path is active.

## Models

The full chat-model catalog (~139 models) is fetched live from
`GET /openai/v1/models` at startup — including
[Novita's recommended models](https://novita.ai/docs/guides/llm-recommended)
such as `tencent/hy3` (free), `moonshotai/kimi-k2.7-code`, `zai-org/glm-5.2`,
`deepseek/deepseek-v4-pro`, and `minimax/minimax-m3`. Display names,
context windows, max output tokens, capabilities, and USD pricing all come
from the API, so newly launched models and price changes appear without an
extension update.

## Known limitations

- Novita documents `enable_thinking` as the only thinking control, so Pi's
  thinking-level selector maps to on/off for Novita models (no effort
  granularity on the wire).
- Novita's structured `reasoning_details` format (`reasoning_split: true`) is
  not requested; Pi consumes the default `reasoning_content` stream, which
  Novita states requires no request changes.
- Audio and video input modalities (a handful of Qwen omni models) are not
  supported by Pi and are registered as text/image only.

## License

MIT
