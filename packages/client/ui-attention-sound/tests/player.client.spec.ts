// @vitest-environment jsdom
/** Sound playback: object-URL lifecycle, completion, refusal, and MIME selection. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { playSound } from '../src/client/player.ts'

/** Scripted media element recording URL and listener traffic. */
class FakeAudio {
  static instances: FakeAudio[] = []
  static outcomes = new Map<FakeAudio, () => Promise<void>>()
  readonly listeners = new Map<string, Set<() => void>>()
  played = false
  /** The play settlement for this instance, replaceable per test. */
  outcome: () => Promise<void> = () => Promise.resolve()

  constructor(readonly src: string) {
    FakeAudio.instances.push(this)
  }

  addEventListener(event: string, listener: () => void): void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set())
    this.listeners.get(event)!.add(listener)
  }

  play(): Promise<void> {
    this.played = true
    return this.outcome()
  }

  /** Fire one event kind against every registered listener. */
  emit(event: string): void {
    for (const listener of [...(this.listeners.get(event) ?? [])]) listener()
  }
}

const objectUrls: string[] = []
const revoked: string[] = []

afterEach(() => {
  FakeAudio.instances = []
  FakeAudio.outcomes = new Map()
  objectUrls.length = 0
  revoked.length = 0
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function installPlayer(): void {
  vi.stubGlobal('Audio', FakeAudio)
  vi.stubGlobal('URL', {
    createObjectURL: vi.fn((blob: Blob) => {
      objectUrls.push(blob.type)
      return `blob:sound-${objectUrls.length}`
    }),
    revokeObjectURL: vi.fn((url: string) => { revoked.push(url) }),
  })
}

const SOUND = (name: string): { name: string; data: Uint8Array } => ({ name, data: new Uint8Array([1, 2, 3]) })

describe('playSound', () => {
  it('plays one object URL of the name-derived MIME type and releases it on end', async () => {
    installPlayer()
    const done = playSound(SOUND('clip.mp3'))
    const audio = FakeAudio.instances[0]!
    expect(audio.src).toBe('blob:sound-1')
    expect(objectUrls[0]).toBe('audio/mpeg')
    expect(audio.played).toBe(true)
    audio.emit('ended')
    await expect(done).resolves.toBeUndefined()
    expect(revoked).toEqual(['blob:sound-1'])
    audio.emit('error')
    expect(revoked).toEqual(['blob:sound-1'])
  })

  it('releases the URL when playback is refused before it starts', async () => {
    installPlayer()
    const done = playSound(SOUND('clip.ogg'))
    FakeAudio.instances[0]!.outcome = () => Promise.reject(new Error('autoplay'))
    FakeAudio.instances[0]!.emit('ended')
    await expect(done).resolves.toBeUndefined()
    expect(revoked).toEqual(['blob:sound-1'])
  })

  it('maps the served extensions and falls back for unknown ones', async () => {
    installPlayer()
    for (const name of ['a.wav', 'b.m4a', 'c.flac', 'd.aac', 'e.opus', 'f.oga', 'g.MP3', 'unknown.txt']) {
      FakeAudio.instances = []
      const done = playSound(SOUND(name))
      FakeAudio.instances[0]!.emit('ended')
      await done
    }
    expect(objectUrls).toEqual([
      'audio/wav', 'audio/mp4', 'audio/flac', 'audio/aac', 'audio/ogg', 'audio/ogg', 'audio/mpeg',
      'application/octet-stream',
    ])
  })
})
