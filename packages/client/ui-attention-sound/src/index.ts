/**
 * Host half of the attention sound: owns the live settings namespace the
 * browser reads. Playback lives entirely in the browser half; this half only
 * persists the user's enabled choice through the settings form.
 */

import type { Context, Volatile } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'
import { ATTENTION_SOUND_NAMESPACE } from './settings.ts'

export { ATTENTION_SOUND_NAMESPACE }
export type { AttentionSoundSettings } from './settings.ts'

/** Runtime preferences projected to the browser. */
export interface Config {
  /** Whether the browser plays an attention sound while its window is unfocused. */
  enabled: Volatile<boolean>
}

/** Live preferences projected to the browser. */
export const Config = z.object({
  enabled: z.boolean().default(true).volatile(),
})

/**
 * Keep the namespace off the auto-generated Plugins pages: the General
 * settings row this feature registers is the choice's only editing surface.
 * @param ctx - Host context carrying the settings service.
 */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (child) => { child.effect(() => child.settings.configure({ auto: false }, ctx.fiber)) })
}
