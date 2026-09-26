/** Attention-sound selection: folder eligibility, random pick, and the bundled fallback. */
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import AttentionSounds, {
  eligibleSoundNames, FALLBACK_SOUND_NAME, pickSound, SOUNDS_DIR_NAME,
} from '../src/index.ts'

const homes: string[] = []

afterEach(async () => {
  await Promise.all(homes.splice(0).map(home => rm(home, { recursive: true, force: true })))
})

/** Create one temporary Harness home and register it for cleanup. */
async function makeHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'dsh-attention-sounds-'))
  homes.push(home)
  return home
}

/** Mount one service over `home` and return its pick endpoint. */
async function mountedPick(home: string, maxSoundBytes = 10 * 1024 * 1024): Promise<() => Promise<{ name: string; data: Uint8Array }>> {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  await ctx.plugin(AttentionSounds, { dshHome: home, maxSoundBytes })
  return () => ctx.attentionSounds.pick()
}

describe('pickSound', () => {
  it('maps one uniform random draw onto the list', () => {
    expect(pickSound(['a', 'b', 'c'], () => 0)).toBe('a')
    expect(pickSound(['a', 'b', 'c'], () => 0.4)).toBe('b')
    expect(pickSound(['a', 'b', 'c'], () => 0.99)).toBe('c')
  })

  it('is undefined for an empty list', () => {
    expect(pickSound<number>([], () => 0.5)).toBeUndefined()
  })
})

describe('eligibleSoundNames', () => {
  it('keeps regular files with known audio extensions within the byte cap', async () => {
    const home = await makeHome()
    const dir = join(home, SOUNDS_DIR_NAME)
    await mkdir(dir)
    await writeFile(join(dir, 'a.mp3'), 'mp3')
    await writeFile(join(dir, 'b.txt'), 'text')
    await writeFile(join(dir, 'c.WAV'), 'wav')
    await writeFile(join(dir, 'big.mp3'), 'x'.repeat(64))
    await mkdir(join(dir, 'd.mp3'))
    const entries = [
      ...await readdirEntries(dir),
      // One entry the reader saw but whose file is already gone.
      { name: 'ghost.mp3', isFile: () => true },
    ]
    await expect(eligibleSoundNames(dir, entries, 32)).resolves.toEqual(['a.mp3', 'c.WAV'])
  })
})

describe('AttentionSounds.pick', () => {
  it('serves the bundled fallback when the sounds folder does not exist', async () => {
    const pick = await mountedPick(await makeHome())
    const sound = await pick()
    expect(sound.name).toBe(FALLBACK_SOUND_NAME)
    expect(sound.data).toBeInstanceOf(Uint8Array)
    expect(sound.data.length).toBe(15840)
    expect(Buffer.from(sound.data.subarray(0, 3)).toString('latin1')).toBe('ID3')
  })

  it('serves the bundled fallback for an empty sounds folder', async () => {
    const home = await makeHome()
    await mkdir(join(home, SOUNDS_DIR_NAME))
    const pick = await mountedPick(home)
    await expect(pick()).resolves.toMatchObject({ name: FALLBACK_SOUND_NAME })
  })

  it('serves the bundled fallback when the sounds path is a file', async () => {
    const home = await makeHome()
    await writeFile(join(home, SOUNDS_DIR_NAME), 'not a folder')
    const pick = await mountedPick(home)
    await expect(pick()).resolves.toMatchObject({ name: FALLBACK_SOUND_NAME })
  })

  it('serves the bundled fallback when only non-audio files exist', async () => {
    const home = await makeHome()
    const dir = join(home, SOUNDS_DIR_NAME)
    await mkdir(dir)
    await writeFile(join(dir, 'notes.txt'), 'text')
    const pick = await mountedPick(home)
    await expect(pick()).resolves.toMatchObject({ name: FALLBACK_SOUND_NAME })
  })

  it('serves the bundled fallback when every audio file exceeds the configured cap', async () => {
    const home = await makeHome()
    const dir = join(home, SOUNDS_DIR_NAME)
    await mkdir(dir)
    await writeFile(join(dir, 'long.mp3'), 'x'.repeat(16))
    const pick = await mountedPick(home, 8)
    await expect(pick()).resolves.toMatchObject({ name: FALLBACK_SOUND_NAME })
  })

  it('returns one folder sound whole, named after its file', async () => {
    const home = await makeHome()
    const dir = join(home, SOUNDS_DIR_NAME)
    await mkdir(dir)
    const contents = new Map([['one.mp3', 'first-bytes'], ['two.ogg', 'second-bytes'], ['three.flac', 'third-bytes']])
    for (const [name, body] of contents) await writeFile(join(dir, name), body)
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    const pick = await mountedPick(home)
    const sound = await pick()
    expect(contents.get(sound.name)).toBe(Buffer.from(sound.data).toString())
  })
})

/** Read one directory's entries through the same call the service makes. */
async function readdirEntries(dir: string): Promise<{ name: string; isFile: () => boolean }[]> {
  return await readdir(dir, { withFileTypes: true })
}
