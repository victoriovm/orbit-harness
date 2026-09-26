/** Attention-moment gating: transitions, focus, preference, coalescing, and playback exclusivity. */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionStatusSnapshot } from '@deepseek-ai/dsh-client-ui-session/client'
import { describe, expect, it, vi } from 'vitest'
import { AttentionAlerter, type AlerterPorts, ATTENTION_COALESCE_MS } from '../src/client/alerter.ts'

/** One unfocused, enabled alerter over scripted ports, plus the ports for assertions. */
function alerter({ focused = false, enabled = true, sound = true }:
{ focused?: boolean; enabled?: boolean; sound?: boolean } = {}) {
  const ports = {
    isFocused: vi.fn(() => focused),
    pick: vi.fn(async () => sound ? { name: 'a.mp3', data: new Uint8Array([1]) } : undefined),
    play: vi.fn(async () => {}),
  } satisfies AlerterPorts
  const clock = { now: 1000 }
  const instance = new AttentionAlerter(
    createSnapshotStore(enabled),
    ports,
    () => clock.now,
  )
  return { instance, ports, clock }
}

/** Build one status snapshot over Session ids. */
function status(entries: Record<string, { running?: boolean }>): SessionStatusSnapshot {
  return new Map(Object.entries(entries).map(([id, value]) => [id as SessionId, {
    running: value.running,
    pendingInteraction: undefined,
    completionUnread: false,
  }]))
}

/** Settle every pending alert microtask: one macrotask flushes them all. */
async function flushAsync(): Promise<void> {
  await new Promise((resolve) => { setTimeout(resolve, 0) })
}

describe('AttentionAlerter', () => {
  it('never alerts on the baseline snapshot', () => {
    const { instance, ports } = alerter()
    instance.observe(status({ s1: { running: false } }))
    expect(ports.pick).not.toHaveBeenCalled()
  })

  it('alerts when a running Session stops while unfocused', async () => {
    const { instance, ports } = alerter()
    instance.observe(status({ s1: { running: true } }))
    instance.observe(status({ s1: { running: false } }))
    await vi.waitFor(() =>{  expect(ports.play).toHaveBeenCalled() })
    expect(ports.pick).toHaveBeenCalledOnce()
  })

  it('alerts on a Host-reported error even without a status transition', async () => {
    const { instance, ports } = alerter()
    instance.alert()
    await vi.waitFor(() =>{  expect(ports.play).toHaveBeenCalled() })
  })

  it('stays silent while the window is focused', () => {
    const { instance, ports } = alerter({ focused: true })
    instance.observe(status({ s1: { running: true } }))
    instance.observe(status({ s1: { running: false } }))
    instance.alert()
    expect(ports.pick).not.toHaveBeenCalled()
  })

  it('stays silent while the preference disables playback', () => {
    const { instance, ports } = alerter({ enabled: false })
    instance.observe(status({ s1: { running: true } }))
    instance.observe(status({ s1: { running: false } }))
    instance.alert()
    expect(ports.pick).not.toHaveBeenCalled()
  })

  it('stays silent when the Host offers no sound', async () => {
    const { instance, ports } = alerter({ sound: false })
    instance.alert()
    await vi.waitFor(() =>{  expect(ports.pick).toHaveBeenCalledOnce() })
    expect(ports.play).not.toHaveBeenCalled()
  })

  it('coalesces one burst into one sound', async () => {
    const { instance, ports, clock } = alerter()
    instance.observe(status({ s1: { running: true }, s2: { running: true } }))
    instance.observe(status({ s1: { running: false }, s2: { running: false } }))
    await vi.waitFor(() =>{  expect(ports.play).toHaveBeenCalled() })
    await flushAsync()
    clock.now += ATTENTION_COALESCE_MS - 1
    instance.alert()
    expect(ports.pick).toHaveBeenCalledOnce()
  })

  it('alerts again after the coalesce window and playback settle', async () => {
    const { instance, ports, clock } = alerter()
    instance.alert()
    await vi.waitFor(() =>{  expect(ports.play).toHaveBeenCalled() })
    await flushAsync()
    clock.now += ATTENTION_COALESCE_MS + 1
    instance.alert()
    await vi.waitFor(() =>{  expect(ports.pick).toHaveBeenCalledTimes(2) })
  })

  it('does not start a second sound while one is playing', async () => {
    let release: (() => void) | undefined
    const ports = {
      isFocused: vi.fn(() => false),
      pick: vi.fn(async () => ({ name: 'a.mp3', data: new Uint8Array([1]) })),
      play: vi.fn((): Promise<void> => new Promise((resolve) => { release = resolve })),
    } satisfies AlerterPorts
    const instance = new AttentionAlerter(createSnapshotStore(true), ports, () => 1000)
    instance.alert()
    instance.alert()
    await vi.waitFor(() =>{  expect(ports.pick).toHaveBeenCalledOnce() })
    release?.()
  })

  it('survives an unexpected port rejection and can alert again later', async () => {
    let failNow: ((error: Error) => void) | undefined
    const ports = {
      isFocused: vi.fn(() => false),
      pick: vi.fn((): Promise<{ name: string; data: Uint8Array }> => new Promise((_, reject) => {
        failNow = (error) => { reject(error) }
      })),
      play: vi.fn(async () => {}),
    } satisfies AlerterPorts
    const clock = { now: 1000 }
    const instance = new AttentionAlerter(createSnapshotStore(true), ports, () => clock.now)
    instance.alert()
    await vi.waitFor(() =>{  expect(ports.pick).toHaveBeenCalledOnce() })
    failNow?.(new Error('broken'))
    await flushAsync()
    clock.now += ATTENTION_COALESCE_MS + 1
    instance.alert()
    await vi.waitFor(() =>{  expect(ports.pick).toHaveBeenCalledTimes(2) })
    expect(ports.play).not.toHaveBeenCalled()
  })
})
