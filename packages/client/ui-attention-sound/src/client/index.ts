/**
 * Browser half: play one Host-picked sound when the harness needs attention
 * while its window is unfocused, with the enable choice in General settings.
 * Export discipline: packages/client/AGENTS.md.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { playSound } from './player.ts'
import { applyAttentionSound } from './wiring.ts'

/** Required services (cordis fiber inject). */
export const inject = ['remote', 'uiSession', 'configForms', 'slots', 'locale']

/**
 * Wire the alerter and the General settings row over the client context.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  applyAttentionSound(ctx, {
    isFocused: () => document.hasFocus(),
    pick: async () => {
      const response = await ctx.remote.attentionSounds.pick()
      return response.ok ? response.value : undefined
    },
    play: playSound,
  })
}
