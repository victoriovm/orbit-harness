---
description: "Attention sound browser plugin: plays one Host-picked sound when a Session stops, awaits an interaction, or errors while the harness window is unfocused."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-attention-sound

English | [中文](README.zh.md)

## Summary

Browser half of the attention sound. The plugin folds Session-status snapshots and the Host error event into attention moments — a Session stopping (task finished), a pending interaction appearing (approval, question, plan review), or a Host-reported error — and, while the browser window is unfocused and the user's preference allows, plays one sound fetched from [`dsh-api-attention-sounds`](../../api/attention-sounds/README.md). One attention burst plays at most one sound, and a client booting into already-idle or already-pending Sessions stays silent because the first observed status is the baseline. A General settings row owns the enable choice.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the package in the web composition; its bundle rows are `ui-attention-sound` (this package) beside `attention-sounds` (the Host service). Required client services: `remote`, `uiSession`, `configForms`, `slots`, and `locale`. The Host half of this same package declares the live `enabled` field of the `ui-attention-sound` settings namespace, editable from `cordis.yml` and from the General settings row this plugin registers; new installations default to enabled.

The window holds focus when `document.hasFocus()` is true at the moment the attention moment is observed, so switching to another window, another tab, or minimizing all suppress playback, and returning focus resumes it. Sound bytes arrive whole over the Remote, play once through a temporary object URL released when playback ends, fails, or is refused (an autoplay-policy refusal ends the attempt silently), and the MIME type derives from the file's extension.

### The enabled preference

The preference reads the shared settings document through `ctx.configForms`: while the Host serves the `ui-attention-sound` namespace it follows the accepted value, defaulting to enabled until one arrives; on a connection that keeps preferences process-local (memory mode) it keeps a browser-local choice instead. The row's write path persists through the same namespace, and a refused write surfaces the row's error copy.

<a id="understand-the-implementation"></a>
## Understand the implementation

`wiring.ts` registers the dictionaries, the moment subscriptions, and the General row; `alerter.ts` owns the gating (playing exclusivity, preference, focus, and a coalescing window so one burst stays one sound); `player.ts` owns playback. The enable choice rides the shared boolean-preference helper on `ctx.configForms` (`hostFallback` and `memoryStart` both on), so it follows the Host document while it is served and stays browser-local on a memory-mode connection. The plugin never imports another feature plugin's values — collaboration goes through the `configForms`, `uiSession`, and `remote` services, and the row renders through the `settings.general.item` slot.

<a id="model-experience"></a>
## Model Experience

None, as this package presents audio in the browser and registers nothing model-facing.

#### KV Cache effect

None; playback does not alter a model request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Focus is a whole-window fact** — the sound does not distinguish which Session or panel the user is reading, and a focused-but-backgrounded Session still silences playback. Subagent Session stops alert like top-level ones when the window is unfocused.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The alerter folds one observable snapshot stream and exposes no independent observations; its gating is covered by the unit and plugin-body specs.
