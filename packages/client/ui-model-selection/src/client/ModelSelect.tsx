/**
 * ModelSelect: the composer's named model seat (`conversation.input.model`).
 * The trigger opens a searchable modal over the shared per-session model
 * directory. Each flat model row identifies its provider, and the current
 * model's adapter-owned reasoning efforts are selectable in the same surface.
 * Model and effort choices apply immediately while the modal stays open. A
 * rejected selection announces through the shared transient Toast; catalog
 * failures remain visible beside Retry in the modal.
 */
import {
  useMemo, useRef, useState, useSyncExternalStore,
  type CSSProperties, type HTMLAttributes, type KeyboardEvent, type PointerEvent as ReactPointerEvent,
} from 'react'
import clsx from 'clsx'
import type { ModelReasoningEffort, ModelSelection } from '@deepseek-ai/dsh-api-remotes/client'
import {
  Button, IconBulbOutlineRegular, IconCheckOutlineRegular, IconChevronDownOutlineRegular,
  IconDataOutlineRegular, IconSearchOutlineRegular, IconSettingsOutlineRegular, IconWarningOutlineRegular, Input, Modal, Toast,
  useDismissOnOutsidePointer,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { AutoConfigureOutcome, AutoConfigureProvider, ModelSelectInjected } from './slots.ts'
import css from './ModelSelect.module.css'

/** One dynamic effort choice; undefined preserves the provider default. */
interface EffortChoice {
  key: string
  effort: string | undefined
  label: string
}

/**
 * The thinking levels every adapter's effort ids are drawn from, in escalation
 * order (the DeepSeek adapter offers its own off/low/high/max subset of them).
 * An id is otherwise an opaque wire spelling, so this list is what lets the
 * slider tell an ordinary level from one that costs noticeably more.
 */
const EFFORT_STRENGTH: readonly string[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']

/**
 * The effort tints, lowest level first. The first five are the palette at
 * https://www.color-hex.com/palettes/75933.png (lime through orange); the last
 * two extend it upward — red at the platform's own `--dsw-static-red-500`, and
 * the violet the platform ships no static token for — because the full
 * thinking ladder has more levels than that palette has swatches, and a model
 * offering all of them must not paint two levels the same. The bar carries the
 * level's color, so raising the effort walks the ramp from lime to violet; a
 * level the ladder cannot rank keeps the theme's own fill.
 */
const EFFORT_TINTS: readonly string[] = [
  '#99cc19', '#d1e277', '#f5da5f', '#ffa550', '#ff760d', '#ef4444', '#a78bfa',
]

/**
 * The heat of one level: its position on the thinking ladder, 0 at `off` and 1
 * at the top. An id the ladder does not name, and the provider default, have
 * no heat. The slider publishes this as `--effort-heat` and turns it into the
 * palette entry it selects, so the bar's color and its motion answer each
 * level instead of switching between two fixed looks.
 * @param effort - adapter-owned level id, or undefined for the provider default.
 * @returns the level's heat from 0 to 1, or undefined when the level has none.
 */
function effortHeat(effort: string | undefined): number | undefined {
  if (effort === undefined) return undefined
  const rank = EFFORT_STRENGTH.indexOf(effort)
  return rank < 0 ? undefined : rank / (EFFORT_STRENGTH.length - 1)
}

/**
 * The effort row: a draggable bar whose stops are the model's own levels. The
 * pointer may travel anywhere on the track, but the control reports only the
 * stop it settles on, so one gesture is one selection. The arrow keys, Home,
 * and End step the same stops. Each level name is drawn under its own stop, so
 * the name is a second hit area for the level it names.
 */
function EffortSlider({ label, stops, value, busy, onPick }: {
  label: string
  stops: readonly EffortChoice[]
  value: number
  busy: boolean
  onPick: (choice: EffortChoice) => void
}) {
  const count = stops.length
  // A model that reasons at a fixed effort has no levels to offer. The rail
  // still draws for it — inert, white, and without a handle — so the row keeps
  // its place in the modal while saying there is nothing here to pick.
  const locked = count === 0
  // The live fraction belongs to the gesture, so handlers read the ref and the
  // knob reads the state; a move delivered before React commits the press
  // still lands on the same gesture.
  const drag = useRef<number | null>(null)
  const [dragAt, setDragAt] = useState<number | null>(null)
  const moveTo = (fraction: number | null): void => {
    drag.current = fraction
    setDragAt(fraction)
  }
  /** Where one stop sits along the rail: 0 at the first, 1 at the last. */
  const positionOf = (index: number): number => count > 1 ? index / (count - 1) : 0.5
  /** The stop nearest a rail position. */
  const stopAt = (position: number): number =>
    Math.min(count - 1, Math.max(0, Math.round(position * (count - 1))))
  // A model switch can shrink the list under a value chosen for the previous
  // one, so the position is clamped rather than trusted.
  const active = locked ? 0 : Math.min(count - 1, Math.max(0, dragAt === null ? value : stopAt(dragAt)))
  const offset = locked ? 0 : dragAt ?? positionOf(active)
  /** The rail position one stop renders at, and the live one the knob rides. */
  const at = (position: number): CSSProperties => ({ '--effort-stop': position } as CSSProperties)
  // The heat follows the preview too, so dragging toward the top levels walks
  // the tint and speeds the sparks before the gesture is even released.
  const heat = effortHeat(stops[active]?.effort)
  const tint = heat === undefined
    ? undefined
    : EFFORT_TINTS[Math.round(heat * (EFFORT_TINTS.length - 1))]
  const trackRef = useRef<HTMLDivElement | null>(null)
  // The locked rail is decoration, not a control: there is no value to announce
  // and no gesture to offer, so it leaves the accessibility tree entirely.
  const semantics: HTMLAttributes<HTMLDivElement> = locked
    ? { 'aria-hidden': true }
    : {
      role: 'slider',
      tabIndex: 0,
      'aria-label': label,
      'aria-orientation': 'horizontal',
      'aria-valuemin': 0,
      'aria-valuemax': count - 1,
      'aria-valuenow': active,
      'aria-valuetext': stops[active]?.label,
      'aria-disabled': busy || undefined,
    }

  const fractionAt = (clientX: number): number => {
    const rect = trackRef.current?.getBoundingClientRect()
    if (rect === undefined || rect.width <= 0) return positionOf(active)
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
  }

  const pick = (index: number): void => {
    // The committed value, not the drag preview: a gesture that settles back on
    // the level already in use submits nothing.
    if (index === value) return
    const choice = stops[index]
    if (choice !== undefined) onPick(choice)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (busy) return
    const target = event.key === 'ArrowRight' || event.key === 'ArrowUp' ? active + 1
      : event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? active - 1
        : event.key === 'Home' ? 0
          : event.key === 'End' ? count - 1
            : undefined
    if (target === undefined) return
    event.preventDefault()
    pick(Math.min(count - 1, Math.max(0, target)))
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (busy || event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    moveTo(fractionAt(event.clientX))
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (drag.current === null || !event.currentTarget.hasPointerCapture(event.pointerId)) return
    moveTo(fractionAt(event.clientX))
  }

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    const settled = drag.current === null ? undefined : stopAt(drag.current)
    event.currentTarget.releasePointerCapture(event.pointerId)
    moveTo(null)
    if (settled !== undefined) pick(settled)
  }

  return (
    <div
      {...semantics}
      className={clsx(
        css.effortSlider,
        dragAt !== null && css.effortDragging,
        heat !== undefined && heat > 0 && css.effortHeated,
        locked && css.effortLocked,
      )}
      style={{
        '--effort-heat': heat ?? 0,
        ...tint === undefined ? {} : { '--effort-tint': tint },
      } as CSSProperties}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => { moveTo(null) }}
      onLostPointerCapture={() => { moveTo(null) }}
    >
      <div className={css.effortBand} ref={trackRef}>
        <div className={css.effortTrack}>
          {stops.map((choice, index) => (
            <span
              key={choice.key}
              aria-hidden="true"
              className={clsx(css.effortTick, css.effortPlaced)}
              style={at(positionOf(index))}
            />
          ))}
          <div className={clsx(css.effortFill, css.effortPlaced)} style={at(offset)}>
            {!locked && <span aria-hidden="true" className={css.effortSparkles} />}
          </div>
        </div>
        {!locked && <span aria-hidden="true" className={clsx(css.effortKnob, css.effortPlaced)} style={at(offset)} />}
      </div>
      {!locked && (
        <div className={css.effortScale}>
          {stops.map((choice, index) => (
            <span
              key={choice.key}
              className={clsx(css.effortStop, css.effortPlaced, index === active && css.effortStopActive)}
              style={at(positionOf(index))}
            >
              {choice.label}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Render the composer model seat.
 * @param props - owner share (locked), shared model directory operations, and locale seat.
 * @returns the trigger and its searchable model-selection modal.
 */
export function ModelSelect(
  {
    locked, available, directory, load, selectionFor, select,
    autoConfigurableProviders, autoConfigure, t,
  }:
  ModelSelectInjected & { locked: boolean } & PropsLocale<'model'>,
) {
  const state = useSyncExternalStore(
    fn => directory.subscribe(fn),
    () => directory.getSnapshot(),
  )
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  // The auto-configuration surface: two dialogs, both stacked over the picker.
  // The first names the route to rebuild and reports a refusal in place; a
  // stored configuration closes it and answers with the second, so the number
  // written is read as a result rather than as a line in a form. The directory
  // it reads is the Host's, not this session's catalog, so a route that serves
  // no model yet still appears.
  const [autoOpen, setAutoOpen] = useState(false)
  const [autoProviders, setAutoProviders] = useState<readonly AutoConfigureProvider[]>([])
  const [autoLoaded, setAutoLoaded] = useState(false)
  const [autoProviderId, setAutoProviderId] = useState('')
  const [autoBusy, setAutoBusy] = useState(false)
  const [autoOutcome, setAutoOutcome] = useState<AutoConfigureOutcome | undefined>(undefined)
  const [autoPickerOpen, setAutoPickerOpen] = useState(false)
  // The stored write's own ledger, kept apart from `autoOutcome` so the two
  // dialogs never disagree about which attempt they are reporting.
  const [autoStored, setAutoStored] = useState<{ models: number; enriched: number } | undefined>(undefined)
  const autoPickerRef = useRef<HTMLDivElement | null>(null)
  const autoFieldRef = useRef<HTMLButtonElement | null>(null)
  // The field and its list are one popover: a press anywhere else in the
  // dialog (or behind it) dismisses the list without touching the choice.
  useDismissOnOutsidePointer(autoPickerRef, autoPickerOpen, setAutoPickerOpen)
  // The in-modal feedback strip serves catalog loads; a rejected SELECTION
  // announces through the transient toast instead, so the strip renders only
  // while the latest failure-capable action was a load.
  const lastActionRef = useRef<'load' | 'select'>('load')
  const [toast, setToast] = useState<{ seq: number; text: string } | null>(null)
  const toastSeq = useRef(0)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)

  const choices = useMemo(() => state.groups.flatMap(group =>
    group.models.map(model => ({ group, model }))), [state.groups])
  const currentChoice = state.current === null
    ? undefined
    : choices.find(choice => (
      choice.group.id === state.current?.provider
      && choice.model.id === state.current.model
    ))
  const reasoning = currentChoice?.model.reasoning
  const effectiveEffort = state.current?.reasoningEffort ?? reasoning?.defaultEffort
  const effortLabel = reasoning === undefined
    ? undefined
    : effectiveEffort === undefined
      ? t('effort.providerDefault')
      : reasoning.efforts.find(level => level.id === effectiveEffort)?.name ?? effectiveEffort
  const effortChoices = useMemo<readonly EffortChoice[]>(() => reasoning === undefined
    ? []
    : [
      ...reasoning.defaultEffort === undefined
        ? [{ key: 'provider-default', effort: undefined, label: t('effort.providerDefault') }]
        : [],
      ...reasoning.efforts.map((effort: ModelReasoningEffort) => ({
        key: `effort:${effort.id}`,
        effort: effort.id,
        label: effort.name,
      })),
    ], [reasoning, t])
  // The committed stop: the level the Session reports, or the one the model
  // defaults to. A level the adapter no longer advertises leaves the knob on
  // the first stop rather than reporting a position the list cannot name.
  const effortIndex = Math.max(0, effortChoices.findIndex(choice => choice.effort === effectiveEffort))
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const filteredChoices = useMemo(() => choices.filter(({ group, model }) => normalizedQuery === '' || (
    group.name.toLocaleLowerCase().includes(normalizedQuery)
    || group.id.toLocaleLowerCase().includes(normalizedQuery)
    || model.name.toLocaleLowerCase().includes(normalizedQuery)
    || model.id.toLocaleLowerCase().includes(normalizedQuery)
    || `${group.id}/${model.id}`.toLocaleLowerCase().includes(normalizedQuery)
  )), [choices, normalizedQuery])
  const busy = state.status === 'selecting'

  const reload = (): void => {
    lastActionRef.current = 'load'
    load()
  }

  const show = (): void => {
    triggerRef.current?.focus()
    setQuery('')
    setOpen(true)
    reload()
  }

  const close = (restoreFocus = true): void => {
    setOpen(false)
    setQuery('')
    if (restoreFocus) queueMicrotask(() => { triggerRef.current?.focus() })
  }

  const openAutoConfig = (): void => {
    setAutoOpen(true)
    setAutoLoaded(false)
    setAutoProviders([])
    setAutoProviderId('')
    setAutoOutcome(undefined)
    setAutoPickerOpen(false)
    void autoConfigurableProviders().then((answer) => {
      setAutoLoaded(true)
      if (answer.kind === 'failed') {
        setAutoOutcome(answer)
        return
      }
      setAutoProviders(answer.providers)
      // The first route is preselected: the dropdown always names something,
      // and a Host offering one route needs no second gesture to configure it.
      setAutoProviderId(answer.providers[0]?.id ?? '')
    })
  }

  const closeAutoConfig = (): void => {
    setAutoOpen(false)
    setAutoOutcome(undefined)
    setAutoPickerOpen(false)
  }

  const closeAutoStored = (): void => {
    setAutoStored(undefined)
  }

  /** Dismiss the field's list and leave the keyboard on the field itself. */
  const closeAutoPicker = (): void => {
    setAutoPickerOpen(false)
    autoFieldRef.current?.focus()
  }

  const runAutoConfig = (): void => {
    const provider = autoProviders.find(candidate => candidate.id === autoProviderId)
    if (provider === undefined || autoBusy) return
    setAutoBusy(true)
    setAutoOutcome(undefined)
    void autoConfigure(provider).then((outcome) => {
      setAutoBusy(false)
      // A stored configuration has nothing left to ask about, so it answers in
      // its own dialog; a refusal keeps the form, and the route it names, in
      // reach so the same gesture can be retried.
      if (outcome.kind === 'configured') {
        setAutoOpen(false)
        setAutoPickerOpen(false)
        setAutoOutcome(undefined)
        setAutoStored({ models: outcome.models, enriched: outcome.enriched })
        return
      }
      setAutoOutcome(outcome)
    })
  }

  // What the closed picker shows: the chosen route, or why there is nothing to
  // choose — the placeholder states the directory's own state, and the note
  // under the field explains the empty one.
  const autoProviderLabel = !autoLoaded
    ? t('auto.loading')
    : autoProviders.find(provider => provider.id === autoProviderId)?.name ?? t('auto.none')
  const storedTotal = autoStored?.models ?? 0
  const enrichedOfStored = autoStored?.enriched ?? 0
  const genericOfStored = storedTotal - enrichedOfStored

  const settleSelection = (result: Awaited<ReturnType<ModelSelectInjected['select']>>): void => {
    if (result === undefined || result.ok) return
    const { error } = result
    toastSeq.current += 1
    setToast({
      seq: toastSeq.current,
      text: error.code === 'session/writer-held'
        ? t('error.sessionInUse')
        : t('error.action', { message: `${error.code}: ${error.message}` }),
    })
  }

  const choose = (selection: ModelSelection): void => {
    if (busy || (state.current?.provider === selection.provider && state.current.model === selection.model)) {
      // Re-picking the route in use settles without submitting.
      if (rootRef.current !== null) close(true)
      return
    }
    lastActionRef.current = 'select'
    // The submitting row unmounts under the in-flight disabled state; keep the
    // keyboard on the trigger, which the modal's keys still reach.
    triggerRef.current?.focus()
    void select(selection).then(settleSelection)
  }

  const chooseEffort = (effort: string | undefined): void => {
    if (busy || state.current === null || effectiveEffort === effort) return
    lastActionRef.current = 'select'
    triggerRef.current?.focus()
    void select({
      provider: state.current.provider,
      model: state.current.model,
      ...effort === undefined ? {} : { reasoningEffort: effort },
    }).then(settleSelection)
  }

  if (!available) return null

  const waiting = state.current === null && state.status === 'loading'
  const modelLabel = waiting
    ? t('trigger.loading')
    : currentChoice?.model.name
      ?? (state.current === null ? t('trigger.fallback') : `${state.current.provider}/${state.current.model}`)
  const triggerLabel = effortLabel === undefined ? modelLabel : `${modelLabel} · ${effortLabel}`
  const triggerAria = waiting
    ? t('trigger.loading')
    : state.current === null
      ? t('trigger.selectAria')
      : effortLabel === undefined
        ? t('trigger.aria', { model: modelLabel })
        : t('trigger.ariaEffort', { model: modelLabel, effort: effortLabel })

  return (
    <div
      ref={rootRef}
      className={css.root}
      onMouseDown={(event) => {
        // WebKit blurs a focused row before click unless the button's mousedown keeps focus.
        if (event.target instanceof Element && event.target.closest('button') !== null) event.preventDefault()
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className={css.trigger}
        aria-label={triggerAria}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={triggerLabel}
        disabled={locked}
        onClick={() => { if (open) close(true); else show() }}
      >
        <IconDataOutlineRegular className={css.triggerIcon} size={16} />
        <span className={css.triggerLabel}>{modelLabel}</span>
        {effortLabel !== undefined && <span className={css.triggerEffort}>{effortLabel}</span>}
        <IconChevronDownOutlineRegular className={clsx(css.chevron, open && css.chevronOpen)} />
      </button>

      <Modal
        open={open}
        // The auto-configuration dialogs stack over this one and carry their
        // own Escape handlers, so this picker must not also answer that key
        // while either of them is up.
        onClose={() => { if (!autoOpen && autoStored === undefined) close() }}
        title={t('dialog.title')}
        closeLabel={t('close')}
        className={css.dialog as string}
        contentClassName={css.dialogContent as string}
        actions={(
          <>
            <button
              type="button"
              className={css.headerAction}
              aria-label={t('auto.aria')}
              title={t('auto.aria')}
              onClick={openAutoConfig}
            >
              <IconBulbOutlineRegular className={css.lamp} size={16} />
            </button>
            <button
              type="button"
              className={css.headerAction}
              aria-label={t('manage.aria')}
              title={t('manage.aria')}
              onClick={() => { close(false); window.dispatchEvent(new CustomEvent('dsh:open-settings-models')) }}
            >
              <IconSettingsOutlineRegular size={16} />
            </button>
          </>
        )}
      >
        <div className={css.picker}>
          <Input
            className={css.search as string}
            autoFocus
            type="search"
            value={query}
            icon={<IconSearchOutlineRegular />}
            placeholder={t('search.placeholder')}
            aria-label={t('search.aria')}
            onChange={(event) => { setQuery(event.target.value) }}
          />

          <div className={css.feedback}>
            {state.status === 'loading' && (
              <div className={css.status} role="status">{t('status.loading')}</div>
            )}
            {state.error !== null && lastActionRef.current === 'load' && (
              <div className={css.error} role="alert">
                <span>{t('error.action', { message: state.error })}</span>
                <button type="button" className={css.retry} onClick={reload}>{t('retry')}</button>
              </div>
            )}
            {state.failures.map(failure => (
              <div className={css.warning} role="status" key={failure.id}>
                <span>{t('warning.groupLoad', { name: failure.name, message: failure.message })}</span>
                <button type="button" className={css.retry} onClick={reload}>{t('retry')}</button>
              </div>
            ))}
          </div>

          <div
            className={clsx(css.groups, 'scrollable')}
            role="listbox"
            aria-label={t('list.aria')}
            aria-busy={state.status === 'loading' || busy}
          >
            {filteredChoices.map(({ group, model }) => {
              const selected = state.current?.provider === group.id && state.current.model === model.id
              return (
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className={clsx(css.option, selected && css.selected)}
                  key={`${group.id}:${model.id}`}
                  title={model.name}
                  aria-disabled={busy}
                  onClick={() => { choose(selectionFor(group, model)) }}
                >
                  <IconDataOutlineRegular className={css.optionIcon} size={16} />
                  <span className={css.optionCopy}>
                    <span className={css.modelName}>{model.name}</span>
                    <span className={css.modelId}>{group.id}/{model.id} · {group.name}</span>
                  </span>
                  <span className={css.check}>
                    {selected ? <IconCheckOutlineRegular /> : null}
                  </span>
                </button>
              )
            })}
            {state.status === 'ready' && filteredChoices.length === 0 && (
              <div className={css.empty} role="status">
                {choices.length === 0 ? t('empty.models') : t('empty.search')}
              </div>
            )}
          </div>

          <section className={css.effortSection}>
            <EffortSlider
              label={t('effort.aria')}
              stops={effortChoices}
              value={effortIndex}
              busy={busy}
              onPick={(choice) => { chooseEffort(choice.effort) }}
            />
            {/* The rail above stays decorative when a model has no levels, so
                the reason lives here, in the flow, where it is read out. */}
            {effortChoices.length === 0 && (
              <p className={css.effortNote}>{t('empty.efforts')}</p>
            )}
          </section>
        </div>
      </Modal>

      <Modal
        open={autoOpen}
        onClose={closeAutoConfig}
        title={t('auto.title')}
        closeLabel={t('close')}
        description={t('auto.description')}
        className={css.autoDialog as string}
        footer={(
          <>
            <Button variant="outline" onClick={closeAutoConfig}>{t('cancel')}</Button>
            <Button
              variant="outline"
              disabled={autoBusy || autoProviderId === ''}
              onClick={runAutoConfig}
            >
              {t('auto.confirm')}
            </Button>
          </>
        )}
      >
        <div className={css.autoField} ref={autoPickerRef}>
          <span className={css.autoFieldLabel}>{t('auto.provider')}</span>
          <button
            type="button"
            ref={autoFieldRef}
            className={css.autoSelect}
            // The field's name carries the value the closed control shows, as
            // the composer's model seat does; before a route is chosen the
            // placeholder already is the whole answer.
            aria-label={autoProviderId === ''
              ? t('auto.provider')
              : t('auto.pickerAria', { provider: autoProviderLabel })}
            aria-haspopup="listbox"
            aria-expanded={autoPickerOpen}
            disabled={autoBusy || autoProviders.length === 0}
            onClick={() => { setAutoPickerOpen(current => !current) }}
          >
            <span className={css.autoSelectLabel}>{autoProviderLabel}</span>
            <IconChevronDownOutlineRegular className={css.autoSelectChevron} size={12} />
          </button>
          {/* The list is the dialog's own, full width under the field it
              belongs to — the platform's select draws its popup outside the
              theme and paints the OS highlight over it, and a floating card
              would hang past a field this wide. */}
          {autoPickerOpen && (
            <div
              className={clsx(css.autoList, 'scrollable')}
              role="listbox"
              aria-label={t('auto.provider')}
              onKeyDown={(event) => {
                // Escape dismisses the list, not the dialog holding it: the
                // field's own popup is what a reader is closing, and stopping
                // the event here is what keeps the dialog's own Escape out of
                // it.
                if (event.key !== 'Escape') return
                event.stopPropagation()
                closeAutoPicker()
              }}
            >
              {autoProviders.map((provider) => {
                const chosen = provider.id === autoProviderId
                return (
                  <button
                    key={provider.id}
                    type="button"
                    role="option"
                    aria-selected={chosen}
                    className={clsx(css.autoOption, chosen && css.autoOptionSelected)}
                    onClick={() => {
                      setAutoProviderId(provider.id)
                      setAutoOutcome(undefined)
                      closeAutoPicker()
                    }}
                  >
                    <span className={css.autoOptionLabel}>{provider.name}</span>
                    {chosen && <IconCheckOutlineRegular className={css.autoOptionCheck} />}
                  </button>
                )
              })}
            </div>
          )}
        </div>
        {autoBusy && <p className={css.autoNote} role="status">{t('auto.running')}</p>}
        {autoLoaded && autoProviders.length === 0 && autoOutcome?.kind !== 'failed' && (
          <p className={css.autoNote} role="status">{t('auto.empty')}</p>
        )}
        {autoOutcome?.kind === 'failed' && (
          <p className={css.autoError} role="alert">{t('error.action', { message: autoOutcome.message })}</p>
        )}
      </Modal>

      <Modal
        open={autoStored !== undefined}
        onClose={closeAutoStored}
        title={t('auto.doneTitle')}
        closeLabel={t('close')}
        description={t('auto.done', { count: storedTotal })}
        className={css.autoDialog as string}
        footer={(
          <Button variant="outline" onClick={closeAutoStored}>{t('ok')}</Button>
        )}
      >
        {/* The breakdown reads as prose: a person asked for this outcome, and
            two counts with no sentence around them leave the reader to work out
            what they add up to. */}
        <p className={css.autoDoneNote}>
          {enrichedOfStored === 0
            ? t('auto.doneNone', { count: storedTotal })
            : genericOfStored === 0
              ? t('auto.doneAll', { count: enrichedOfStored })
              : t('auto.doneSplit', { enriched: enrichedOfStored, generic: genericOfStored })}
        </p>
      </Modal>

      {toast !== null && (
        <Toast
          key={toast.seq}
          text={toast.text}
          icon={<IconWarningOutlineRegular />}
          anchor={rootRef.current?.closest<HTMLElement>('[data-composer-card]') ?? null}
          onDone={() => { setToast(null) }}
        />
      )}
    </div>
  )
}
