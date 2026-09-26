/**
 * One boolean preference over a Host settings namespace, shared by the
 * features that own a toggle: Host-backed while the document serves the
 * namespace, browser-local when the connection keeps preferences
 * process-local. Reads publish only real changes, so renderer-bound hooks
 * never re-notify over an identical value.
 */

import { createSnapshotStore, type ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { ConfigForm } from './config-form-types.ts'

/** The accepted preference face features consume. */
export interface BooleanPreference {
  /** Accepted value, observable through renderer-bound hooks. */
  readonly value: ObservableSnapshot<boolean>
  /**
   * Persist a Host choice with ordered writes, or update the shared
   * browser-local choice in memory mode.
   * @param next - requested preference value.
   * @returns settlement after local publication or Host acceptance; rejects after a refused write recovers.
   */
  set(next: boolean): Promise<void>
}

/** Starting values for the two persistence faces of one preference. */
export interface BooleanPreferenceStarts {
  /** Value read while the Host document holds no accepted section for the namespace. */
  readonly hostFallback: boolean
  /** Browser-local value a memory-mode connection starts from. */
  readonly memoryStart: boolean
}

/**
 * Build one boolean preference over a namespace controller.
 * @param scope - settings-owned namespace controller.
 * @param field - scalar boolean field inside the namespace section.
 * @param starts - the two faces' starting values.
 * @returns the preference face.
 */
export function booleanPreference<Section extends object>(
  scope: ConfigForm<Section>,
  field: keyof Section & string,
  starts: BooleanPreferenceStarts,
): BooleanPreference {
  const local = createSnapshotStore(starts.memoryStart)
  if (scope.getSnapshot().mode === 'memory') {
    return {
      value: local,
      set: (next) => {
        local.set(next)
        return Promise.resolve()
      },
    }
  }
  // A stored section value that is not a boolean falls back, so a malformed
  // Host document reads as "no accepted value" instead of lying about state.
  const accepted = (): boolean => {
    const value = scope.getSnapshot().value?.[field]
    return typeof value === 'boolean' ? value : starts.hostFallback
  }
  return {
    value: {
      getSnapshot: accepted,
      subscribe: (listener) => {
        let previous = accepted()
        return scope.subscribe(() => {
          const next = accepted()
          if (next === previous) return
          previous = next
          listener()
        })
      },
    },
    set: async (next) => {
      if (!await scope.set(field, next)) throw new Error('Preference was not saved')
    },
  }
}
