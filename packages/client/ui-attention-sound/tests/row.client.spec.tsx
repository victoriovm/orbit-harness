// @vitest-environment jsdom
/** The General settings row: copy, toggle wiring, and save-failure feedback. */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AttentionSoundRow } from '../src/client/AttentionSoundRow.tsx'
import type { AttentionSoundRowInjected } from '../src/client/AttentionSoundRow.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const t = (key: string): string => (en as Record<string, string>)[key] ?? key

// Global standard kit stubs: this row consumes none of the standing hooks.
const unusedHook = (() => { throw new Error('unused by the attention-sound row') }) as never
const kit = {
  useSessions: unusedHook, useSessionStatus: unusedHook, useSessionRetainInfo: unusedHook,
  usePanelInfo: unusedHook, useResource: unusedHook, useWorkspaces: unusedHook,
}

/** Row props over an inject face, completed by the standard kit the seat type carries. */
function rowProps(injected: AttentionSoundRowInjected): Parameters<typeof AttentionSoundRow>[0] {
  return {
    ...kit,
    ...injected,
    useEnabled: (select: (value: boolean) => boolean) => select(injected.hooks.enabled.getSnapshot()),
    t,
  } as Parameters<typeof AttentionSoundRow>[0]
}

describe('AttentionSoundRow', () => {
  it('renders its copy and reflects the accepted preference', () => {
    const setEnabled = vi.fn(async () => {})
    render(<AttentionSoundRow {...rowProps({
      hooks: { enabled: createSnapshotStore(true) },
      setEnabled,
    })} />)
    expect(screen.getByText(en.title)).toBeTruthy()
    expect(screen.getByText(en.description)).toBeTruthy()
    expect(screen.getByRole('switch', { name: en.title }).getAttribute('aria-checked')).toBe('true')
    expect(setEnabled).not.toHaveBeenCalled()
  })

  it('writes the requested choice through the preference owner', async () => {
    const setEnabled = vi.fn(async () => {})
    render(<AttentionSoundRow {...rowProps({
      hooks: { enabled: createSnapshotStore(true) },
      setEnabled,
    })} />)
    fireEvent.click(screen.getByRole('switch', { name: en.title }))
    await waitFor(() =>{  expect(setEnabled).toHaveBeenCalledWith(false) })
  })

  it('reports a refused write and keeps the row usable', async () => {
    const setEnabled = vi.fn(async () => { throw new Error('not saved') })
    render(<AttentionSoundRow {...rowProps({
      hooks: { enabled: createSnapshotStore(true) },
      setEnabled,
    })} />)
    fireEvent.click(screen.getByRole('switch', { name: en.title }))
    await waitFor(() =>{  expect(screen.getByRole('alert')).toBeTruthy() })
    expect(screen.getByRole('alert').textContent).toBe(en.error)
  })
})
