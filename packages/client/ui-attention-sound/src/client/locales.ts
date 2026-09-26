/** Attention-sound copy; the General settings row is the only consumer. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  title: '提示音',
  description: '窗口不在前台时，任务完成、需要确认或出错会播放提示音',
  error: '保存失败，请重试',
} satisfies Record<string, string>

/** The attention-sound namespace key union. */
export type AttentionSoundKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  title: 'Attention sound',
  description: 'Play a sound when a task finishes, asks for confirmation, or fails while the harness window is not focused',
  error: 'Could not save. Please try again',
} satisfies Record<AttentionSoundKey, string>
