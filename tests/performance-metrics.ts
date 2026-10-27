import { performance } from 'node:perf_hooks'
import { setTimeout as delay } from 'node:timers/promises'

/** Nearest-rank summaries; sample counts prevent tiny sets masquerading as tail estimates. */
export function summarize(values: number[]) {
  if (!values.length) {
    throw new Error('At least one sample is required')
  }
  const sorted = [...values].sort((a, b) => a - b)

  const rank = (fraction: number) => sorted[Math.ceil(sorted.length * fraction) - 1]!

  return {
    count: sorted.length,
    min: sorted[0]!,
    median: rank(0.5),
    p95: rank(0.95),
    max: sorted.at(-1)!,
  }
}

/** Observe timer gaps through the last synchronous slice, including a drain before cancellation. */
export class TimerProbe {
  private previous: number
  private gaps: number[] = []
  private timer: ReturnType<typeof setInterval>

  constructor(onSample = () => {}, now = () => performance.now()) {
    this.previous = now()
    this.timer = setInterval(() => {
      const sampledAt = now()
      this.gaps.push(sampledAt - this.previous)
      this.previous = sampledAt
      onSample()
    }, 1)
  }

  /** Drain timer callbacks before clearing, so a short entirely synchronous run is observable. */
  async stop() {
    await delay(5)
    clearInterval(this.timer)
    const maxGapMs = Math.max(...this.gaps)
    return { samples: this.gaps.length, maxGapMs, maxExcessMs: Math.max(0, maxGapMs - 1) }
  }
}
