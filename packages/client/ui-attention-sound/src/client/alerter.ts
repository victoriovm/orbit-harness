/** Attention-moment detection, gating, and playback for the browser half. */

import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { AttentionSoundPick } from '@deepseek-ai/dsh-api-remotes/client'
import type { SessionStatusSnapshot } from '@deepseek-ai/dsh-client-ui-session/client'

/** Where the alerter reads focus and obtains playback. */
export interface AlerterPorts {
  /** Whether the harness window holds focus right now. */
  isFocused(): boolean
  /**
   * Resolve one sound from the Host.
   * @returns the pick, or undefined when the Host offers none or the call fails.
   */
  pick(): Promise<AttentionSoundPick | undefined>
  /**
   * Play one sound once.
   * @param sound - the sound to play.
   * @returns settlement after playback ends or is refused.
   */
  play(sound: AttentionSoundPick): Promise<void>
}

/** Minimum spacing between two alerts, so one attention burst stays one sound. */
export const ATTENTION_COALESCE_MS = 2000

/**
 * Turns Session-status transitions into at most one sound: a Session stopping
 * (task finished), a pending interaction appearing (approval, question, plan
 * review), or a Host-reported error — each only while the window is unfocused
 * and the preference allows playback. All ports resolve; none rejects.
 */
export class AttentionAlerter {
  private previous: SessionStatusSnapshot = new Map()
  private lastAlertedAt = Number.NEGATIVE_INFINITY
  private playing: Promise<void> | undefined

  /**
   * @param enabled - accepted preference, read per alert.
   * @param ports - focus reads, Host sound picks, and playback.
   * @param now - the clock spacing alerts apart.
   * @param coalesceMs - minimum spacing between two alerts.
   */
  constructor(
    private readonly enabled: ObservableSnapshot<boolean>,
    private readonly ports: AlerterPorts,
    private readonly now: () => number = Date.now,
    private readonly coalesceMs = ATTENTION_COALESCE_MS,
  ) {}

  /**
   * Fold one Session-status snapshot; the first snapshot is the baseline and
   * never alerts, so a client booting into already-idle or already-pending
   * Sessions stays silent.
   * @param snapshot - the current status of every known Session.
   */
  observe(snapshot: SessionStatusSnapshot): void {
    for (const [sessionId, status] of snapshot) {
      const previous = this.previous.get(sessionId)
      if (previous === undefined) continue
      if (previous.running === true && status.running === false) this.alert()
      if (previous.pendingInteraction === undefined && status.pendingInteraction !== undefined) this.alert()
    }
    this.previous = snapshot
  }

  /** Request one sound; skipped while focused, disabled, coalesced, or already playing. */
  alert(): void {
    if (this.playing !== undefined) return
    if (!this.enabled.getSnapshot()) return
    if (this.ports.isFocused()) return
    const at = this.now()
    if (at - this.lastAlertedAt < this.coalesceMs) return
    this.lastAlertedAt = at
    this.playing = this.ports.pick()
      .then(sound => sound === undefined ? undefined : this.ports.play(sound))
      .catch(() => {
        // Ports resolve by contract; an unexpected rejection must not surface
        // as an unhandled rejection, because the alert is best-effort.
      })
      .finally(() => { this.playing = undefined })
  }
}
