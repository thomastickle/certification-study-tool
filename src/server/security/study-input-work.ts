/** Retain cancellation through the awaited body reader and controller operation. */
export class StudyInputWork {
  private readonly cancellation = new AbortController()

  get signal(): AbortSignal {
    return this.cancellation.signal
  }

  /** Abort cooperative body/business work while preserving the first failure reason. */
  cancel(error: unknown): void {
    this.cancellation.abort(error)
  }

  /** Check cancellation only after the serial reader and controller have fully settled. */
  async settle(): Promise<void> {
    this.signal.throwIfAborted()
  }
}
