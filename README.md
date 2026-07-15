# pi-novita-ai

A [Pi](https://pi.dev) coding-agent extension that registers
[novita.ai](https://novita.ai) as a custom model provider.

Novita exposes an OpenAI-compatible Chat Completions API, so this extension
uses Pi's built-in `openai-completions` streaming implementation — no custom
streaming code required. It discovers the available model list at startup from
Novita's `/v1/models` endpoint and merges it with a curated metadata map that
supplies accurate reasoning flags, context windows, max output tokens and
pricing for the models we know about (notably **`tencent/hy3`**).

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
   (Get a key from <https://novita.ai> → API Keys.)
3. Run `/model` and pick a Novita model, e.g. `novita/tencent-hy3`.

That's it. Alternatively, you can set the key via environment variable instead
of `/login`:

```bash
export NOVITA_API_KEY=nva_xxxxxxxxxxxxxxxxxxxxxxxx
```

Auth file credentials (`/login`) take priority over the environment variable.

## How it works

- Registers a provider named `novita` with
  `baseUrl: https://api.novita.ai/openai`.
- Uses `authHeader: true` so requests carry `Authorization: Bearer $NOVITA_API_KEY`.
- Uses `api: "openai-completions"` (Novita is OpenAI-compatible).
- On startup, fetches `https://api.novita.ai/openai/v1/models` and registers
  every returned model. Models in the curated `KNOWN_MODELS` map (currently
  `tencent/hy3`) get full metadata; the rest get safe defaults.
- If the model list can't be fetched (no key / network error), it falls back to
  the curated set so the extension still loads.

### `tencent/hy3`

Flagship model: 295B/21B active MoE, native 256K context, three reasoning
modes. Registered with `reasoning: true` and a `thinkingLevelMap` that maps
Pi's thinking levels onto standard `reasoning_effort` values.

## License

MIT
