# @fusion-office/ai-client (vendored)

Vendored copy of `@fusion-office/ai-client` v0.1.0 (MIT), source:

- Repo: `dahai80/fusion-office`, path `packages/ai-client/src`
- Pinned commit: `4c42484d`
- Vendored: 2026-11-28, for fusion-doc issue #90 (RFC office#64 leg H3)

## Why vendored

The package is still `"private": true` and unpublished (extraction tracked in
fusion-office#65). Until it ships as an installable package, fusion-doc vendors
the source so the AI chat panel can consume it directly. When fusion-office#65
publishes, delete this directory and add `@fusion-office/ai-client` as a real
dependency — the import surface used by fusion-doc is:

```js
import { chatStreamEvents, createOutcomeReporter } from '../vendor/ai-client/index.js';
```

## Configuration (browser env, Vite-prefixed)

- `VITE_FUSION_GATEWAY_URL` — gateway base URL (default `http://127.0.0.1:11432`)
- `VITE_FUSION_GATEWAY_KEY` — gateway API key
- `VITE_FUSION_MODEL` — default model (default `mlx-community/Qwen3.8-27B-8bit`)
- In dev, requests go through the Vite proxy `/__fusion_gateway` (configured in
  `client/vite.config.js`); served under the gateway `/shell/` mount the client
  uses same-origin automatically.

The package is unmodified except for this README. Do not edit vendored files —
refresh the copy from upstream instead.
