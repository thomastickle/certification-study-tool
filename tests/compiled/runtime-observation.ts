import assert from 'node:assert/strict'
import { mock } from 'node:test'
import { ApplicationRuntime } from '../../src/server/application-runtime.ts'

/** Observe the real factory's root owner even when public initialization rejects before return. */
export function observeRuntime() {
  const acquired: { runtime?: ApplicationRuntime } = {}
  const attach = ApplicationRuntime.prototype.attachTransport
  const observation = mock.method(
    ApplicationRuntime.prototype,
    'attachTransport',
    function (this: ApplicationRuntime, ...args: Parameters<typeof attach>) {
      acquired.runtime = this
      return attach.apply(this, args)
    },
  )
  return {
    get runtime() {
      assert.ok(acquired.runtime, 'The production factory must acquire and attach its runtime')
      return acquired.runtime
    },
    restore: () => observation.mock.restore(),
  }
}
