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

test('duplicates retain both sources; conflicting answer keys require correction before saving', () => {
  const repository = new LibraryRepository(':memory:');
  try {
    const service = new ImportService(repository);
    const first = bank('first');
    service.confirm(first, service.preview(first).token, false);
    const second = bank('second');
    second.questions[0]!.question = '  WHICH option is a synthetic example!  ';
    second.questions[0]!.answers.reverse();
    const preview = service.preview(second);
    assert.equal(preview.duplicateCount, 1);
    assert.deepEqual(preview.conflicts, []);
    service.confirm(second, preview.token, false);
    assert.equal(repository.questions().total, 2);
    const conflicting = bank('conflicting');
    conflicting.questions[0]!.answers.forEach(a => { a.correct = !a.correct; });
    const conflict = service.preview(conflicting);
    assert.deepEqual(conflict.conflicts, ['1']);
    assert.throws(() => service.confirm(conflicting, conflict.token, true), /conflict/i);
    assert.equal(repository.sources().length, 2);
  } finally { repository.close(); }
});

test('missing study classification is allowed and reported for later review', () => {
  const repository = new LibraryRepository(':memory:');
  try {
    const service = new ImportService(repository);
    const input = bank();
    delete input.questions[0]!.classification;
    input.questions[0]!.source_classification = { area: 'Original domain', topic: null };
    assert.deepEqual(service.preview(input).unclassified, ['1']);
    service.confirm(input, service.preview(input).token, false);
    assert.equal(repository.questions().total, 1);
  } finally { repository.close(); }
});

test('questions with no classification at all can be imported for later curation', () => {
  const repository = new LibraryRepository(':memory:');
  try {
    const service = new ImportService(repository);
    const input = bank();
    delete input.questions[0]!.classification;
    const preview = service.preview(input);
    assert.deepEqual(preview.unclassified, ['1']);
    service.confirm(input, preview.token, false);
    assert.equal(repository.questions().total, 1);
  } finally { repository.close(); }
});

test('an import failure rolls back both source metadata and all questions', () => {
  class FailingRepository extends LibraryRepository {
    override saveQuestion(): void { throw new Error('Synthetic storage failure'); }
  }
  const repository = new FailingRepository(':memory:');
  try {
    const service = new ImportService(repository);
    const input = bank();
    const preview = service.preview(input);
    assert.throws(() => service.confirm(input, preview.token, false), /Synthetic storage failure/);
    assert.deepEqual(repository.sources(), []);
    assert.equal(repository.revision(), 0);
  } finally { repository.close(); }
});
