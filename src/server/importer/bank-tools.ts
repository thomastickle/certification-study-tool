import { createHash } from 'node:crypto';
import type { Question } from '../../shared/contracts.ts';

/** Ignore JSON object property order, while preserving array order and all content. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.entries(value)
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
export function digest(value: unknown): string { return createHash('sha256').update(canonical(value)).digest('hex'); }
export function matchText(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(/\p{P}/gu, ' ').replace(/\s+/gu, ' ').trim();
}
export function fingerprint(question: Question): string {
  return digest([matchText(question.question), question.answers.map(a => matchText(a.text)).sort(), question.type]);
}
export function answerKey(question: Question): string {
  return digest([question.answers.filter(a => a.correct).map(a => matchText(a.text)).sort(), question.select_count]);
}
export function reference(question: Question): string { return question.source_ref ?? `content:${fingerprint(question)}`; }
