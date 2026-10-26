import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ImportPreviews } from '../src/server/importer/import-previews.ts'

test('import tickets are account-bound, single-use, time-limited and capacity-bounded', () => {
  let now = 1000
  const previews = new ImportPreviews(() => now, 2)
  const alice = previews.issue('alice', 'alice-content-revision')
  const bob = previews.issue('bob', 'bob-content-revision')
  assert.throws(() => previews.consume('bob', alice), /another workspace/)
  assert.throws(() => previews.issue('charlie', 'another-revision'), /Too many pending/)
  assert.equal(previews.consume('alice', alice), 'alice-content-revision')
  assert.throws(() => previews.consume('alice', alice), /expired/)
  const replacement = previews.issue('alice', 'new-revision')
  now += 600_000
  assert.throws(() => previews.consume('alice', replacement), /expired/)
  assert.throws(() => previews.consume('bob', bob), /expired/)
  const fresh = previews.issue('charlie', 'fresh-revision')
  assert.equal(previews.consume('charlie', fresh), 'fresh-revision')
})
