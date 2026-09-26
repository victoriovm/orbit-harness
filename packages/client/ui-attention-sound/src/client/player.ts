/** Browser playback of one Host-delivered attention sound. */

import type { AttentionSoundPick } from '@deepseek-ai/dsh-api-remotes/client'

/** MIME types for the sound file extensions the Host serves, by lower-case extension. */
const SOUND_MIME_TYPES: Readonly<Record<string, string>> = {
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg',
  '.oga': 'audio/ogg',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.wav': 'audio/wav',
}

/**
 * Play one sound once through a temporary object URL, released when playback
 * ends, fails, or the browser refuses to start it.
 * @param sound - complete sound bytes with their source file name.
 * @returns settlement after the attempt finishes either way.
 */
export function playSound(sound: AttentionSoundPick): Promise<void> {
  return new Promise((resolve) => {
    const extension = sound.name.slice(sound.name.lastIndexOf('.')).toLowerCase()
    const url = URL.createObjectURL(new Blob([new Uint8Array(sound.data)], { type: SOUND_MIME_TYPES[extension] ?? 'application/octet-stream' }))
    const audio = new Audio(url)
    let settledOnce = false
    const settled = (): void => {
      if (settledOnce) return
      settledOnce = true
      URL.revokeObjectURL(url)
      resolve()
    }
    audio.addEventListener('ended', settled, { once: true })
    audio.addEventListener('error', settled, { once: true })
    // An autoplay-policy refusal ends the attempt; playback completion arrives
    // through `ended`.
    audio.play().catch(settled)
  })
}
