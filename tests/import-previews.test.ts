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

test('one student cannot reserve the global preview capacity', () => {
  const previews = new ImportPreviews(() => 1000, 1000, 2)
  previews.issue('alice', 'first', 'private')
  previews.issue('alice', 'second', 'private')
  assert.throws(() => previews.issue('alice', 'third', 'private'), /Too many pending/)
  assert.ok(previews.issue('bob', 'shared-admin-work', 'shared'))
})

test('review tickets cannot be moved between shared and private import destinations', () => {
  const previews = new ImportPreviews()
  const shared = previews.issue('alice', 'same-content-revision', 'shared')
  const personal = previews.issue('alice', 'same-content-revision', 'private')
  assert.throws(() => previews.consume('alice', shared, 'private'), /another workspace/)
  assert.throws(() => previews.consume('alice', personal, 'shared'), /another workspace/)
  assert.equal(previews.consume('alice', shared, 'shared'), 'same-content-revision')
  assert.equal(previews.consume('alice', personal, 'private'), 'same-content-revision')
})
