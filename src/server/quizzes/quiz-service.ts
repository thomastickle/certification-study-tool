import { certificationScope, sameCertification } from './certification-scope.ts'
import type { CertificationScope } from './certification-scope.ts'
import { randomUUID } from 'node:crypto'
import type {
  DueReviewSummary,
  DeletedQuizSummary,
  PauseCause,
  PracticeMode,
  QuizAnswer,
  QuizOptions,
  QuizSummary,
  QuizView,
} from '../../shared/quiz-contracts.ts'
import { ApplicationError } from '../errors.ts'
import type { LibraryRepository } from '../questions/library-repository.ts'
import type { StoredQuiz } from './quiz-repository.ts'
import { eligibleQuestions, selectQuestions, shuffled } from './quiz-selection.ts'
import { masteryHistory } from './mastery-history.ts'
import { currentQuestionIdentity } from './question-identity.ts'
import { completedRecency } from '../concepts/concept-variations.ts'
import { studyDay } from './mastery.ts'

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
      if (
        store
          .unfinished()
          .some(
            (q) =>
              q.status === 'paused' &&
              sameCertification(q.options, options) &&
              (q.options.mode ?? 'quiz') === (options.mode ?? 'quiz'),
          )
      ) {
        throw new ApplicationError(
          'Resume or abandon your paused attempt before starting another in this mode.',
          409,
        )
      }
      // Starting again abandons only active attempts; explicitly paused work is preserved.
      for (const old of store.active()) {
        if (
          !sameCertification(old.options, options) ||
          (old.options.mode ?? 'quiz') !== (options.mode ?? 'quiz')
        ) {
          continue
        }
        if (old.deadline <= this.now()) this.finish(old)
        else store.remove(old.id)
      }
      const completed = store.completed().filter((quiz) => sameCertification(quiz.options, options))
      const states = masteryHistory(completed).states
      const concepts = this.repository.conceptStore().all()
      const sources = this.repository.sources()
      const boosted = new Set(
        this.repository.allQuestions().flatMap((record) => {
          const source = sources.find((source) => source.id === record.sourceId)
          const identity = source && currentQuestionIdentity(record, source)
          return identity && states.get(identity)?.boosted ? [record.fingerprint] : []
        }),
      )
      const picked =
        options.mode === 'review'
          ? this.dueQuestions(options).picked
          : selectQuestions(
              this.repository.allQuestions(),
              this.repository.sources(),
              options,
              boosted,
              this.random,
              { groups: concepts, recency: completedRecency(completed) },
            )
      if (!picked.length) {
        throw new ApplicationError(
          'No eligible due questions. Due items may be excluded by these filters or unavailable in your library; they remain overdue.',
          422,
        )
      }
      const time = this.now()
      const quiz: StoredQuiz = {
        id: randomUUID(),
        status: 'active',
        pauseHistory: { complete: true, intervals: [] },
        startedAt: time,
        deadline: time + (options.mode === 'exam' ? 90 : 20) * 60 * 1000,
        finishedAt: null,
        correctCount: null,
        total: picked.length,
        serverNow: time,
        options,
        questions: [],
        keys: [],
      }
      const eligible = [
        ...eligibleQuestions(this.repository.allQuestions(), sources, options).values(),
      ]
      for (const { record, domain } of picked) {
        const source = sources.find((value) => value.id === record.sourceId)!
        const identity = currentQuestionIdentity(record, source)
        const membership = concepts.filter(
          (group) => identity && group.identities.includes(identity),
        )
        const direct = new Set(membership.flatMap((group) => group.identities))
        const alternate = eligible.some((candidate) => {
          const candidateSource = sources.find((value) => value.id === candidate.record.sourceId)!
          const candidateIdentity = currentQuestionIdentity(candidate.record, candidateSource)
          return (
            candidateIdentity &&
            candidateIdentity !== identity &&
            direct.has(candidateIdentity) &&
            candidate.domain === domain &&
            boosted.has(candidate.record.fingerprint) === boosted.has(record.fingerprint)
          )
        })
        const answers = shuffled(record.data.answers, this.random)
        quiz.keys.push({
          fingerprint: record.fingerprint,
          correct: answers.flatMap((a, i) => (a.correct ? [i] : [])),
        })
        quiz.questions.push({
          sourceId: record.sourceId,
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
          ...(membership.length
            ? { concepts: membership.map(({ id, name }) => ({ id, name })) }
            : {}),
          ...(membership.length && !alternate && options.mode !== 'review'
            ? {
                variationNote:
                  'No other reviewed variation matches these filters and this question’s practice priority.',
              }
            : {}),
          selected: [],
          confidence: null,
          flagged: false,
        })
      }
      store.save(quiz)
      return this.view(quiz)
    })
  }

  /**
   * Due obligations survive filters and deletion; reading never clears them.
   * @throws {ApplicationError} When filters are invalid or selected sources have conflicting keys.
   */
  due(input: unknown): DueReviewSummary {
    const options = this.options(input)
    this.expireDue()
    return this.dueQuestions(options).summary
  }

  /** Resolve lifetime obligations against both the whole library and requested pool. */
  private dueQuestions(options: QuizOptions) {
    const day = studyDay(this.now())
    const states = masteryHistory(
      this.repository
        .quizStore()
        .completed()
        .filter((quiz) => sameCertification(quiz.options, options)),
    ).states
    const due = [...states]
      .filter(([, state]) => state.dueDay !== null && state.dueDay <= day)
      .sort(([a, x], [b, y]) => x.dueDay!.localeCompare(y.dueDay!) || a.localeCompare(b))
    const sources = this.repository.sources()
    const records = this.repository.allQuestions()
    const all = new Set(
      records.flatMap((record) => {
        const source = sources.find((source) => source.id === record.sourceId)
        const identity = source && currentQuestionIdentity(record, source)
        return identity ? [identity] : []
      }),
    )
    const eligible = new Map(
      [...eligibleQuestions(records, sources, options).values()].flatMap((picked) => {
        const source = sources.find((source) => source.id === picked.record.sourceId)!
        const identity = currentQuestionIdentity(picked.record, source)
        return identity ? [[identity, picked] as const] : []
      }),
    )
    const picked = due.flatMap(([identity]) =>
      eligible.has(identity) ? [eligible.get(identity)!] : [],
    )
    const unavailable = due.filter(([identity]) => !all.has(identity)).length
    return {
      picked: picked.slice(0, 20),
      summary: {
        total: due.length,
        eligible: picked.length,
        unavailable,
        excluded: due.length - picked.length - unavailable,
        oldestDay: due[0]?.[1].dueDay ?? null,
      },
    }
  }

  get(id: string): QuizView {
    return this.repository.quizStore().transaction(() => this.view(this.load(id)))
  }

  /** Recover an unfinished attempt for this mode; overdue active attempts score normally. */
  current(mode: PracticeMode, scope: CertificationScope = {}): QuizView | null {
    const selectedScope = certificationScope(scope)
    return this.repository.quizStore().transaction(() => {
      for (const stored of this.repository.quizStore().unfinished()) {
        if (
          (stored.options.mode ?? 'quiz') !== mode ||
          !sameCertification(stored.options, selectedScope)
        ) {
          continue
        }
        const quiz = this.load(stored.id)
        if (quiz.status === 'active' || quiz.status === 'paused') return this.view(quiz)
      }
      return null
    })
  }

  /** Freeze the remaining server-owned time without grading or changing mastery. */
  pause(id: string, input: unknown = {}): QuizView {
    const cause = this.pauseCause(input)
    return this.repository.quizStore().transaction(() => {
      const time = this.now()
      const quiz = this.load(id, time)
      if (quiz.status === 'active') {
        quiz.status = 'paused'
        quiz.pausedAt = time
        quiz.pauseHistory ??= { complete: false, intervals: [] }
        quiz.pauseHistory.intervals.push({ startedAt: quiz.pausedAt, endedAt: null, cause })
        this.repository.quizStore().save(quiz)
      }
      return this.view(quiz)
    })
  }

  /** Restore exactly the remaining time; repeated resume requests cannot extend it. */
  resume(id: string): QuizView {
    return this.repository.quizStore().transaction(() => {
      const quiz = this.load(id)
      if (quiz.status === 'paused') {
        const time = this.now()
        quiz.pauseHistory ??= { complete: false, intervals: [] }
        let interval = quiz.pauseHistory.intervals.at(-1)
        if (!interval || interval.endedAt !== null) {
          // A legacy paused snapshot retains this interval's start, but not its cause.
          interval = { startedAt: quiz.pausedAt!, endedAt: null, cause: null }
          quiz.pauseHistory.intervals.push(interval)
        }
        interval.endedAt = time
        quiz.deadline = time + Math.max(0, quiz.deadline - quiz.pausedAt!)
        quiz.pausedAt = null
        quiz.status = 'active'
        this.repository.quizStore().save(quiz)
      }
      return this.view(quiz)
    })
  }

  expireDue(): void {
    this.repository.quizStore().purgeDeleted(this.now())
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

  recent(scope: CertificationScope = {}): QuizSummary[] {
    const selectedScope = certificationScope(scope)
    return this.repository.quizStore().transaction(() => {
      for (const quiz of this.repository.quizStore().active())
        if (quiz.deadline <= this.now()) this.finish(quiz)
      const store = this.repository.quizStore()
      return store
        .recent()
        .filter((quiz) => sameCertification(store.find(quiz.id)!.options, selectedScope))
        .map((quiz) => ({
          ...quiz,
          deletedBankNames: store.find(quiz.id)!.deletedBankNames ?? [],
        }))
    })
  }

  /** List only recoverable deletions in this certification, without answer content. */
  deletedResults(scope: CertificationScope = {}): DeletedQuizSummary[] {
    const store = this.repository.quizStore()
    store.purgeDeleted(this.now())
    return store
      .deleted()
      .filter((quiz) => sameCertification(quiz.options, scope))
      .sort((a, b) => b.deletedAt! - a.deletedAt! || a.id.localeCompare(b.id))
      .map((quiz) => this.deletedSummary(quiz))
  }

  /**
   * Exclude a completed attempt immediately; retries retain the original 48-hour deadline.
   * @throws {ApplicationError} If the attempt is unfinished.
   */
  deleteResult(id: string, permanent = false): DeletedQuizSummary | null {
    const store = this.repository.quizStore()
    store.purgeDeleted(this.now())
    return store.transaction(() => {
      const quiz = store.find(id)
      if (!quiz) {
        return null
      }
      if (quiz.status !== 'completed' && quiz.status !== 'deleted') {
        throw new ApplicationError('Only completed results can be deleted.', 409)
      }
      if (permanent) {
        store.remove(id)
        return null
      }
      if (quiz.status !== 'deleted') {
        quiz.status = 'deleted'
        quiz.deletedAt = this.now()
        quiz.purgeAt = quiz.deletedAt + 48 * 60 * 60 * 1000
        store.save(quiz)
      }
      return this.deletedSummary(quiz)
    })
  }

  /**
   * Restore the original evidence and timestamps, never creating a new attempt.
   * @throws {ApplicationError} If the result has expired or is not pending deletion.
   */
  restoreResult(id: string): QuizView {
    const store = this.repository.quizStore()
    // Purge before the transaction so a failed restore cannot roll back expiry.
    store.purgeDeleted(this.now())
    return store.transaction(() => {
      const quiz = store.find(id)
      if (!quiz) {
        throw new ApplicationError('Quiz not found.', 404)
      }
      if (quiz.status !== 'deleted') {
        throw new ApplicationError('This result is not pending deletion.', 409)
      }
      quiz.status = 'completed'
      delete quiz.deletedAt
      delete quiz.purgeAt
      store.save(quiz)
      return this.view(quiz)
    })
  }

  /** Keep recovery lists limited to attempt metadata. */
  private deletedSummary(quiz: StoredQuiz): DeletedQuizSummary {
    return {
      deletedBankNames: quiz.deletedBankNames ?? [],
      id: quiz.id,
      status: 'deleted',
      mode: quiz.options.mode ?? 'quiz',
      startedAt: quiz.startedAt,
      deadline: quiz.deadline,
      finishedAt: quiz.finishedAt,
      total: quiz.total,
      correctCount: quiz.correctCount,
      deletedAt: quiz.deletedAt!,
      purgeAt: quiz.purgeAt!,
    }
  }

  save(id: string, input: unknown): QuizView {
    return this.change(id, input, 'save')
  }

  submit(id: string, input: unknown): QuizView {
    return this.change(id, input, 'submit')
  }

  abandon(id: string): QuizView | null {
    return this.repository.quizStore().transaction(() => {
      const store = this.repository.quizStore()
      // Abandonment must not trigger expiry/grading as a side effect of loading.
      const quiz = store.find(id)
      if (!quiz) return null
      if (quiz.status === 'deleted') {
        return null
      }
      if (quiz.status !== 'completed') {
        store.remove(id)
        quiz.status = 'abandoned'
        quiz.finishedAt = this.now()
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

  private load(id: string, time = this.now()): StoredQuiz {
    const quiz = this.repository.quizStore().find(id)
    if (!quiz || quiz.status === 'deleted') throw new ApplicationError('Quiz not found.', 404)
    if (quiz.status === 'active' && quiz.deadline <= time) this.finish(quiz)
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
    })
    this.repository.quizStore().save(quiz)
  }

  private view(quiz: StoredQuiz): QuizView {
    const { keys: _keys, ...view } = structuredClone(quiz)
    view.mode = quiz.options.mode ?? 'quiz'
    view.serverNow = this.now()
    return view
  }

  /**
   * Missing causes remain unknown for older API clients.
   * @throws {ApplicationError} When pause options or their cause are invalid.
   */
  private pauseCause(input: unknown): PauseCause | null {
    if (!input || typeof input !== 'object') {
      throw new ApplicationError('Pause options must be an object.')
    }
    const cause = (input as { cause?: unknown }).cause
    if (cause === undefined) {
      return null
    }
    if (cause !== 'manual' && cause !== 'navigation') {
      throw new ApplicationError('Choose a valid pause cause: manual or navigation.')
    }
    return cause
  }

  private options(input: unknown): QuizOptions {
    if (!input || typeof input !== 'object')
      throw new ApplicationError('Quiz options are required.')
    const o = input as QuizOptions
    const scope = certificationScope(o)
    if (o.mode !== undefined && !['quiz', 'exam', 'review'].includes(o.mode)) {
      throw new ApplicationError('Choose a valid practice mode: quiz, exam or review.')
    }
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
              s.provider === scope.provider &&
              s.certification === scope.certification &&
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
          'Select at least one available source for this certification; source IDs must be unique positive integers.',
        )
      }
    }
    return {
      ...scope,
      ...(o.mode === undefined ? {} : { mode: o.mode }),
      sourceFilter: o.sourceFilter,
      questionType: o.questionType,
      ...(o.sourceIds === undefined ? {} : { sourceIds: [...o.sourceIds] }),
    }
  }
}
