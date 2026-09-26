/** Plugin wiring shared by the shipped apply and the tests that drive it. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the ctx.remote merge, the forwarded-event key face, and the
// attentionSounds payload vocabulary.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls ctx.locale into this program.
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the ctx.slots merge into this program.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls ctx.configForms into this program. Cross-plugin
// collaboration goes through the services, never a value import (client
// bundle purity gate).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls ctx.uiSession into this program.
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { AttentionAlerter, type AlerterPorts } from './alerter.ts'
import { AttentionSoundRow, type AttentionSoundRowInjected } from './AttentionSoundRow.tsx'
import { en, zh, type AttentionSoundKey } from './locales.ts'
import { ATTENTION_SOUND_NAMESPACE } from '../settings.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** General settings attention-sound row copy. */
    attentionSound: AttentionSoundKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'attentionSound'

/**
 * Register the dictionaries, the attention-moment subscriptions, and the
 * General settings row over supplied ports.
 * @param ctx - client root context.
 * @param ports - focus reads, Host sound picks, and playback.
 */
export function applyAttentionSound(ctx: ClientContext, ports: AlerterPorts): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-attention-sound: dictionaries')
  const preference = ctx.configForms.booleanPreference(ATTENTION_SOUND_NAMESPACE, 'enabled', {
    hostFallback: true, memoryStart: true,
  })
  const alerter = new AttentionAlerter(preference.value, ports)
  ctx.effect(() => {
    const disposeStatus = ctx.uiSession.sessionStatus.subscribe(() => {
      alerter.observe(ctx.uiSession.sessionStatus.getSnapshot())
    })
    const disposeError = ctx.remote.$on('api-session/error', () => { alerter.alert() })
    return () => { disposeStatus(); disposeError() }
  }, 'ui-attention-sound: attention moments')
  ctx.effect(() => ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item', id: 'attention-sound', order: 16, locale: NS,
    inject: (): AttentionSoundRowInjected => ({
      hooks: { enabled: preference.value },
      setEnabled: enabled => preference.set(enabled),
    }),
  }, AttentionSoundRow)), 'ui-attention-sound: General settings row')
}
