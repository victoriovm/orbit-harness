---
description: "Attention-sound Host service: picks one sound from the user's .dsh/sounds folder, or a bundled fallback, for the browser to play while the harness window is unfocused."
kind: "package-reference"
---

# @deepseek-ai/dsh-api-attention-sounds

English | [中文](README.zh.md)

## Summary

Use this package to hand the browser one attention sound. `pick` lists the user's `<Harness home>/sounds` folder, chooses one eligible audio file uniformly at random, and returns it whole over the `attentionSounds` Remote namespace; with no folder, no eligible file, or a file that vanishes mid-call, it returns the bundled fallback sound instead. The service owns only the choice and the bytes; the browser half of [`dsh-client-ui-attention-sound`](../../client/ui-attention-sound/README.md) owns when to ask and when to play, so the same choice serves the Web and desktop surfaces.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the package in a bundle that also mounts the Typert Gateway; the web composition places it beside the Session Controller, and the `ui-attention-sound` row consumes it. A Client calls `remote.attentionSounds.pick()` and receives `AttentionSoundPick { name, data }`, the chosen file's base name plus its complete bytes as `Uint8Array`. The method never fails for user-content reasons: a missing folder, a file at the folder's path, and an empty or fully ineligible folder all produce the fallback, so an alert never fails loudly because the user's sounds are absent.

| Method | Returns | Purpose |
|---|---|---|
| `pick()` | `AttentionSoundPick { name, data }` | One sound, chosen at random from the user's folder, or the bundled fallback |

### The sounds folder

The folder is `<Harness home>/sounds`, resolved through [`dsh-home-paths`](../../util/home-paths/README.md) (`$DSH_HOME` or `~/.dsh` unless configured). Eligibility takes the folder's direct children only — nested folders are not searched — and keeps regular files whose lower-cased extension is one of `.aac`, `.flac`, `.m4a`, `.mp3`, `.oga`, `.ogg`, `.opus`, or `.wav`, within the `maxSoundBytes` cap. An entry that disappears between listing and its size check is skipped; one that disappears between the choice and the read falls back to the bundled sound. The bundled fallback is `cavalo.mp3`, hardcoded as base64 in `src/fallback-sound.ts` and reported under the name `cavalo.mp3`, so Clients can rely on the name without ever seeing the folder.

### Configuration

| Field | Default | Meaning |
|---|---|---|
| `dshHome` | `$DSH_HOME` or `~/.dsh` | Harness home holding the `sounds/` folder |
| `maxSoundBytes` | `10485760` (10 MiB) | Inclusive byte cap on one sound file; larger files are skipped, never truncated |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-api-attention-sounds) is the exhaustive source for every accepted field and its JSDoc.

<a id="understand-the-implementation"></a>
## Understand the implementation

Eligibility and the random choice are pure exported functions (`eligibleSoundNames`, `pickSound`); the service only resolves the folder, sequences the listing, and delivers bytes. `pick` holds no state between calls, so a sound added to the folder is eligible on the next call without restart. Size checks read `stat` per candidate, and failures classify through the error's `code` alone: `ENOENT` and `ENOTDIR` mean "no folder sound this call", every other code propagates.

<a id="model-experience"></a>
## Model Experience

None, as this service serves audio bytes to the browser and registers nothing model-facing.

#### KV Cache effect

None; picks do not alter a model request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Eligibility is extension-based, not content-based** — a renamed or corrupt file with a sound extension is delivered as-is, and playback quality stays the browser's concern. Per-call randomness uses `Math.random`, which is adequate for a non-security choice among the user's own files.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The pick is a stateless choice over a folder listing with no cross-call state, so no independent observations can diverge.
