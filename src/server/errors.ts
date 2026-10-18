export class ApplicationError extends Error {
  readonly status: number
  readonly details: string[]
  constructor(message: string, status = 400, details: string[] = []) {
    super(details.length ? `${message}\n${details.join('\n')}` : message)
    this.status = status
    this.details = details
  }
}
