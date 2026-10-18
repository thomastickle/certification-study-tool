import { randomUUID } from 'node:crypto'
import type { QuizAnswer, QuizOptions, QuizSummary, QuizView } from '../../shared/quiz-contracts.ts'
import { ApplicationError } from '../errors.ts'
import type { LibraryRepository } from '../questions/library-repository.ts'
import type { StoredQuiz } from './quiz-repository.ts'
import { selectQuestions, shuffled } from './quiz-selection.ts'

export class QuizService {
  private repository: LibraryRepository
  private now: () => number
  private random: () => number
  constructor(repository: LibraryRepository, now = Date.now, random = Math.random) {
    this.repository = repository
    this.now = now
    this.random = random
  }
  start(input: unknown): QuizView {
    const options = this.options(input)
    return this.repository.quizStore().transaction(() => {
      const store = this.repository.quizStore()
      // Orphaned active attempts are abandoned when starting again; no resume flow yet.
      for (const old of store.active()) {
        if (old.deadline <= this.now()) this.finish(old)
        else {
          old.status = 'abandoned'
          old.finishedAt = this.now()
          store.save(old)
        }
      }
      const picked = selectQuestions(
        this.repository.allQuestions(),
        this.repository.sources(),
        options,
        store.boosts(),
        this.random,
      )
      const time = this.now()
      const quiz: StoredQuiz = {
        id: randomUUID(),
        status: 'active',
        startedAt: time,
        deadline: time + 20 * 60 * 1000,
        finishedAt: null,
        correctCount: null,
        total: 20,
        serverNow: time,
        options,
        questions: [],
        keys: [],
      }
      for (const { record, domain } of picked) {
        const answers = shuffled(record.data.answers, this.random)
        quiz.keys.push({
          fingerprint: record.fingerprint,
          correct: answers.flatMap((a, i) => (a.correct ? [i] : [])),
        })
        quiz.questions.push({
          questionId: quiz.questions.length,
          question: record.data.question,
          type: record.data.type,
          selectCount: record.data.select_count,
          answers: answers.map((a, i) => ({ id: i, text: a.text })),
          domain,
          sourceName: record.sourceName,
          sourceKind: this.repository.sources().find((s) => s.id === record.sourceId)!.kind,
          reference: record.reference,
          area: record.data.classification?.area ?? null,
          topic: record.data.classification?.topic ?? null,
          selected: [],
          confidence: null,
          flagged: false,
        })
      }
      store.save(quiz)
      return this.view(quiz)
    })
  }
  get(id: string): QuizView {
    return this.repository.quizStore().transaction(() => this.view(this.load(id)))
  }
  expireDue(): void {
    if (
      !this.repository
        .quizStore()
        .active()
        .some((q) => q.deadline <= this.now())
    )
      return
    this.repository.quizStore().transaction(() => {
      for (const quiz of this.repository.quizStore().active())
        if (quiz.deadline <= this.now()) this.finish(quiz)
    })
  }
  recent(): QuizSummary[] {
    return this.repository.quizStore().transaction(() => {
      for (const quiz of this.repository.quizStore().active())
        if (quiz.deadline <= this.now()) this.finish(quiz)
      return this.repository.quizStore().recent()
    })
  }
  save(id: string, input: unknown): QuizView {
    return this.change(id, input, 'save')
  }
  submit(id: string, input: unknown): QuizView {
    return this.change(id, input, 'submit')
  }
  abandon(id: string): QuizView {
    return this.repository.quizStore().transaction(() => {
      const quiz = this.load(id)
      if (quiz.status === 'active') {
        quiz.status = 'abandoned'
        quiz.finishedAt = this.now()
        this.repository.quizStore().save(quiz)
      }
      return this.view(quiz)
    })
  }
  private change(id: string, input: unknown, action: 'save' | 'submit'): QuizView {
    return this.repository.quizStore().transaction(() => {
      const quiz = this.load(id)
      // Deadline has precedence over late edits; score only previously saved choices.
      if (quiz.status !== 'active') return this.view(quiz)
      if (
        !input ||
        typeof input !== 'object' ||
        !('answers' in input) ||
        !Array.isArray(input.answers)
      )
        throw new ApplicationError('An answers array is required.')
      const updates = input.answers as unknown[]
      if (updates.length !== quiz.total)
        throw new ApplicationError('Send one answer record for every quiz question.')
      const seen = new Set<number>()
      for (const value of updates) {
        if (!value || typeof value !== 'object')
          throw new ApplicationError('Invalid answer record.')
        const a = value as QuizAnswer
        const question = quiz.questions[a.questionId]
        if (!Number.isInteger(a.questionId) || !question || seen.has(a.questionId))
          throw new ApplicationError('Invalid or repeated quiz question ID.')
        seen.add(a.questionId)
        if (
          !Array.isArray(a.selected) ||
          a.selected.length > question.selectCount ||
          new Set(a.selected).size !== a.selected.length ||
          a.selected.some(
            (i) => !Number.isInteger(i) || !question.answers.some((answer) => answer.id === i),
          )
        )
          throw new ApplicationError(`Invalid answer selection for question ${a.questionId + 1}.`)
        if (
          a.confidence !== null &&
          !['Confident', 'Educated Guess', 'Unsure'].includes(a.confidence)
        )
          throw new ApplicationError('Invalid confidence choice.')
        if (typeof a.flagged !== 'boolean')
          throw new ApplicationError('Return mark must be true or false.')
        question.selected = [...a.selected]
        question.confidence = a.confidence
        question.flagged = a.flagged
      }
      if (action === 'submit') this.finish(quiz)
      else this.repository.quizStore().save(quiz)
      return this.view(quiz)
    })
  }
  private load(id: string): StoredQuiz {
    const quiz = this.repository.quizStore().find(id)
    if (!quiz) throw new ApplicationError('Quiz not found.', 404)
    if (quiz.status === 'active' && quiz.deadline <= this.now()) this.finish(quiz)
    return quiz
  }
  private finish(quiz: StoredQuiz): void {
    if (quiz.status !== 'active') return
    quiz.status = 'completed'
    quiz.finishedAt = Math.min(this.now(), quiz.deadline)
    quiz.correctCount = 0
    quiz.questions.forEach((q, i) => {
      const key = quiz.keys[i]!
      const correct =
        q.selected.length === key.correct.length &&
        q.selected.every((answer) => key.correct.includes(answer))
      q.correct = correct
      q.correctAnswerIds = [...key.correct]
      if (correct) quiz.correctCount!++
      this.repository.quizStore().record(key.fingerprint, correct)
    })
    this.repository.quizStore().save(quiz)
  }
  private view(quiz: StoredQuiz): QuizView {
    const { keys: _keys, ...view } = structuredClone(quiz)
    view.serverNow = this.now()
    return view
  }
  private options(input: unknown): QuizOptions {
    if (!input || typeof input !== 'object')
      throw new ApplicationError('Quiz options are required.')
    const o = input as QuizOptions
    if (
      !['mixed', 'official', 'third_party'].includes(o.sourceFilter) ||
      !['mixed', 'single_select', 'multi_select'].includes(o.questionType)
    )
      throw new ApplicationError('Choose valid source and question-type filters.')
    if (o.sourceIds !== undefined) {
      const eligible = new Set(
        this.repository
          .sources()
          .filter(
            (s) =>
              s.provider === 'AWS' &&
              s.certification === 'CLF-C02' &&
              ['official', 'third_party'].includes(s.kind),
          )
          .map((s) => s.id),
      )
      if (
        !Array.isArray(o.sourceIds) ||
        !o.sourceIds.length ||
        new Set(o.sourceIds).size !== o.sourceIds.length ||
        o.sourceIds.some((id) => !Number.isSafeInteger(id) || id < 1 || !eligible.has(id))
      ) {
        throw new ApplicationError(
          'Select at least one available CLF-C02 source; source IDs must be unique positive integers.',
        )
      }
    }
    return {
      sourceFilter: o.sourceFilter,
      questionType: o.questionType,
      ...(o.sourceIds === undefined ? {} : { sourceIds: [...o.sourceIds] }),
    }
  }
}
