// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ModelSelection } from '@deepseek-ai/dsh-api-remotes/client'
import type { ModelCatalogModel, ModelProviderGroup } from '@deepseek-ai/dsh-api-session-controller/types'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ComponentProps } from 'react'
import type { ModelDirectoryState } from '../src/client/directory.ts'
import { ModelSelect } from '../src/client/ModelSelect.tsx'
import { zh } from '../src/client/locales.ts'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'

// The seat's key domain is model ∪ common; the stub mirrors the real lookup
// chain: package dictionary, then common vocabulary, then the key.
const t: ComponentProps<typeof ModelSelect>['t'] = (key, params) => {
  const template = (zh as Record<string, string>)[key]
    ?? (commonZh as Record<string, string>)[key]
    ?? key
  return params === undefined
    ? template
    : template.replace(/\{(\w+)\}/g, (match, name: string) => name in params ? String(params[name]) : match)
}

const reasoning = {
  efforts: [
    { id: 'off', name: 'Off' },
    { id: 'high', name: 'High' },
    { id: 'max', name: 'Max', description: 'Largest budget' },
  ],
  defaultEffort: 'high',
}

function state(overrides: Partial<ModelDirectoryState> = {}): ModelDirectoryState {
  return {
    current: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    routable: true,
    groups: [{
      id: 'deepseek-official',
      name: 'DeepSeek',
      models: [{
        id: 'deepseek-v4-flash',
        name: 'DeepSeek-V4-Flash',
        description: 'Fast catalog description',
        reasoning,
      }],
    }],
    failures: [],
    status: 'ready',
    error: null,
    ...overrides,
  }
}

/**
 * The seat's own rule is the directory's (`ModelDirectory.selectionFor`), so the
 * stand-in submits each row's model default; a test that wants a remembered
 * effort overrides it.
 */
const defaultSelectionFor = (group: ModelProviderGroup, model: ModelCatalogModel): ModelSelection => ({
  provider: group.id,
  model: model.id,
  ...model.reasoning?.defaultEffort === undefined
    ? {}
    : { reasoningEffort: model.reasoning.defaultEffort },
})

/** One route the auto-configuration action serves, as the injected face reports it. */
const autoProvider = { id: 'orbit', settingsNs: 'llm-pi-ai', name: 'Orbit' }

function renderSelect({
  directory = createSnapshotStore<ModelDirectoryState>(state()),
  load = vi.fn(),
  selectionFor = defaultSelectionFor,
  select = vi.fn().mockResolvedValue({ ok: true, value: undefined }),
  autoConfigurableProviders = vi.fn().mockResolvedValue({ kind: 'listed' as const, providers: [autoProvider] }),
  autoConfigure = vi.fn().mockResolvedValue({ kind: 'configured' as const, models: 7, enriched: 6 }),
  available = true,
}: {
  directory?: ReturnType<typeof createSnapshotStore<ModelDirectoryState>>
  load?: ComponentProps<typeof ModelSelect>['load']
  selectionFor?: ComponentProps<typeof ModelSelect>['selectionFor']
  select?: ComponentProps<typeof ModelSelect>['select']
  autoConfigurableProviders?: ComponentProps<typeof ModelSelect>['autoConfigurableProviders']
  autoConfigure?: ComponentProps<typeof ModelSelect>['autoConfigure']
  available?: boolean
} = {}) {
  render(<ModelSelect
    locked={false}
    available={available}
    directory={directory}
    load={load}
    selectionFor={selectionFor}
    select={select}
    autoConfigurableProviders={autoConfigurableProviders}
    autoConfigure={autoConfigure}
    t={t}
  />)
  return { directory, load, selectionFor, select, autoConfigurableProviders, autoConfigure }
}

function openDialog() {
  const trigger = screen.getByRole('button', { name: /选择模型|正在加载模型/ })
  trigger.focus()
  fireEvent.click(trigger)
  return {
    trigger,
    dialog: screen.getByRole('dialog', { name: zh['dialog.title'] }),
    listbox: screen.getByRole('listbox', { name: zh['list.aria'] }),
    search: screen.getByRole<HTMLInputElement>('searchbox', { name: zh['search.aria'] }),
  }
}

afterEach(cleanup)

/** The level names drawn along the slider, left to right. */
function stopsOf(slider: HTMLElement): (string | null)[] {
  return [...slider.querySelectorAll('[class*="effortStop"]')].map(node => node.textContent)
}

/** Whether the slider streams sparks for the level in use (any level but `off`). */
function heated(slider: HTMLElement): boolean {
  return /effortHeated/.test(slider.className)
}

/** The palette color the slider published for the level in use, '' if none. */
function tintOf(slider: HTMLElement): string {
  return slider.style.getPropertyValue('--effort-tint')
}

/** The heat the slider published for the current level. */
function heatOf(slider: HTMLElement): number {
  return Number(slider.style.getPropertyValue('--effort-heat'))
}

/** The inert rail a model with no reasoning levels draws. */
function lockedRail(): HTMLElement {
  const rail = document.querySelector('[class*="effortLocked"]')
  if (rail === null) throw new Error('no locked rail rendered')
  return rail as HTMLElement
}

/**
 * jsdom implements no pointer capture, so the three-method contract is installed
 * for one gesture and the original descriptors restored afterwards.
 * @param run - the gesture to perform while capture is emulated.
 */
function withPointerCapture(run: () => void): void {
  const names = ['setPointerCapture', 'releasePointerCapture', 'hasPointerCapture'] as const
  const originals = names.map(name =>
    [name, Object.getOwnPropertyDescriptor(Element.prototype, name)] as const)
  const captured = new Set<Element>()
  Element.prototype.setPointerCapture = function () { captured.add(this) }
  Element.prototype.releasePointerCapture = function () { captured.delete(this) }
  Element.prototype.hasPointerCapture = function () { return captured.has(this) }
  try {
    run()
  } finally {
    for (const [name, descriptor] of originals) {
      if (descriptor === undefined) Reflect.deleteProperty(Element.prototype, name)
      else Object.defineProperty(Element.prototype, name, descriptor)
    }
  }
}

/** Give one slider a rail box, so a pointer x maps to a fraction of it. */
function measureSlider(slider: HTMLElement, width: number): void {
  const band = slider.querySelector('[class*="effortBand"]') as HTMLElement
  band.getBoundingClientRect = () => ({ left: 0, width }) as DOMRect
}

describe('ModelSelect searchable dialog', () => {
  it('renders a flat model list with provider identification and searches every displayed identity', () => {
    const directory = createSnapshotStore<ModelDirectoryState>(state({
      groups: [
        {
          id: 'deepseek-official',
          name: 'DeepSeek',
          models: [
            { id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash', reasoning },
            { id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro' },
          ],
        },
        {
          id: 'local-provider',
          name: 'Local Lab',
          models: [{ id: 'coder-small', name: 'Coder Small' }],
        },
      ],
    }))
    renderSelect({ directory })

    const { dialog, listbox, search } = openDialog()
    expect(dialog.parentElement?.parentElement).toBe(document.body)
    expect(within(listbox).getAllByRole('option').map(option => option.textContent)).toEqual([
      'DeepSeek-V4-Flashdeepseek-official/deepseek-v4-flash · DeepSeek',
      'DeepSeek-V4-Prodeepseek-official/deepseek-v4-pro · DeepSeek',
      'Coder Smalllocal-provider/coder-small · Local Lab',
    ])
    expect(within(listbox).queryByRole('group')).toBeNull()
    expect(within(listbox).getByRole('option', { name: /DeepSeek-V4-Flash/ }).getAttribute('aria-selected')).toBe('true')

    fireEvent.change(search, { target: { value: 'v4-pro' } })
    expect(within(listbox).getAllByRole('option').map(option => option.textContent)).toEqual([
      'DeepSeek-V4-Prodeepseek-official/deepseek-v4-pro · DeepSeek',
    ])

    fireEvent.change(search, { target: { value: 'local-provider/coder-small' } })
    expect(within(listbox).getAllByRole('option').map(option => option.textContent)).toEqual([
      'Coder Smalllocal-provider/coder-small · Local Lab',
    ])

    fireEvent.change(search, { target: { value: 'Local Lab' } })
    expect(within(listbox).getAllByRole('option')).toHaveLength(1)
    expect(within(listbox).queryByRole('group')).toBeNull()

    fireEvent.change(search, { target: { value: 'deepseek-official' } })
    expect(within(listbox).getAllByRole('option')).toHaveLength(2)
    expect(within(listbox).queryByRole('group')).toBeNull()

    fireEvent.change(search, { target: { value: 'missing' } })
    expect(within(listbox).queryByRole('option')).toBeNull()
    expect(within(listbox).getByRole('status').textContent).toBe(zh['empty.search'])
  })

  it('shows the catalog-empty state separately from an empty search result', () => {
    renderSelect({
      directory: createSnapshotStore(state({ current: null, routable: false, groups: [] })),
    })

    const { listbox } = openDialog()
    expect(within(listbox).getByRole('status').textContent).toBe(zh['empty.models'])
  })

  it('applies a model immediately with its default effort and keeps the dialog open', async () => {
    const groups = [{
      id: 'deepseek-official',
      name: 'DeepSeek',
      models: [
        { id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash', reasoning },
        {
          id: 'deepseek-v4-pro',
          name: 'DeepSeek-V4-Pro',
          reasoning: { efforts: [{ id: 'max', name: 'Max' }], defaultEffort: 'max' },
        },
      ],
    }]
    const directory = createSnapshotStore<ModelDirectoryState>(state({ groups }))
    const select = vi.fn(async (selection: ModelSelection) => {
      directory.set(state({ current: selection, groups }))
      return { ok: true as const, value: undefined }
    })
    renderSelect({ directory, select })

    const { trigger } = openDialog()
    fireEvent.click(screen.getByRole('option', { name: /DeepSeek-V4-Pro/ }))

    await waitFor(() => {
      expect(select).toHaveBeenCalledWith({
        provider: 'deepseek-official',
        model: 'deepseek-v4-pro',
        reasoningEffort: 'max',
      })
      expect(screen.getByRole('dialog', { name: zh['dialog.title'] })).toBeTruthy()
      expect(screen.getByRole('option', { name: /DeepSeek-V4-Pro/ }).getAttribute('aria-selected')).toBe('true')
      expect(trigger.getAttribute('aria-label')).toBe('选择模型，当前 DeepSeek-V4-Pro，推理等级 Max')
    })
  })

  it('submits the selection the directory resolves for the clicked row', async () => {
    const groups = [{
      id: 'deepseek-official',
      name: 'DeepSeek',
      models: [
        { id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash', reasoning },
        {
          id: 'deepseek-v4-pro',
          name: 'DeepSeek-V4-Pro',
          reasoning: { efforts: [{ id: 'max', name: 'Max' }], defaultEffort: 'max' },
        },
      ],
    }]
    const directory = createSnapshotStore<ModelDirectoryState>(state({ groups }))
    // The memory the directory owns outranks the row's model default, so the
    // seat must submit what `selectionFor` answers rather than rebuilding one.
    const selectionFor = vi.fn((group: ModelProviderGroup, model: ModelCatalogModel): ModelSelection => ({
      provider: group.id,
      model: model.id,
      reasoningEffort: 'off',
    }))
    const select = vi.fn(async (selection: ModelSelection) => {
      directory.set(state({ current: selection, groups }))
      return { ok: true as const, value: undefined }
    })
    renderSelect({ directory, selectionFor, select })

    openDialog()
    fireEvent.click(screen.getByRole('option', { name: /DeepSeek-V4-Pro/ }))

    await waitFor(() => {
      expect(selectionFor).toHaveBeenCalledWith(groups[0], groups[0]!.models[1])
      expect(select).toHaveBeenCalledWith({
        provider: 'deepseek-official',
        model: 'deepseek-v4-pro',
        reasoningEffort: 'off',
      })
    })
  })

  it('draws one stop per advertised level, opens on the level in use, and steps with the arrow keys', async () => {
    const directory = createSnapshotStore<ModelDirectoryState>(state())
    const select = vi.fn(async (selection: ModelSelection) => {
      directory.set(state({ current: selection }))
      return { ok: true as const, value: undefined }
    })
    renderSelect({ directory, select })

    const { trigger } = openDialog()
    const slider = screen.getByRole('slider', { name: zh['effort.aria'] })
    expect(stopsOf(slider)).toEqual(['Off', 'High', 'Max'])
    expect(slider.getAttribute('aria-orientation')).toBe('horizontal')
    expect(slider.getAttribute('aria-valuemin')).toBe('0')
    expect(slider.getAttribute('aria-valuemax')).toBe('2')
    expect(slider.getAttribute('aria-valuenow')).toBe('1')
    expect(slider.getAttribute('aria-valuetext')).toBe('High')
    expect(heated(slider)).toBe(true)
    expect(heatOf(slider)).toBeCloseTo(4 / 6)
    expect(tintOf(slider)).toBe('#ff760d')
    // With levels to show there is nothing to explain and no empty row.
    expect(screen.queryByText(zh['empty.efforts'])).toBeNull()
    expect(slider.querySelector('[class*="effortScale"]')).not.toBeNull()

    fireEvent.keyDown(slider, { key: 'ArrowRight' })
    await waitFor(() => {
      expect(select).toHaveBeenCalledWith({
        provider: 'deepseek-official',
        model: 'deepseek-v4-flash',
        reasoningEffort: 'max',
      })
      expect(screen.getByRole('dialog', { name: zh['dialog.title'] })).toBeTruthy()
      expect(slider.getAttribute('aria-valuetext')).toBe('Max')
      expect(trigger.getAttribute('aria-label')).toBe('选择模型，当前 DeepSeek-V4-Flash，推理等级 Max')
      expect(heatOf(slider)).toBe(1)
      expect(tintOf(slider)).toBe('#a78bfa')
    })

    // Home and End reach the ends; a step past an end and a key the control
    // does not own both submit nothing.
    fireEvent.keyDown(slider, { key: 'Home' })
    await waitFor(() => { expect(slider.getAttribute('aria-valuetext')).toBe('Off') })
    expect(heated(slider)).toBe(false)
    expect(heatOf(slider)).toBe(0)
    expect(tintOf(slider)).toBe('#99cc19')
    fireEvent.keyDown(slider, { key: 'ArrowLeft' })
    fireEvent.keyDown(slider, { key: 'Enter' })
    expect(select).toHaveBeenCalledTimes(2)

    fireEvent.keyDown(slider, { key: 'End' })
    await waitFor(() => { expect(slider.getAttribute('aria-valuetext')).toBe('Max') })
    expect(tintOf(slider)).toBe('#a78bfa')
    fireEvent.keyDown(slider, { key: 'ArrowUp' })
    expect(select).toHaveBeenCalledTimes(3)
  })

  it('heats every named level and turns the animations on from xhigh up', async () => {
    const groups = [{
      id: 'provider',
      name: 'Provider',
      models: [{
        id: 'model',
        name: 'Model',
        reasoning: {
          efforts: [
            { id: 'off', name: 'Off' },
            { id: 'minimal', name: 'Minimal' },
            { id: 'low', name: 'Low' },
            { id: 'medium', name: 'Medium' },
            { id: 'high', name: 'High' },
            { id: 'xhigh', name: 'Extra High' },
            { id: 'max', name: 'Max' },
            { id: 'turbo', name: 'Turbo' },
          ],
        },
      }],
    }]
    const directory = createSnapshotStore<ModelDirectoryState>(state({
      groups,
      current: { provider: 'provider', model: 'model', reasoningEffort: 'high' },
    }))
    const select = vi.fn(async (selection: ModelSelection) => {
      directory.set(state({ groups, current: selection }))
      return { ok: true as const, value: undefined }
    })
    renderSelect({ directory, select })

    openDialog()
    const slider = screen.getByRole('slider', { name: zh['effort.aria'] })
    expect(stopsOf(slider)).toHaveLength(9)
    expect(slider.getAttribute('aria-valuetext')).toBe('High')
    expect(heated(slider)).toBe(true)
    expect(heatOf(slider)).toBeCloseTo(4 / 6)
    expect(tintOf(slider)).toBe('#ff760d')

    // Every named level publishes its own heat and walks the palette.
    fireEvent.keyDown(slider, { key: 'ArrowRight' })
    await waitFor(() => { expect(slider.getAttribute('aria-valuetext')).toBe('Extra High') })
    expect(heatOf(slider)).toBeCloseTo(5 / 6)
    expect(tintOf(slider)).toBe('#ef4444')

    fireEvent.keyDown(slider, { key: 'ArrowRight' })
    await waitFor(() => { expect(slider.getAttribute('aria-valuetext')).toBe('Max') })
    expect(heatOf(slider)).toBe(1)
    expect(tintOf(slider)).toBe('#a78bfa')

    // A level the ladder does not name is not a level this client can rank,
    // so it keeps the theme fill rather than taking a palette color on a guess.
    fireEvent.keyDown(slider, { key: 'ArrowRight' })
    await waitFor(() => { expect(slider.getAttribute('aria-valuetext')).toBe('Turbo') })
    expect(heated(slider)).toBe(false)
    expect(tintOf(slider)).toBe('')

    // Seven levels, seven colors: a model offering the whole ladder must never
    // paint two of its levels the same.
    fireEvent.keyDown(slider, { key: 'Home' })
    await waitFor(() => { expect(slider.getAttribute('aria-valuetext')).toBe('Default') })
    expect(tintOf(slider)).toBe('')
    const tints: string[] = []
    for (const label of ['Off', 'Minimal', 'Low', 'Medium', 'High', 'Extra High', 'Max']) {
      fireEvent.keyDown(slider, { key: 'ArrowRight' })
      await waitFor(() => { expect(slider.getAttribute('aria-valuetext')).toBe(label) })
      tints.push(tintOf(slider))
    }
    expect(tints).toEqual([
      '#99cc19', '#d1e277', '#f5da5f', '#ffa550', '#ff760d', '#ef4444', '#a78bfa',
    ])
  })

  it('settles a dragged knob on the nearest level and submits only on release', async () => {
    const directory = createSnapshotStore<ModelDirectoryState>(state())
    const select = vi.fn(async (selection: ModelSelection) => {
      directory.set(state({ current: selection }))
      return { ok: true as const, value: undefined }
    })
    renderSelect({ directory, select })

    openDialog()
    const slider = screen.getByRole('slider', { name: zh['effort.aria'] })
    measureSlider(slider, 300)

    withPointerCapture(() => {
      // The knob follows the pointer and the reported level previews, but the
      // Host hears nothing until the gesture settles.
      fireEvent.pointerDown(slider, { pointerId: 5, button: 0, clientX: 50 })
      fireEvent.pointerMove(slider, { pointerId: 5, clientX: 290 })
      expect(slider.getAttribute('aria-valuenow')).toBe('2')
      expect(select).not.toHaveBeenCalled()
      fireEvent.pointerUp(slider, { pointerId: 5, clientX: 290 })
    })
    await waitFor(() => {
      expect(select).toHaveBeenCalledTimes(1)
      expect(select).toHaveBeenCalledWith({
        provider: 'deepseek-official',
        model: 'deepseek-v4-flash',
        reasoningEffort: 'max',
      })
      expect(slider.getAttribute('aria-valuetext')).toBe('Max')
    })
  })

  it('ignores a gesture that changes nothing, a move without a press, and a dropped capture', () => {
    const directory = createSnapshotStore<ModelDirectoryState>(state())
    const select = vi.fn(async (selection: ModelSelection) => {
      directory.set(state({ current: selection }))
      return { ok: true as const, value: undefined }
    })
    renderSelect({ directory, select })

    openDialog()
    const slider = screen.getByRole('slider', { name: zh['effort.aria'] })
    measureSlider(slider, 300)

    withPointerCapture(() => {
      // A move owns nothing before a press.
      fireEvent.pointerMove(slider, { pointerId: 7, clientX: 290 })
      // A secondary-button press never starts a gesture.
      fireEvent.pointerDown(slider, { pointerId: 7, button: 2, clientX: 290 })
      fireEvent.pointerUp(slider, { pointerId: 7, clientX: 290 })
      // Settling back on the level already in use submits nothing.
      fireEvent.pointerDown(slider, { pointerId: 7, button: 0, clientX: 150 })
      fireEvent.pointerUp(slider, { pointerId: 7, clientX: 150 })
      // A cancelled gesture abandons the drag.
      fireEvent.pointerDown(slider, { pointerId: 7, button: 0, clientX: 290 })
      fireEvent.pointerCancel(slider, { pointerId: 7 })
      // So does a capture the browser takes back.
      fireEvent.pointerDown(slider, { pointerId: 7, button: 0, clientX: 290 })
      fireEvent.lostPointerCapture(slider, { pointerId: 7 })
    })
    expect(select).not.toHaveBeenCalled()
    expect(slider.getAttribute('aria-valuenow')).toBe('1')
  })

  it('blocks duplicate model selection without native disabled styling while the request is pending', async () => {
    const groups = [{
      id: 'deepseek-official',
      name: 'DeepSeek',
      models: [
        { id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash', reasoning },
        { id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro' },
      ],
    }]
    const directory = createSnapshotStore<ModelDirectoryState>(state({ groups }))
    const select = vi.fn(() => {
      directory.set(state({ groups, status: 'selecting' }))
      return new Promise<never>(() => {})
    })
    renderSelect({ directory, select })

    openDialog()
    const current = screen.getByRole('option', { name: /DeepSeek-V4-Flash/ })
    const target = screen.getByRole('option', { name: /DeepSeek-V4-Pro/ })
    fireEvent.click(target)

    await waitFor(() => {
      expect(target.hasAttribute('disabled')).toBe(false)
      expect(target.getAttribute('aria-disabled')).toBe('true')
      expect(current.getAttribute('aria-selected')).toBe('true')
    })
    fireEvent.click(target)
    expect(select).toHaveBeenCalledTimes(1)
  })

  it('refuses every gesture while a selection is in flight, without native disabled styling', async () => {
    const directory = createSnapshotStore<ModelDirectoryState>(state())
    const select = vi.fn(() => {
      directory.set(state({ status: 'selecting' }))
      return new Promise<never>(() => {})
    })
    renderSelect({ directory, select })

    openDialog()
    const slider = screen.getByRole('slider', { name: zh['effort.aria'] })
    measureSlider(slider, 300)
    withPointerCapture(() => {
      fireEvent.pointerDown(slider, { pointerId: 9, button: 0, clientX: 290 })
      fireEvent.pointerUp(slider, { pointerId: 9, clientX: 290 })
    })
    await waitFor(() => {
      expect(slider.hasAttribute('disabled')).toBe(false)
      expect(slider.getAttribute('aria-disabled')).toBe('true')
      expect(slider.getAttribute('aria-valuenow')).toBe('1')
    })

    fireEvent.keyDown(slider, { key: 'End' })
    withPointerCapture(() => {
      fireEvent.pointerDown(slider, { pointerId: 9, button: 0, clientX: 290 })
      fireEvent.pointerUp(slider, { pointerId: 9, clientX: 290 })
    })
    expect(select).toHaveBeenCalledTimes(1)
  })

  it('offers provider default only when the adapter does not configure a model default', async () => {
    const groups = [{
      id: 'provider',
      name: 'Provider',
      models: [{
        id: 'model',
        name: 'Model',
        reasoning: { efforts: [{ id: 'standard', name: 'Standard' }] },
      }],
    }]
    const directory = createSnapshotStore<ModelDirectoryState>(state({
      groups,
      current: { provider: 'provider', model: 'model', reasoningEffort: 'standard' },
    }))
    const select = vi.fn(async (selection: ModelSelection) => {
      directory.set(state({ groups, current: selection }))
      return { ok: true as const, value: undefined }
    })
    renderSelect({ directory, select })

    openDialog()
    const slider = screen.getByRole('slider', { name: zh['effort.aria'] })
    expect(stopsOf(slider)).toEqual(['Default', 'Standard'])
    expect(slider.getAttribute('aria-valuetext')).toBe('Standard')
    // Neither the provider default nor an unranked name is a level with heat.
    expect(heated(slider)).toBe(false)
    expect(tintOf(slider)).toBe('')

    fireEvent.keyDown(slider, { key: 'Home' })
    await waitFor(() => {
      expect(select).toHaveBeenCalledWith({ provider: 'provider', model: 'model' })
      expect(slider.getAttribute('aria-valuetext')).toBe('Default')
      expect(screen.getByRole('dialog', { name: zh['dialog.title'] })).toBeTruthy()
      expect(heated(slider)).toBe(false)
      expect(tintOf(slider)).toBe('')
    })
  })

  it('shows a durable model id missing from the catalog without inventing an option or effort selector', () => {
    renderSelect({
      directory: createSnapshotStore(state({
        current: { provider: 'deepseek-official', model: 'removed-model' },
      })),
    })

    const trigger = screen.getByRole('button', { name: '选择模型，当前 deepseek-official/removed-model' })
    expect(trigger.textContent).toContain('deepseek-official/removed-model')
    fireEvent.click(trigger)
    expect(screen.queryByRole('option', { name: /removed-model/ })).toBeNull()
    expect(screen.getByRole('option', { name: /DeepSeek-V4-Flash/ })).toBeTruthy()
    expect(screen.queryByRole('slider', { name: zh['effort.aria'] })).toBeNull()
    // The row keeps its place with an inert rail rather than inventing a level.
    expect(stopsOf(lockedRail())).toEqual([])
    expect(screen.getByText(zh['empty.efforts'])).toBeTruthy()
    expect(screen.queryByText('Fast catalog description')).toBeNull()
  })

  it('draws an inert white rail for a model that offers no reasoning levels', () => {
    renderSelect({
      directory: createSnapshotStore<ModelDirectoryState>(state({
        groups: [{ id: 'plain', name: 'Plain', models: [{ id: 'quiet', name: 'Quiet' }] }],
        current: { provider: 'plain', model: 'quiet' },
      })),
    })

    openDialog()
    expect(screen.queryByRole('slider', { name: zh['effort.aria'] })).toBeNull()
    const rail = lockedRail()
    expect(rail.getAttribute('aria-hidden')).toBe('true')
    expect(rail.hasAttribute('tabindex')).toBe(false)
    expect(stopsOf(rail)).toEqual([])
    expect(rail.querySelector('[class*="effortKnob"]')).toBeNull()
    expect(rail.querySelector('[class*="effortSparkles"]')).toBeNull()
    // No level names, and no empty row where they would have been: the row
    // states why this model has none.
    expect(rail.querySelector('[class*="effortScale"]')).toBeNull()
    expect(screen.getByText(zh['empty.efforts'])).toBeTruthy()
  })
})

describe('ModelSelect loading and errors', () => {
  it('shows loading until the catalog and Session projection are both ready', async () => {
    const directory = createSnapshotStore<ModelDirectoryState>(state({
      current: null,
      routable: null,
      groups: [],
      status: 'loading',
    }))
    renderSelect({ directory })

    const trigger = screen.getByRole('button', { name: zh['trigger.loading'] })
    expect(trigger.textContent).toContain(zh['trigger.loading'])
    fireEvent.click(trigger)
    expect(screen.getByRole('status').textContent).toBe(zh['status.loading'])
    expect(screen.getByRole('listbox', { name: zh['list.aria'] }).getAttribute('aria-busy')).toBe('true')

    directory.set(state())
    await waitFor(() => {
      expect(screen.getByRole('button', {
        name: '选择模型，当前 DeepSeek-V4-Flash，推理等级 High',
      })).toBeTruthy()
      expect(screen.queryByText(zh['status.loading'])).toBeNull()
      expect(screen.getByRole('listbox', { name: zh['list.aria'] }).getAttribute('aria-busy')).toBe('false')
    })
  })

  it('renders load and provider errors with retry actions', () => {
    const load = vi.fn()
    renderSelect({
      load,
      directory: createSnapshotStore(state({
        groups: [],
        failures: [{ id: 'broken', name: 'Broken Provider', message: 'adapter offline' }],
        status: 'error',
        error: 'catalog down',
      })),
    })

    openDialog()
    expect(screen.getByRole('alert').textContent).toContain('模型操作失败：catalog down')
    expect(screen.getByText('Broken Provider 加载失败：adapter offline')).toBeTruthy()
    const retries = screen.getAllByRole('button', { name: commonZh.retry })
    expect(retries).toHaveLength(2)
    fireEvent.click(retries[0]!)
    fireEvent.click(retries[1]!)
    expect(load).toHaveBeenCalledTimes(3)
  })

  it.each([false, true])('announces rejected selections with ownership guidance only for held writers (%s)', async (sessionInUse) => {
    const groups = [{
      id: 'deepseek-official',
      name: 'DeepSeek',
      models: [
        { id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash', reasoning },
        { id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro' },
      ],
    }]
    const directory = createSnapshotStore<ModelDirectoryState>(state({ groups }))
    const select = vi.fn(async () => {
      const error = sessionInUse
        ? new RemoteError('session/writer-held', 'writer held', { sessionId: SessionId('owned') })
        : new RemoteError('session/model-unavailable', 'session already contains images', { provider: 'deepseek-official', model: 'deepseek-v4-pro' })
      directory.set(state({ groups, status: 'error', error: 'unrelated catalog refresh' }))
      return { ok: false as const, error }
    })
    renderSelect({ directory, select })

    openDialog()
    fireEvent.click(screen.getByRole('option', { name: /DeepSeek-V4-Pro/ }))
    const toast = await screen.findByRole('alert')
    expect(toast.textContent).toBe(sessionInUse
      ? zh['error.sessionInUse']
      : '模型操作失败：session/model-unavailable: session already contains images')
    expect(screen.getByRole('dialog', { name: zh['dialog.title'] })).toBeTruthy()
    expect(screen.queryByRole('button', { name: commonZh.retry })).toBeNull()
  })
})

describe('ModelSelect dismissal and availability', () => {
  it.each(['Escape', 'mask', 'close'] as const)('closes by %s and restores focus to the trigger', async (method) => {
    renderSelect()
    const { trigger } = openDialog()
    expect(trigger.getAttribute('aria-expanded')).toBe('true')

    if (method === 'Escape') {
      fireEvent.keyDown(document, { key: 'Escape' })
    } else if (method === 'mask') {
      fireEvent.click(document.querySelector('[aria-hidden="true"]') as HTMLElement)
    } else {
      fireEvent.click(screen.getByRole('button', { name: commonZh.close }))
    }

    expect(screen.queryByRole('dialog', { name: zh['dialog.title'] })).toBeNull()
    await waitFor(() => {
      expect(document.activeElement).toBe(trigger)
      expect(trigger.getAttribute('aria-expanded')).toBe('false')
    })
  })

  it('renders no Agent-bound control for an addressed subagent session', () => {
    const load = vi.fn()
    renderSelect({ available: false, load })

    expect(screen.queryByRole('button')).toBeNull()
    expect(load).not.toHaveBeenCalled()
  })
})

describe('ModelSelect provider auto-configuration', () => {
  /** Open the configuration dialog over the picker, once its directory answered. */
  async function openAutoDialog() {
    fireEvent.click(screen.getByRole('button', { name: zh['auto.aria'] }))
    const dialog = screen.getByRole('dialog', { name: zh['auto.title'] })
    await waitFor(() => { expect(within(dialog).queryByText(zh['auto.loading'])).toBeNull() })
    return dialog
  }

  /**
   * The configuration dialog's provider field. Found by its popup role rather
   * than by name: the field's accessible name carries the route it currently
   * shows, so it reads differently before and after a choice.
   */
  function providerField(dialog: HTMLElement): HTMLButtonElement {
    const field = dialog.querySelector<HTMLButtonElement>('button[aria-haspopup="listbox"]')
    if (field === null) throw new Error('no provider field rendered')
    return field
  }

  /** Open the picker and the configuration dialog stacked over it. */
  async function openAutoConfig() {
    const { trigger } = openDialog()
    const dialog = await openAutoDialog()
    return { trigger, dialog, select: providerField(dialog) }
  }

  /** Expand the provider field and read the routes it offers. */
  function openProviderMenu(dialog: HTMLElement): HTMLElement[] {
    fireEvent.click(providerField(dialog))
    return within(within(dialog).getByRole('listbox')).getAllByRole('option')
  }

  it('configures the route the dropdown names and answers with a breakdown', async () => {
    const providers = [
      autoProvider,
      { id: 'acme', settingsNs: 'llm-pi-ai', name: 'Acme Gateway' },
    ]
    const autoConfigurableProviders = vi.fn().mockResolvedValue({ kind: 'listed' as const, providers })
    const autoConfigure = vi.fn().mockResolvedValue({ kind: 'configured' as const, models: 27, enriched: 20 })
    renderSelect({ autoConfigurableProviders, autoConfigure })

    const { dialog, select } = await openAutoConfig()
    // One route needs no second gesture: the field opens already naming it, and
    // says which route it holds to a reader that cannot see the field.
    expect(select.textContent).toContain('Orbit')
    expect(select.getAttribute('aria-label')).toBe('模型提供方，当前 Orbit')
    expect(select.getAttribute('aria-expanded')).toBe('false')

    // The list is the dialog's own, not the platform's select popup.
    expect(openProviderMenu(dialog).map(row => row.textContent)).toEqual([
      'Orbit',
      'Acme Gateway',
    ])
    expect(select.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(within(dialog).getByRole('option', { name: 'Acme Gateway' }))
    expect(within(dialog).queryByRole('listbox')).toBeNull()
    expect(select.textContent).toContain('Acme Gateway')
    // The keyboard comes back to the field the list belonged to.
    expect(document.activeElement).toBe(select)

    fireEvent.click(within(dialog).getByRole('button', { name: zh['auto.confirm'] }))

    // The form closes and the result takes its place, so the numbers are read
    // as an outcome rather than as lines inside the form that produced them.
    const done = await screen.findByRole('dialog', { name: zh['auto.doneTitle'] })
    expect(autoConfigure).toHaveBeenCalledWith(providers[1])
    // The headline states the total; the body says what the split means for
    // whoever has to act on it.
    expect(done.textContent).toContain('已配置 27 个模型。')
    expect(within(done).getByText(
      '其中 20 个的名称、上下文容量与推理等级来自 models.dev 目录；另外 7 个仅来自提供方自身的列表，可能需要手动补充。',
    )).toBeTruthy()
    expect(screen.queryByRole('dialog', { name: zh['auto.title'] })).toBeNull()
    // The picker behind it stays open, so the models just written are one click away.
    expect(screen.getByRole('dialog', { name: zh['dialog.title'] })).toBeTruthy()

    fireEvent.click(within(done).getByRole('button', { name: commonZh.ok }))
    expect(screen.queryByRole('dialog', { name: zh['auto.doneTitle'] })).toBeNull()
    expect(screen.getByRole('dialog', { name: zh['dialog.title'] })).toBeTruthy()
  })

  it.each([
    // Every model matched a catalog record: one sentence says so, and no split
    // is reported because there is nothing to split.
    [{ models: 4, enriched: 4 }, '它们的名称、上下文容量与推理等级全部来自 models.dev 目录。'],
    // The mirror: the catalog described nothing, so the sentence names the
    // number that will need attention.
    [{ models: 3, enriched: 0 }, 'models.dev 目录未描述其中任何一个，因此这 3 个模型全部依据提供方自身的列表配置，可能需要手动补充。'],
  ] as const)('says in words what the outcome was (%j)', async (configured, sentence) => {
    renderSelect({ autoConfigure: vi.fn().mockResolvedValue({ kind: 'configured' as const, ...configured }) })

    const { dialog } = await openAutoConfig()
    fireEvent.click(within(dialog).getByRole('button', { name: zh['auto.confirm'] }))

    const done = await screen.findByRole('dialog', { name: zh['auto.doneTitle'] })
    expect(done.textContent).toContain(`已配置 ${String(configured.models)} 个模型。`)
    expect(within(done).getByText(sentence)).toBeTruthy()
  })

  it('lets Escape close the field\'s list without taking the dialog with it', async () => {
    renderSelect()

    const { dialog } = await openAutoConfig()
    expect(openProviderMenu(dialog)).toHaveLength(1)

    // The list is what the reader is dismissing, so the dialog that holds it
    // survives the key — and the second press is the dialog's own.
    fireEvent.keyDown(within(dialog).getByRole('listbox'), { key: 'Escape' })
    expect(within(dialog).queryByRole('listbox')).toBeNull()
    expect(screen.getByRole('dialog', { name: zh['auto.title'] })).toBeTruthy()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: zh['auto.title'] })).toBeNull()
  })

  it('dismisses the list when a press lands elsewhere in the dialog', async () => {
    renderSelect()

    const { dialog } = await openAutoConfig()
    expect(openProviderMenu(dialog)).toHaveLength(1)

    fireEvent.pointerDown(within(dialog).getByRole('button', { name: zh['auto.confirm'] }))
    expect(within(dialog).queryByRole('listbox')).toBeNull()
    expect(providerField(dialog).textContent).toContain('Orbit')
  })

  it('keeps the picker open and lets Escape close one stacked dialog at a time', async () => {
    const { autoConfigure } = renderSelect()
    const { trigger } = await openAutoConfig()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: zh['auto.title'] })).toBeNull()
    expect(screen.getByRole('dialog', { name: zh['dialog.title'] })).toBeTruthy()

    // The success dialog answers to Escape like the form it replaced.
    const reopened = await openAutoDialog()
    fireEvent.click(within(reopened).getByRole('button', { name: zh['auto.confirm'] }))
    await waitFor(() => { expect(autoConfigure).toHaveBeenCalledTimes(1) })
    await screen.findByRole('dialog', { name: zh['auto.doneTitle'] })

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: zh['auto.doneTitle'] })).toBeNull()
    expect(screen.getByRole('dialog', { name: zh['dialog.title'] })).toBeTruthy()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: zh['dialog.title'] })).toBeNull()
    await waitFor(() => { expect(document.activeElement).toBe(trigger) })
  })

  it('reports a refused configuration without taking the provider list away', async () => {
    const autoConfigure = vi.fn().mockResolvedValue({ kind: 'failed' as const, message: 'endpoint refused' })
    renderSelect({ autoConfigure })

    const { dialog, select } = await openAutoConfig()
    expect(select.disabled).toBe(false)
    fireEvent.click(within(dialog).getByRole('button', { name: zh['auto.confirm'] }))
    expect((await screen.findByRole('alert')).textContent).toBe('模型操作失败：endpoint refused')
    expect(select.disabled).toBe(false)
  })

  it('reports a directory that could not be read and leaves the action inert', async () => {
    // A failed directory read has no route to offer, so the failure takes the
    // place of the empty-directory note and nothing can be submitted.
    renderSelect({
      autoConfigurableProviders: vi.fn().mockResolvedValue({ kind: 'failed' as const, message: 'no directory' }),
    })

    const { dialog, select } = await openAutoConfig()
    expect(select.disabled).toBe(true)
    expect(within(dialog).getByRole('alert').textContent).toBe('模型操作失败：no directory')
    expect(within(dialog).getByRole('button', { name: zh['auto.confirm'] }).hasAttribute('disabled')).toBe(true)
    expect(screen.queryByText(zh['auto.empty'])).toBeNull()
  })

  it('says no provider can be configured and leaves the action inert', async () => {
    renderSelect({ autoConfigurableProviders: vi.fn().mockResolvedValue({ kind: 'listed' as const, providers: [] }) })

    const { dialog, select } = await openAutoConfig()
    expect(within(dialog).getByText(zh['auto.empty'])).toBeTruthy()
    expect(select.disabled).toBe(true)
    expect(within(dialog).getByRole('button', { name: zh['auto.confirm'] }).hasAttribute('disabled')).toBe(true)
    expect(screen.queryByText(zh['auto.loading'])).toBeNull()
  })

  it('holds the action while a configuration is in flight', async () => {
    type Settled = { kind: 'configured'; models: number; enriched: number }
    let settle: ((outcome: Settled) => void) | undefined
    const autoConfigure = vi.fn(() => new Promise<Settled>((resolve) => {
      settle = resolve
    }))
    renderSelect({ autoConfigure })

    const { dialog } = await openAutoConfig()
    fireEvent.click(within(dialog).getByRole('button', { name: zh['auto.confirm'] }))

    await waitFor(() => {
      expect(within(dialog).getByText(zh['auto.running'])).toBeTruthy()
      expect(providerField(dialog).hasAttribute('disabled')).toBe(true)
    })
    fireEvent.click(within(dialog).getByRole('button', { name: zh['auto.confirm'] }))
    expect(autoConfigure).toHaveBeenCalledTimes(1)

    settle?.({ kind: 'configured', models: 3, enriched: 2 })
    // The form is gone with the request that filled it; the answer is the
    // success dialog, which is the only thing left to acknowledge.
    expect(await screen.findByText('已配置 3 个模型。')).toBeTruthy()
    expect(screen.queryByRole('dialog', { name: zh['auto.title'] })).toBeNull()
    expect(screen.getByRole('dialog', { name: zh['auto.doneTitle'] })).toBeTruthy()
  })
})

describe('ModelSelect provider settings action', () => {
  it('closes the picker and announces the Models settings page', async () => {
    renderSelect()
    const { trigger } = openDialog()

    const announced: string[] = []
    const listener = (event: Event): void => { announced.push((event as CustomEvent).type) }
    window.addEventListener('dsh:open-settings-models', listener)
    try {
      fireEvent.click(screen.getByRole('button', { name: zh['manage.aria'] }))
    } finally {
      window.removeEventListener('dsh:open-settings-models', listener)
    }

    expect(announced).toEqual(['dsh:open-settings-models'])
    expect(screen.queryByRole('dialog', { name: zh['dialog.title'] })).toBeNull()
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    // The settings panel takes focus when it mounts; the seat behind it must
    // not queue a focus restore over it.
    await waitFor(() => { expect(document.activeElement).not.toBe(trigger) })
  })
})
