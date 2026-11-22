/**
 * Measures seconds actually watched from the player's time updates, for the
 * heartbeats the server turns into views and the creator pool. Jumps (seeking)
 * and pauses add nothing.
 */
export const HEARTBEAT_SECONDS = 15;
/** Time updates closer together than this count as continuous playback. */
const MAX_STEP_SECONDS = 3;

export class WatchMeter {
  private last: number | null = null;
  private watched = 0;

  /** Call on every time update (about once a second). */
  tick(currentTime: number, playing: boolean): void {
    const last = this.last;
    this.last = currentTime;
    if (!playing || last === null) return;
    const step = currentTime - last;
    if (step > 0 && step <= MAX_STEP_SECONDS) this.watched += step;
  }

  /** Whole seconds watched since the last call; the fraction carries over. */
  take(): number {
    const whole = Math.floor(this.watched);
    this.watched -= whole;
    return whole;
  }
}
