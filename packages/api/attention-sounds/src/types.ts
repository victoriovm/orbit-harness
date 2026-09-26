/**
 * Wire vocabulary of the `attentionSounds` Remote namespace.
 *
 * @module @deepseek-ai/dsh-api-attention-sounds/types
 */

/** One chosen attention sound, delivered whole. */
export interface AttentionSoundPick {
  /** File base name in the user's sounds folder, or the bundled fallback's name. */
  readonly name: string
  /** Complete sound bytes. */
  readonly data: Uint8Array
}
