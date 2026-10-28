import { Injectable } from '@nestjs/common'
import type { Server } from 'node:http'

/** Own actual handler promises rather than treating response finish/disconnect as completion. */
@Injectable()
export class SecurityRequestLifetime {
  private pending = new Set<Promise<void>>()
  private stopping = false

  get accepting(): boolean {
    return !this.stopping
  }

  /** Begin ownership synchronously in the first guard, before Nest awaits any later guard. */
  begin(): () => void {
    let complete!: () => void
    const operation = new Promise<void>((resolve) => {
      complete = resolve
    })
    this.pending.add(operation)
    void operation.then(() => this.pending.delete(operation))
    return complete
  }

  /** Reject new admissions before asynchronous web disposal begins. */
  stop(): void {
    this.stopping = true
  }

  /** Unblock partial body reads, then join work before Nest disposes HTTP and database roots. */
  async drain(server: Server): Promise<void> {
    this.stopping = true
    server.closeAllConnections()
    while (this.pending.size) {
      await Promise.allSettled([...this.pending])
    }
  }
}
