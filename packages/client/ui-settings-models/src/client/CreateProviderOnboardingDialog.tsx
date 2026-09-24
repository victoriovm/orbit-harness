/**
 * First-run provider step. Readiness comes from the same provider/settings/
 * credential join as the Models page: any provider the user can already talk to
 * ends the step, and only a user with none is asked for one.
 *
 * The step asks the three facts a hand-declared route cannot default — a name,
 * an endpoint, and a key — and reads the fourth, its models, from the endpoint
 * itself when the form is submitted. That is why there is no model list here:
 * a first-run user knows where their provider lives, not what it serves, and
 * the listing endpoint answers that better than a form field would.
 *
 * The write is the Models page's own create, in one step instead of three: the
 * profile at `providers.<route>` through `settings.mutate`, then the key under
 * the reference that profile records.
 */

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { apiKeyFailure } from './apiKey.ts'
import { EditorFooter } from './EditorFooter.tsx'
import type { ModelsSettingsState, ModelsSettingsStore } from './store.ts'
import { deriveKeyRef, onboardingReadiness } from './store.ts'
import type { ModelsOperations } from './operations.ts'
import type { en } from './locales.ts'
import { OnboardingModal } from './OnboardingModal.tsx'
import sections from './ModelsSection.module.css'
import styles from './CreateProviderOnboardingDialog.module.css'

/** The settings namespace a hand-declared provider is created in. */
const NS = 'llm-pi-ai'

/**
 * The protocol the step assumes. A gateway reached for the first time is
 * overwhelmingly an OpenAI-compatible one, and the alternative — a protocol
 * field — asks a first-run user for a detail the Models page can change later.
 */
const API = 'openai-completions'

/**
 * The route id a typed provider name yields: the name folded to the
 * lowercase-hyphenated identifier a settings key and a credential reference
 * both accept, suffixed when a route of that name is already declared. A name
 * with no letters left — a symbol, or a script the identifier cannot carry —
 * keeps the step usable by yielding the neutral `provider`.
 * @param name - the display name the user typed.
 * @param taken - route ids already declared.
 * @returns a route id that is free, valid, and derived from the name.
 */
export function providerRouteId(name: string, taken: readonly string[]): string {
  const slug = name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  const base = /^[a-z]/.test(slug) ? slug : /^[0-9]/.test(slug) ? `provider-${slug}` : 'provider'
  if (!taken.includes(base)) return base
  let suffix = 2
  while (taken.includes(`${base}-${String(suffix)}`)) suffix += 1
  return `${base}-${String(suffix)}`
}

/** Registration-side dependencies of {@link CreateProviderOnboardingDialog}. */
export interface CreateProviderOnboardingInjected {
  hooks: {
    /** Shared Models-page join state, bound by the slot renderer. */
    models: SnapshotStore<ModelsSettingsState>
  }
  /** Shared Models-page join controller. */
  controller: ModelsSettingsStore
  /** The Host operations this step writes and interrogates through. */
  operations: ModelsOperations
  /** Feature copy. */
  t: (key: keyof typeof en) => string
}

/** Slot owner props plus the feature's injected dependencies. */
export type CreateProviderOnboardingDialogProps =
  PropsRuntime<'settings.onboarding'> & InjectFace<CreateProviderOnboardingInjected>

/**
 * Ask a first-run user for the provider that will serve their sessions.
 * @param props - settings-shell owner state and Models feature dependencies.
 * @returns the onboarding modal, or null when onboarding needs no intervention.
 */
export function CreateProviderOnboardingDialog(props: CreateProviderOnboardingDialogProps): ReactNode {
  const { complete, controller, useModels, operations, t } = props
  const state = useModels(snapshot => snapshot)
  const readiness = onboardingReadiness(state)

  const [name, setName] = useState('')
  const [baseURL, setBaseURL] = useState('')
  const [keyDraft, setKeyDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  /**
   * The profile write landed, so only the key write can still be outstanding:
   * its revision is now superseded, and re-running the mutate would answer
   * `settings-conflict` and leave the key unstorable from this step.
   */
  const [committed, setCommitted] = useState(false)

  useEffect(() => {
    if (state.status === 'idle') void controller.load()
  }, [controller, state.status])

  useEffect(() => {
    // The two pass-through states are a load in progress and this step's own
    // form; every other verdict is the step standing down.
    if (
      readiness.kind === 'adapter-absent'
      || readiness.kind === 'provider-ready'
      || readiness.kind === 'unavailable'
      || readiness.kind === 'credential-missing'
    ) complete()
  }, [complete, readiness.kind])

  if (readiness.kind !== 'add-provider') return null

  const trimmedName = name.trim()
  const normalizedBaseURL = baseURL.trim()
  const urlInvalid = normalizedBaseURL.length > 0 && !isHttpUrl(normalizedBaseURL)
  const keyFailure = apiKeyFailure(keyDraft)
  // Empty means "this endpoint needs no key", which the profile records by
  // naming no reference at all rather than by resolving one nothing sets.
  const key = keyDraft.trim()
  const ready = trimmedName.length > 0 && normalizedBaseURL.length > 0 && !urlInvalid
    && keyFailure === undefined

  const create = async (): Promise<void> => {
    setBusy(true)
    setFailure(undefined)
    try {
      // The route cannot exist before it has a model, so the endpoint is asked
      // first — with the key the user just typed, which is the only credential
      // that can reach it and is not stored unless the whole create succeeds.
      const answer = await operations.discoverModels(NS, {
        baseURL: normalizedBaseURL,
        api: API,
        ...key.length === 0 ? {} : { apiKey: key },
      })
      if (answer.kind === 'refused') {
        setFailure(answer.message)
        return
      }
      if (answer.models.length === 0) {
        setFailure(t('addProviderOnboardingNoModels'))
        return
      }
      const routeId = providerRouteId(trimmedName, state.rows.map(row => row.entry.provider))
      const keyRef = deriveKeyRef(routeId)
      const section = state.namespaces.get(NS)
      /* v8 ignore next -- readiness admits only a state whose section is present. */
      if (section === undefined) return
      if (!committed) {
        const profile = {
          displayName: trimmedName,
          ...key.length === 0 ? {} : { apiKeyEnv: keyRef },
          api: API,
          baseURL: normalizedBaseURL,
          models: answer.models.map(model => ({
            id: model.id,
            ...model.name === undefined ? {} : { name: model.name },
            ...model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow },
            ...model.maxTokens === undefined ? {} : { maxTokens: model.maxTokens },
            ...model.inputModalities === undefined ? {} : { input: [...model.inputModalities] },
          })),
        }
        const written = await operations.writeSettings(
          NS,
          [{ op: 'set', path: ['providers', routeId], value: profile as JsonValue }],
          section.revision,
        )
        if (written.kind !== 'written') {
          setFailure(written.kind === 'conflict' ? t('conflict') : written.message)
          return
        }
        setCommitted(true)
      }
      if (key.length > 0) {
        const stored = await operations.storeCredential(keyRef, key)
        // The provider exists either way, so the step reports the key rather
        // than pretending nothing happened; the next submit retries just it.
        if (stored !== undefined) {
          setFailure(stored)
          return
        }
      }
      complete()
    } finally {
      setBusy(false)
    }
  }

  return (
    <OnboardingModal title={t('addProviderOnboardingTitle')}>
      <p className={styles.description}>{t('addProviderOnboardingDescription')}</p>
      <div className={styles.form}>
        <div className={sections['field']}>
          <span className={sections['fieldLabel']}>{t('addProviderOnboardingName')}</span>
          <input
            className={sections['input']}
            type="text"
            value={name}
            placeholder={t('addProviderOnboardingNamePlaceholder')}
            aria-label={t('addProviderOnboardingName')}
            autoFocus
            disabled={busy || committed}
            onChange={(event) => { setName(event.target.value) }}
          />
        </div>
        <div className={sections['field']}>
          <span className={sections['fieldLabel']}>{t('baseUrl')}</span>
          <input
            className={sections['input']}
            type="text"
            value={baseURL}
            placeholder={t('customBaseUrlPlaceholder')}
            aria-label={t('baseUrl')}
            aria-invalid={urlInvalid}
            disabled={busy || committed}
            onChange={(event) => { setBaseURL(event.target.value) }}
          />
        </div>
        {urlInvalid ? <p className={sections['error']}>{t('customBaseUrlInvalid')}</p> : null}
        <div className={sections['field']}>
          <span className={sections['fieldLabel']}>{t('keyInput')}</span>
          <input
            className={sections['input']}
            type="password"
            autoComplete="off"
            value={keyDraft}
            placeholder={t('keyPlaceholder')}
            aria-label={t('keyInput')}
            disabled={busy}
            onChange={(event) => { setKeyDraft(event.target.value) }}
          />
        </div>
        {keyFailure === undefined
          ? <p className={sections['advancedHint']}>{t('keyBlankNew')}</p>
          : <p className={sections['error']}>{t(keyFailure)}</p>}
        {failure !== undefined ? <p className={sections['error']} role="alert">{failure}</p> : null}
      </div>
      <div className={styles.actions}>
        <EditorFooter
          t={t}
          busy={busy}
          submitDisabled={busy || !ready}
          submitLabelKey="onboardingSave"
          submitBusyLabelKey="onboardingSaving"
          cancelLabelKey="onboardingLater"
          onCancel={() => { complete() }}
          onSubmit={() => { void create() }}
        />
      </div>
    </OnboardingModal>
  )
}

/** Whether a typed endpoint is one Fetch can be pointed at. */
function isHttpUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}
