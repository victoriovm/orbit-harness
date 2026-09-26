/**
 * Attention-sound Host service: chooses and delivers one sound for the browser
 * to play when the harness needs the user's attention while its window is
 * unfocused.
 *
 * `pick` returns a uniformly random eligible file from the user's
 * `<Harness home>/sounds` folder; with no folder, or no eligible file in it,
 * it returns the bundled fallback sound. The browser half owns when to ask and
 * when to play; this service holds no state between calls.
 */

import { readFile, readdir, stat } from 'node:fs/promises'
import { extname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import z from '@deepseek-ai/schemastery'
import { FALLBACK_SOUND_BASE64 } from './fallback-sound.ts'
import type { AttentionSoundPick } from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host owner of the `attentionSounds` Remote namespace. */
    attentionSounds: AttentionSounds
  }
}

/** Folder under the Harness home holding the user's attention sounds. */
export const SOUNDS_DIR_NAME = 'sounds'

/** File name reported for the bundled fallback sound. */
export const FALLBACK_SOUND_NAME = 'cavalo.mp3'

/** File extensions eligible as attention sounds, matched case-insensitively. */
const SOUND_EXTENSIONS: ReadonlySet<string> = new Set([
  '.aac', '.flac', '.m4a', '.mp3', '.oga', '.ogg', '.opus', '.wav',
])

/** The one directory-entry view eligibility needs. */
export interface SoundEntry {
  /** File or directory base name. */
  readonly name: string
  /** Whether the entry is a regular file. */
  readonly isFile: () => boolean
}

/** Deployment configuration. */
export interface Config {
  /** Harness home holding `sounds/`; undefined resolves `$DSH_HOME` or `~/.dsh`. */
  readonly dshHome?: string
  /**
   * Inclusive byte cap on one sound file; larger files are skipped, never
   * truncated. An attention alert is a short clip, so the default bounds the
   * wire payload far above any reasonable custom sound.
   */
  readonly maxSoundBytes: number
}

/**
 * List the direct children of `dir` eligible as attention sounds: regular
 * files with a known audio extension that still exist and stay within the
 * byte cap. An entry that vanished or exceeds the cap is skipped, not an
 * error.
 * @param dir - absolute folder the entries were read from.
 * @param entries - the folder's direct children as `readdir` reported them.
 * @param maxSoundBytes - inclusive byte cap on one sound file.
 * @returns the eligible file names in listing order.
 */
export async function eligibleSoundNames(
  dir: string,
  entries: readonly SoundEntry[],
  maxSoundBytes: number,
): Promise<string[]> {
  const candidates = entries
    .filter(entry => entry.isFile() && SOUND_EXTENSIONS.has(extname(entry.name).toLowerCase()))
  const checked = await Promise.all(candidates.map(async (entry) => {
    const info = await stat(join(dir, entry.name)).catch((cause: unknown) => {
      // The entry vanished between listing and stat: never eligible.
      if (isMissingEntry(cause)) return undefined
      throw cause
    })
    if (info === undefined || info.size > maxSoundBytes) return undefined
    return entry.name
  }))
  return checked.filter((name): name is string => name !== undefined)
}

/**
 * Pick one item from a list, uniformly at random.
 * @param items - the candidate list; only emptiness produces undefined.
 * @param random - randomness source in `[0, 1)`.
 * @returns one of `items`, or undefined for an empty list.
 */
export function pickSound<T>(items: readonly T[], random: () => number): T | undefined {
  if (items.length === 0) return undefined
  return items[Math.floor(random() * items.length)]
}

/** Host Remote service behind the `attentionSounds` Client namespace. */
export class AttentionSounds extends TypertRemoteService {
  static Config: z<Config> = z.object({
    dshHome: z.string(),
    maxSoundBytes: z.number().step(1).min(1).default(10 * 1024 * 1024),
  })

  /**
   * @param ctx - Host context.
   * @param config - deployment values for the sounds folder location and cap.
   */
  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'attentionSounds')
  }

  /**
   * Choose and deliver one attention sound: a uniformly random eligible file
   * from the user's `sounds/` folder, or the bundled fallback when the folder
   * is absent, is not a directory, or offers no eligible file this call.
   * @returns the chosen sound's file name and complete bytes.
   */
  @Remote
  async pick(): Promise<AttentionSoundPick> {
    const dir = join(resolveDshHome(this.config.dshHome), SOUNDS_DIR_NAME)
    const fromFolder = await this.pickFromFolder(dir)
    if (fromFolder !== undefined) return fromFolder
    return { name: FALLBACK_SOUND_NAME, data: Buffer.from(FALLBACK_SOUND_BASE64, 'base64') }
  }

  /**
   * One folder sound, or undefined when the folder offers none. A chosen file
   * vanishing between listing and reading also falls back rather than failing
   * the alert.
   */
  private async pickFromFolder(dir: string): Promise<AttentionSoundPick | undefined> {
    const entries = await readdir(dir, { withFileTypes: true }).catch((cause: unknown) => {
      // A folder that does not exist yet is the no-custom-sounds state, and a
      // file at that path is the user's to fix; neither may break an alert.
      if (isMissingEntry(cause)) return undefined
      throw cause
    })
    if (entries === undefined) return undefined
    const names = await eligibleSoundNames(dir, entries, this.config.maxSoundBytes)
    const name = pickSound(names, Math.random)
    if (name === undefined) return undefined
    const data = await readFile(join(dir, name)).catch((cause: unknown) => {
      if (isMissingEntry(cause)) return undefined
      throw cause
    })
    return data === undefined ? undefined : { name, data }
  }
}

/** Whether the error reports the path having no entry or not being a directory. */
function isMissingEntry(cause: unknown): boolean {
  return typeof cause === 'object' && cause !== null && 'code' in cause
    && (cause.code === 'ENOENT' || cause.code === 'ENOTDIR')
}

export default AttentionSounds
