/** The attention-sound namespace: a live volatile field, off the generated pages. */
import { Context } from '@deepseek-ai/cordis'
import { expect, it, onTestFinished } from 'vitest'
import { liveConfig, omitsGeneratedPage } from '../../../settings/settings/tests/live-config.ts'
import { plainConfig } from '../../../settings/settings/src/schema.ts'
import * as AttentionSound from '../src/index.ts'

it('ships enabled as the schema default and updates without remounting', async () => {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  const configuration = await liveConfig(ctx, AttentionSound)
  expect(plainConfig(configuration.fiber.config)).toMatchObject({ enabled: true })
  await configuration.update({ enabled: false })
  expect(plainConfig(configuration.fiber.config)).toMatchObject({ enabled: false })
  expect(configuration.entry.fiber).toBe(configuration.fiber)
})

it('keeps its own instance off the generated Settings pages', () => omitsGeneratedPage(ctx => ctx.plugin(AttentionSound)))
