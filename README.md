# pi-novita-ai

A [Pi](https://pi.dev) extension that registers [Novita AI](https://novita.ai)
as an OpenAI-compatible Chat Completions provider.

The extension delegates streaming to Pi's built-in `openai-completions`
implementation. It adds Novita-specific authentication, live model discovery,
capability and price mapping, diagnostics, error decoding, and an offline
fallback catalog.

Capabilities vary by model and can change when Novita updates its catalog. The
extension maps only capabilities represented by both Novita metadata and Pi.

## Features

- `/login` integration with non-billable API-key validation through Novita's
  balance endpoint
- Live, schema-validated discovery of Pi-compatible chat models
- Bundled fallback metadata for Novita's recommended models
- Context windows, output limits, vision, reasoning, and display names mapped
  from Novita's catalog
- USD cost tracking for input, output, and cache-read tokens, including tiered
  prices
- Novita's documented `enable_thinking` control and reasoning-content replay
  across tool calls
- Function calling and structured-output requests through Chat Completions
- Actionable decoding of Novita's structured error responses
- `/novita [model]` for credential and one-token completion diagnostics
- Offline startup and package-level verification with a real Pi CLI

## Requirements

- Node.js 22.19.0 or newer
- Pi 0.80.7 or newer
- A [Novita API key](https://novita.ai/settings/key-management) for model calls

## Install

Install globally for the current Pi user:

```bash
pi install npm:pi-novita-ai
```

Install for the current project instead:

```bash
pi install -l npm:pi-novita-ai
```

Try the published package without installing it:

```bash
pi -e npm:pi-novita-ai
```

Other supported package sources:

```bash
pi install git:github.com/KelpHect/pi-novita-ai
git clone https://github.com/KelpHect/pi-novita-ai.git ~/.pi/agent/extensions/pi-novita-ai
```

Update or remove the npm package with `pi update npm:pi-novita-ai` or
`pi remove npm:pi-novita-ai`.

## Authenticate and use

1. Start Pi and run `/login`.
2. Select **Novita AI** and paste a key from
   [Novita key management](https://novita.ai/settings/key-management).
3. Run `/model` and select a `novita/...` model.

The login flow validates the key against Novita's documented balance endpoint.
It accepts the key only after a well-formed success response, rejects confirmed
authentication failures, and treats timeouts or malformed provider responses
as temporary validation failures. Pi stores accepted credentials in its normal
credential store.

An environment variable can be used instead:

```bash
export NOVITA_API_KEY=your-key
```

PowerShell:

```powershell
$env:NOVITA_API_KEY = "your-key"
```

Pi's documented provider order is an explicit per-request override, stored
credentials from `/login`, the provider environment variable, then any
provider fallback. This extension supplies no fallback secret. In normal use,
stored `/login` credentials therefore take priority over `NOVITA_API_KEY`.
Run `/novita` to confirm that credentials resolve and to probe the active or
preferred Novita model. Pass a model explicitly when needed:

```text
/novita deepseek/deepseek-v3.2
```

The probe sends a one-output-token request and reports Novita's actual
structured failure reason, such as `NOT_ENOUGH_BALANCE` or `MODEL_NOT_FOUND`.

## Model discovery and fallback

At startup, the extension requests `GET https://api.novita.ai/openai/v1/models`.
If `NOVITA_API_KEY` is set it is sent with discovery; otherwise discovery is
attempted without credentials. Although the endpoint currently responds
without a key, Novita's API reference documents bearer authentication, so the
bundled fallback remains the supported failure path.

The response is treated as untrusted data. The extension validates model IDs,
numeric bounds, known capabilities and modalities, endpoints, prices, and
billing tiers; removes duplicates deterministically; and registers only chat
models that support `chat/completions`. If the request fails, the schema is
invalid, the catalog is empty, or no usable chat model remains, a bundled set
of recommended models is registered instead.

Set `PI_OFFLINE=1` to skip discovery deliberately. Refresh the fallback from a
validated live catalog with:

```bash
npm run catalog:refresh
```

The generated source records the endpoint and refresh date. Review the diff
before committing because Novita can change model metadata and prices.

## Pricing and prompt caching

Novita catalog prices are converted to Pi's USD-per-million-token cost format.
The mapping includes prompt, completion, and cache-read rates. Prompt caching
is implicit on Novita, so the extension sends no cache-control parameters and
tracks cached input from the standard streaming usage response.

For tiered models, Novita's `min_tokens` lower boundary is mapped to Pi's
strict `inputTokensAbove` threshold by subtracting one token. This implements
the catalog boundary as inclusive. Novita does not document the inclusivity
of overlapping tier endpoints explicitly; the mapping and its boundary are
covered by unit tests and should be rechecked if Novita clarifies the contract.

## Reasoning, tools, and structured output

Reasoning models use Novita's documented top-level `enable_thinking` boolean.
Pi's supported reasoning labels therefore map to on or off; Novita does not
offer effort granularity for this API. Reasoning content is replayed with
assistant tool-call messages as required for interleaved thinking.

The extension does not request `reasoning_split` or `separate_reasoning`.
Novita's current documentation uses both names in different places, while the
default `reasoning_content` stream requires no request change. Pi accepts that
default stream. Function calling and structured-output requests use Pi's normal
OpenAI Chat Completions implementation when the selected model advertises the
corresponding capability.

## Errors and diagnostics

Novita error bodies shaped as `{code, reason, message}` are decoded into useful
Pi messages. Guidance is included for invalid credentials, insufficient
balance, missing models, invalid requests, rate and token limits, service
availability, and access denial. Context-overflow wording is normalized so Pi
can compact and retry.

If a request fails:

1. Run `/novita` to check credential resolution and a minimal completion.
2. Run `/login` again if the key was rejected.
3. Check [billing](https://novita.ai/billing) for `NOT_ENOUGH_BALANCE`.
4. Select another model with `/model` for `MODEL_NOT_FOUND` or `ACCESS_DENY`.
5. Retry later or review Novita limits for rate, throughput, or service errors.

The extension never logs API keys. Network diagnostics return bounded provider
details and generic transport errors instead of exception bodies that might
contain credentials.

## Security and trust

Pi packages execute code with the user's permissions. Review the source of any
third-party package before installing it. This package makes HTTPS requests to
Novita's API and balance endpoints; when a Novita model is selected, prompts,
tool-call conversations, and supported image inputs are sent to Novita.

The API key is stored through Pi's credential mechanism after `/login`, or read
from `NOVITA_API_KEY`. The package does not include telemetry, a publishing
workflow, or a separate credential store.

## Development and verification

Install exact development dependencies and run the full offline gate:

```bash
npm ci
npm run verify
```

`verify` runs strict TypeScript checking, the mocked unit suite, an exact
`npm pack` content and secret audit, installation of the generated tarball into
a clean temporary consumer, a packed-extension load, and model listing through
the real Pi CLI. CI runs the same gate on Node.js 22.19.0 and Node.js 24.

Additional commands:

```bash
npm test                 # mocked unit suite
npm run test:watch       # unit tests in watch mode
npm run test:live        # optional credentialed Novita checks
npm run pack:check       # exact tarball allowlist and secret scan
npm run smoke:pack       # clean install plus real Pi CLI smoke test
```

The live suite skips explicitly when `NOVITA_API_KEY` is absent. With a key it
checks authenticated discovery and non-billable key validation. Set
`NOVITA_TEST_MODEL` to enable a minimal streaming completion with usage after
reviewing that model's current price. Tool-call and reasoning checks also
require explicit model choices:

```bash
NOVITA_API_KEY=your-key \
NOVITA_TEST_MODEL=provider/chat-model \
NOVITA_TOOL_TEST_MODEL=provider/tool-model \
NOVITA_REASONING_TEST_MODEL=provider/reasoning-model \
npm run test:live
```

Use the equivalent `$env:NAME = "value"` assignments in PowerShell.

`prepublishOnly` runs the full offline verification gate. Publishing remains a
separate maintainer action; no script in this repository publishes, tags, or
pushes a release.

## Contributing

Keep runtime changes small and add mocked coverage for every protocol edge
case. Run `npm run verify` before opening a pull request. If model metadata or
pricing changes, run `npm run catalog:refresh`, review the generated diff, and
state whether credentialed live tests were run. Never add API keys, captured
private responses, local Pi state, or generated tarballs to the repository.

## Known limitations

- Audio and video inputs are not supported by Pi and are registered as text or
  text-plus-image only.
- Reasoning is on or off because Novita documents no effort levels for Chat
  Completions.
- Structured reasoning details are not requested because Novita's parameter
  names are currently inconsistent across its documentation.
- A fallback catalog is a snapshot. Run `npm run catalog:refresh` before a
  release and review pricing changes.
- Startup discovery is intentionally bounded; a slow or unavailable endpoint
  uses the fallback instead of delaying Pi indefinitely.

## License

[MIT](LICENSE)
