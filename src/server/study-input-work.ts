/** Own complete input operations; a fail-fast Nest aggregate cannot prove sibling settlement. */
export class StudyInputWork {
  private pending = new Set<Promise<unknown>>()
  private cancellation = new AbortController()
  private failed = false
  private failure: unknown

  get signal(): AbortSignal {
    return this.cancellation.signal
  }

  /** Register before invoking a factory, including its full ordered parameter-pipe chain. */
  run(work: () => unknown): Promise<unknown> {
    const operation = Promise.resolve()
      .then(() => {
        this.signal.throwIfAborted()
        return work()
      })
      .catch((error: unknown) => {
        this.cancel(error)
        throw error
      })
    this.pending.add(operation)
    void operation.then(
      () => this.pending.delete(operation),
      () => this.pending.delete(operation),
    )
    return operation
  }

  /** Cancel cooperative inputs without destroying the HTTP response; retain the first failure. */
  cancel(error: unknown): void {
    if (!this.failed) {
      this.failed = true
      this.failure = error
      this.cancellation.abort(error)
    }
  }

  /** Await non-cooperative resource work as well as cancellation cleanup before closing storage. */
  async settle(): Promise<void> {
    while (this.pending.size) {
      await Promise.allSettled([...this.pending])
    }
    if (this.failed) {
      throw this.failure
    }
  }
}
