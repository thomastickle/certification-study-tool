import type { NestExpressApplication } from '@nestjs/platform-express'

/** Own sequential transport startup and one disposal without modifying the native Nest app. */
export class ApplicationOwner {
  private starting: Promise<void> | undefined
  private closing: Promise<void> | undefined

  constructor(readonly application: Promise<NestExpressApplication>) {}

  /** Initialize before listening; preserve the startup error even if disposal also fails. */
  async start(port: number, host: string): Promise<void> {
    if (this.starting || this.closing) {
      throw new Error('Application startup is already owned or closing.')
    }
    this.starting = (async () => {
      const app = await this.application
      if (this.closing) {
        return
      }
      await app.init()
      if (!this.closing) {
        await app.listen(port, host)
      }
    })()
    try {
      await this.starting
    } catch (error) {
      try {
        await this.close()
      } catch {
        console.error('Application startup cleanup failed.')
      }
      throw error
    }
  }

  /** Join startup before disposing acquired resources; repeated shutdown shares the result. */
  close(): Promise<void> {
    this.closing ??= (async () => {
      await this.starting?.catch(() => undefined)
      const app = await this.application.catch(() => undefined)
      await app?.close()
    })()
    return this.closing
  }
}
