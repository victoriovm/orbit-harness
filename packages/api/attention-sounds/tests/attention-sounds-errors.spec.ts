/** Attention-sound failure paths: filesystem refusals and the vanished-file race. */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import AttentionSounds, { eligibleSoundNames, FALLBACK_SOUND_NAME, SOUNDS_DIR_NAME } from '../src/index.ts'

/** Scripted failures injected into the module's fs/promises calls; undefined delegates to the real fs. */
const fsState = vi.hoisted(() => ({
  readdirError: undefined as (Error & { code: string }) | undefined,
  statError: undefined as (Error & { code: string }) | undefined,
  readFileError: undefined as (Error & { code: string }) | undefined,
}))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  const scripted = async (error: (Error & { code: string }) | undefined, run: () => Promise<unknown>): Promise<unknown> => {
    if (error !== undefined) throw error
    return await run()
  }
  return {
    ...actual,
    readdir: async (...args: Parameters<typeof actual.readdir>) =>
      await scripted(fsState.readdirError, () => actual.readdir(...args)),
    stat: async (...args: Parameters<typeof actual.stat>) =>
      await scripted(fsState.statError, () => actual.stat(...args)),
    readFile: async (...args: Parameters<typeof actual.readFile>) =>
      await scripted(fsState.readFileError, () => actual.readFile(...args)),
  }
})

const homes: string[] = []

afterEach(async () => {
  fsState.readdirError = undefined
  fsState.statError = undefined
  fsState.readFileError = undefined
  await Promise.all(homes.splice(0).map(home => rm(home, { recursive: true, force: true })))
})

/** Create one temporary Harness home with a sounds folder holding one eligible file. */
async function makeHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'dsh-attention-sounds-'))
  homes.push(home)
  const dir = join(home, SOUNDS_DIR_NAME)
  await mkdir(dir)
  await writeFile(join(dir, 'a.mp3'), 'mp3-bytes')
  return home
}

/** Mount one service over `home`. */
async function mounted(home: string): Promise<{ pick: () => Promise<{ name: string; data: Uint8Array }> }> {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  await ctx.plugin(AttentionSounds, { dshHome: home, maxSoundBytes: 10 * 1024 * 1024 })
  return { pick: () => ctx.attentionSounds.pick() }
}

describe('filesystem refusals', () => {
  it('propagates a directory listing refusal that is not a missing folder', async () => {
    const home = await makeHome()
    const { pick } = await mounted(home)
    fsState.readdirError = Object.assign(new Error('denied'), { code: 'EACCES' })
    await expect(pick()).rejects.toMatchObject({ code: 'EACCES' })
  })

  it('propagates a size-check refusal that is not a vanished entry', async () => {
    const home = await makeHome()
    const { readdir } = await import('node:fs/promises')
    const entries = await readdir(join(home, SOUNDS_DIR_NAME), { withFileTypes: true })
    fsState.statError = Object.assign(new Error('denied'), { code: 'EACCES' })
    await expect(eligibleSoundNames(join(home, SOUNDS_DIR_NAME), entries, 1024))
      .rejects.toMatchObject({ code: 'EACCES' })
  })

  it('propagates a read refusal that is not a vanished file', async () => {
    const home = await makeHome()
    const { pick } = await mounted(home)
    fsState.readFileError = Object.assign(new Error('denied'), { code: 'EACCES' })
    await expect(pick()).rejects.toMatchObject({ code: 'EACCES' })
  })

  it('falls back when the chosen file vanishes between listing and reading', async () => {
    const home = await makeHome()
    const { pick } = await mounted(home)
    fsState.readFileError = Object.assign(new Error('gone'), { code: 'ENOENT' })
    await expect(pick()).resolves.toMatchObject({ name: FALLBACK_SOUND_NAME })
  })
})
