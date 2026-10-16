import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LibraryRepository } from '../src/server/questions/library-repository.ts';
import { ImportService } from '../src/server/importer/import-service.ts';
import { bank } from './fixtures.ts';

test('preview is read-only; confirming imports a source and its questions atomically', () => {
  const repository = new LibraryRepository(':memory:');
  try {
    const service = new ImportService(repository);
    const input = bank();
    const preview = service.preview(input);
    assert.equal(preview.added, 1);
    assert.deepEqual(repository.sources(), []);
    service.confirm(input, preview.token, false);
    assert.equal(repository.sources()[0]?.questionCount, 1);
    assert.equal(repository.questions().items[0]?.data.question, input.questions[0]?.question);
  } finally { repository.close(); }
});

test('invalid records reject the whole bank and identify each failing question', () => {
  const repository = new LibraryRepository(':memory:');
  try {
    const service = new ImportService(repository);
    const input = bank();
    input.questions.push({ ...structuredClone(input.questions[0]!), source_ref: '2', select_count: 2 });
    input.questions[0]!.answers[0]!.correct = false;
    assert.throws(() => service.preview(input), error => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /Question 1/);
      assert.match(error.message, /Question 2/);
      return true;
    });
    assert.equal(repository.sources().length, 0);
  } finally { repository.close(); }
});

test('reimport skips unchanged records and requires review before changing content', () => {
  const repository = new LibraryRepository(':memory:');
  try {
    const service = new ImportService(repository);
    const input = bank();
    service.confirm(input, service.preview(input).token, false);
    const id = repository.questions().items[0]!.id;
    assert.equal(service.preview(JSON.parse(JSON.stringify(input))).unchanged, 1);
    const changed = structuredClone(input);
    changed.questions[0]!.classification!.topic = 'Reviewed topic';
    const preview = service.preview(changed);
    assert.equal(preview.changed.length, 1);
    assert.throws(() => service.confirm(changed, preview.token, false), /review/i);
    assert.equal(repository.questions().items[0]!.data.classification!.topic, 'Synthetic data');
    service.confirm(changed, preview.token, true);
    assert.equal(repository.questions().items[0]!.id, id);
    assert.equal(repository.questions().items[0]!.data.classification!.topic, 'Reviewed topic');
  } finally { repository.close(); }
});
