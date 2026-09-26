/** General Settings control for the attention-sound preference. */
import { useState } from 'react'
import { Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './AttentionSoundRow.module.css'

/** Accepted setting and ordered mutation supplied by the preference owner. */
export interface AttentionSoundRowInjected {
  hooks: { enabled: ObservableSnapshot<boolean> }
  setEnabled(enabled: boolean): Promise<void>
}

/**
 * Render the attention-sound toggle.
 * @param props - accepted preference, writer, and localized copy.
 * @returns the General Settings row.
 */
export function AttentionSoundRow({ useEnabled, setEnabled, t }:
  PropsRuntime<'settings.general.item'> & PropsLocale<'attentionSound'> & InjectFace<AttentionSoundRowInjected>) {
  const enabled = useEnabled(value => value)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  return <div className={css.row}>
    <div>
      <div className={css.title}>{t('title')}</div>
      <div className={css.description}>{t('description')}</div>
      {failed && <div role="alert">{t('error')}</div>}
    </div>
    <Switch checked={enabled} disabled={busy} label={t('title')}
      onChange={(next) => {
        setFailed(false)
        setBusy(true)
        void setEnabled(next).catch(() => { setFailed(true) }).finally(() => { setBusy(false) })
      }} />
  </div>
}
