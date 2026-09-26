/**
 * Shared attention-sound preference vocabulary: one namespace id and its
 * section, read identically by the Host half that persists the choice and the
 * browser half that plays the sound.
 *
 * @module @deepseek-ai/dsh-client-ui-attention-sound/settings
 */

/**
 * Settings namespace id: this plugin's Loader row entry id in the web
 * composition. The bundle row and both halves must keep spelling it the same.
 */
export const ATTENTION_SOUND_NAMESPACE = 'ui-attention-sound'

/** The persisted attention-sound choice. */
export interface AttentionSoundSettings {
  /** Play a sound when the harness needs attention while its window is unfocused. */
  enabled: boolean
}
