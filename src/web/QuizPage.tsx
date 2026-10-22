import { DeleteResultButton, CompletedResults } from './ResultDeletion.tsx'
import { DeletedBankNotice } from './DeletedBankNotice.tsx'
import { ResultIndicator } from './ResultIndicator.tsx'
import { ConceptLabels } from './ConceptLabels.tsx'
import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  Confidence,
  PracticeMode,
  QuizAnswer,
  QuizOptions,
  QuizQuestion,
  QuizView,
} from '../shared/quiz-contracts.ts'
import type { Source } from '../shared/contracts.ts'
import { DueReviewStatus } from './DueReviewStatus.tsx'
import { PracticeActions } from './PracticeActions.tsx'
import { PracticePresets } from './PracticePresets.tsx'
import { QuizSourcePicker } from './QuizSourcePicker.tsx'
import { api } from './api.ts'
import type { Certification } from './certifications.ts'
import { AttemptTiming } from './AttemptTiming.tsx'
import { quizReport } from '../shared/quiz-report.ts'
import {
  formatTime,
  meetsPracticeTarget,
  mergeQuizPoll,
  reviewQuestionIds,
  reviewAnswerState,
  warningThreshold,
} from './quiz-state.ts'

type Stage = 'setup' | 'loading' | 'question' | 'review' | 'completed' | 'abandoned' | 'paused'

type Props = {
  certification: Certification
  mode?: PracticeMode
  onRegisterLeave: (leave: () => Promise<boolean>) => void
  onPresetChange?: (mode: 'quiz' | 'exam') => void
  initialSourceIds?: number[]
  onSourceIdsChange?: (sourceIds: number[]) => void
  focusPreset?: boolean
}

const initialOptions: QuizOptions = { sourceFilter: 'mixed', sourceIds: [], questionType: 'mixed' }

export function QuizPage({
  certification,
  mode = 'quiz',
  onRegisterLeave,
  onPresetChange,
  initialSourceIds,
  onSourceIdsChange,
  focusPreset = false,
}: Props) {
  let title = mode === 'exam' ? 'Exam' : 'Quiz'
  let plural = mode === 'exam' ? 'exams' : 'quizzes'
  if (mode === 'review') {
    title = 'Due Review'
    plural = 'due reviews'
  }
  const count = mode === 'exam' ? 65 : 20
  const [stage, setStage] = useState<Stage>('setup')
  const [options, setOptions] = useState<QuizOptions>({
    ...initialOptions,
    provider: certification.provider,
    certification: certification.code,
  })
  const scopeQuery = new URLSearchParams({
    provider: certification.provider,
    certification: certification.code,
  }).toString()
  const sourceSelection = useRef(initialSourceIds)
  const [sources, setSources] = useState<Source[]>([])
  const [sourcesLoading, setSourcesLoading] = useState(true)
  const [recoverable, setRecoverable] = useState<QuizView | null>(null)
  const [recoveryLoading, setRecoveryLoading] = useState(true)
  const [recoveryFailed, setRecoveryFailed] = useState(false)
  const [view, setView] = useState<QuizView>()
  const [questionIndex, setQuestionIndex] = useState(0)
  const [secondsLeft, setSecondsLeft] = useState(0)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [mutationBusy, setBusy] = useState(false)
  const [navigating, setNavigating] = useState(false)
  const [resumeUncertain, setResumeUncertain] = useState(false)
  const busy = mutationBusy || navigating
  const [mutationError, setMutationError] = useState(false)
  const [autoSubmitFailed, setAutoSubmitFailed] = useState(false)
  const viewRef = useRef<QuizView | undefined>(undefined)
  const busyRef = useRef(false)
  const deadlineOffset = useRef(0)
  const noticesShown = useRef(new Set<string>())
  const timerSubmit = useRef(false)
  const pendingAnswers = useRef(false)
  const pendingStart = useRef<Promise<boolean> | null>(null)
  const pendingSave = useRef<Promise<boolean> | null>(null)
  const pendingAction = useRef<Promise<unknown> | null>(null)
  const pendingLoad = useRef<Promise<unknown> | null>(null)
  const pendingRecovery = useRef<Promise<boolean> | null>(null)
  // Undefined means unknown; only a successful current-attempt read can establish null.
  const recoveredAttempt = useRef<QuizView | null | undefined>(undefined)
  const leavingRef = useRef(false)
  const uncertainStart = useRef(false)
  const uncertainResume = useRef(false)
  const viewRevision = useRef(0)

  /** Keep a waitable handle for navigation without changing the action's error contract. */
  function track<T>(reference: { current: Promise<T> | null }, operation: Promise<T>): Promise<T> {
    reference.current = operation

    const clear = () => {
      if (reference.current === operation) {
        reference.current = null
      }
    }

    void operation.then(clear, clear)
    return operation
  }

  const updateView = useCallback((next: QuizView) => {
    viewRevision.current++
    viewRef.current = next
    setView(next)
    deadlineOffset.current = next.serverNow - Date.now()
    if (next.status === 'completed') setStage('completed')
    if (next.status === 'abandoned') setStage('abandoned')
    if (next.status === 'paused') setStage('paused')
  }, [])

  /** Only a fresh server observation can settle a resume whose response was lost. */
  const acceptResumeStatus = useCallback(
    (next: QuizView) => {
      uncertainResume.current = false
      setResumeUncertain(false)
      updateView(next)
      timerSubmit.current = false
      if (next.status === 'active') setStage('question')
    },
    [updateView],
  )

  /**
   * Reconcile an uncertain resume before trusting the local paused snapshot to leave.
   * @throws {Error} If the status read fails; retain the warning and allow a later retry.
   */
  const recoverResume = useCallback(async () => {
    const current = viewRef.current
    if (uncertainResume.current && current) {
      acceptResumeStatus(await api<QuizView>(`/quizzes/${current.id}`))
    }
  }, [acceptResumeStatus])

  const saveAnswers = useCallback(
    (answers: QuizAnswer[]) =>
      track(
        pendingSave,
        (async () => {
          const current = viewRef.current
          if (!current || current.status !== 'active' || busyRef.current) return false
          busyRef.current = true
          setBusy(true)
          setError('')
          setMutationError(false)
          try {
            const next = await api<QuizView>(`/quizzes/${current.id}/answers`, {
              method: 'PUT',
              body: JSON.stringify({ answers }),
            })
            pendingAnswers.current = false
            updateView(next)
            return next.status === 'active'
          } catch (reason) {
            setError(reason instanceof Error ? reason.message : 'Could not save answers.')
            setMutationError(true)
            return false
          } finally {
            busyRef.current = false
            setBusy(false)
          }
        })(),
      ),
    [updateView, mode],
  )

  const submit = useCallback(
    (automatic = false) =>
      track(
        pendingAction,
        (async () => {
          if (leavingRef.current) {
            return false
          }
          const current = viewRef.current
          if (!current || current.status !== 'active' || busyRef.current) return false
          busyRef.current = true
          setBusy(true)
          setError('')
          setAutoSubmitFailed(false)
          try {
            const next = await api<QuizView>(`/quizzes/${current.id}/submit`, {
              method: 'POST',
              body: JSON.stringify({ answers: current.questions.map(answerPayload) }),
            })
            updateView(next)
            setStage(
              next.status === 'completed'
                ? 'completed'
                : next.status === 'abandoned'
                  ? 'abandoned'
                  : next.status === 'paused'
                    ? 'paused'
                    : 'question',
            )
            return true
          } catch (reason) {
            setError(reason instanceof Error ? reason.message : `Could not submit the ${mode}.`)
            if (automatic) setAutoSubmitFailed(true)
            return false
          } finally {
            busyRef.current = false
            setBusy(false)
          }
        })(),
      ),
    [updateView, mode],
  )

  /**
   * A lost start response may still have created a snapshot; recover before allowing leave.
   * @throws {Error} If recovery is unavailable; the caller retains the uncertain start warning.
   */
  const recoverStartedAttempt = useCallback(async () => {
    const next = await api<QuizView | null>(`/quizzes/current?mode=${mode}&${scopeQuery}`)
    uncertainStart.current = false
    if (next) {
      updateView(next)
      if (next.status === 'active') setStage('question')
    } else {
      setRecoveryLoading(true)
      setStage('setup')
    }
    return next
  }, [mode, scopeQuery, updateView])

  /** Resolve setup recovery without replacing an opened attempt or newer local edits. */
  const recoverSetup = useCallback(() => {
    if (pendingRecovery.current) {
      return pendingRecovery.current
    }
    const revision = viewRevision.current
    recoveredAttempt.current = undefined
    setRecoveryLoading(true)
    setRecoveryFailed(false)
    return track(
      pendingRecovery,
      (async () => {
        try {
          const next = await api<QuizView | null>(`/quizzes/current?mode=${mode}&${scopeQuery}`)
          if (revision === viewRevision.current) {
            recoveredAttempt.current = next
            setRecoverable(next)
            if (!viewRef.current) {
              uncertainStart.current = false
            }
          }
          return true
        } catch (reason) {
          const message =
            reason instanceof Error ? reason.message : 'Could not recover the attempt.'
          setRecoveryFailed(true)
          if (!uncertainStart.current) {
            setError(
              `${message} Retry recovery or navigation before leaving; the timer may be running.`,
            )
          }
          return false
        } finally {
          setRecoveryLoading(false)
        }
      })(),
    )
  }, [mode, scopeQuery])

  function start() {
    if (
      pendingStart.current ||
      leavingRef.current ||
      uncertainStart.current ||
      pendingRecovery.current ||
      recoveredAttempt.current === undefined
    ) {
      return
    }
    viewRevision.current++
    pendingAnswers.current = false
    setMutationError(false)
    setAutoSubmitFailed(false)
    setStage('loading')
    setError('')
    setNotice('')
    noticesShown.current.clear()
    timerSubmit.current = false
    pendingStart.current = api<QuizView>('/quizzes', {
      method: 'POST',
      body: JSON.stringify({ ...options, mode }),
    })
      .then((next) => {
        updateView(next)
        setStage(next.status === 'completed' ? 'completed' : 'question')
        setQuestionIndex(0)
        return true
      })
      .catch(async (reason) => {
        let message = reason instanceof Error ? reason.message : `Could not start a ${mode}.`
        uncertainStart.current = true
        try {
          await recoverStartedAttempt()
        } catch {
          message +=
            ' Could not check whether the attempt started. Retry navigation to recover safely.'
          setStage('setup')
        }
        setError(message)
        return false
      })
      .finally(() => {
        pendingStart.current = null
      })
  }

  function loadAttempt(id: string) {
    if (leavingRef.current) {
      return
    }
    viewRevision.current++
    return track(pendingLoad, loadSavedAttempt(id))
  }

  async function loadSavedAttempt(id: string) {
    setStage('loading')
    setError('')
    try {
      const next = await api<QuizView>(`/quizzes/${id}`)
      updateView(next)
      setQuestionIndex(
        Math.max(
          0,
          next.questions.findIndex((question) => question.selected.length < question.selectCount),
        ),
      )
      setStage(
        next.status === 'completed'
          ? 'completed'
          : next.status === 'abandoned'
            ? 'abandoned'
            : next.status === 'paused'
              ? 'paused'
              : 'question',
      )
      return true
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Could not load that result.'
      setError(`${message} Retry Continue or navigation to recover safely.`)
      setStage('setup')
      return false
    }
  }

  const abandon = useCallback(async () => {
    await pendingStart.current
    const current = viewRef.current
    if (!current || !['active', 'paused'].includes(current.status)) return true
    if (!window.confirm(`Abandon this ${mode}? Saved answers will not be graded.`)) return false
    if (busyRef.current) return false
    busyRef.current = true
    setBusy(true)
    try {
      const next = await api<QuizView | null>(`/quizzes/${current.id}/abandon`, {
        method: 'POST',
        body: '{}',
      })
      updateView(next ?? { ...current, status: 'abandoned', finishedAt: null })
      uncertainResume.current = false
      setResumeUncertain(false)
      return true
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : `Could not abandon the ${mode}.`)
      return false
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }, [updateView, mode])

  /** Navigation suspends only after all in-flight changes have settled successfully. */
  const leave = useCallback(async () => {
    if (leavingRef.current) {
      return false
    }
    leavingRef.current = true
    setNavigating(true)
    const starting = pendingStart.current
    const loading = pendingLoad.current
    const action = pendingAction.current
    const saving = pendingSave.current
    try {
      if ((await starting) === false) {
        return false
      }
      if ((await loading) === false) {
        return false
      }
      if ((await action) === false) {
        return false
      }
      if (uncertainStart.current) {
        await recoverStartedAttempt()
      }
      await recoverResume()
      const saved = await saving
      if (saved === false && viewRef.current?.status === 'active') {
        return false
      }
      const opened = viewRef.current
      if (!opened || !['active', 'paused'].includes(opened.status)) {
        if ((await pendingRecovery.current) === false) {
          return false
        }
        if (recoveredAttempt.current === undefined && !(await recoverSetup())) {
          return false
        }
        if (recoveredAttempt.current && recoveredAttempt.current.id !== opened?.id) {
          updateView(recoveredAttempt.current)
          if (recoveredAttempt.current.status === 'active') {
            setStage('question')
          }
        }
      }
      const current = viewRef.current
      if (!current || current.status !== 'active') {
        return true
      }
      const flushed = await saveAnswers(current.questions.map(answerPayload))
      // An expiry or a previously accepted pause may be discovered by the save response.
      if (viewRef.current?.status !== 'active') {
        return true
      }
      if (!flushed) {
        return false
      }
      const next = await api<QuizView>(`/quizzes/${current.id}/pause`, {
        method: 'POST',
        body: JSON.stringify({ cause: 'navigation' }),
      })
      updateView(next)
      return next.status !== 'active'
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Could not suspend the attempt.'
      setError(`${message} Your attempt is still open. Retry navigation to suspend it safely.`)
      return false
    } finally {
      leavingRef.current = false
      setNavigating(false)
    }
  }, [recoverStartedAttempt, recoverResume, recoverSetup, saveAnswers, updateView])

  /** Save pending choices before freezing the server timer; failed saves keep the attempt open. */
  function changePause(action: 'pause' | 'resume') {
    if (leavingRef.current) {
      return
    }
    return track(pendingAction, performPauseChange(action))
  }

  async function performPauseChange(action: 'pause' | 'resume') {
    const current = viewRef.current
    if (!current || busyRef.current) return false
    if (action === 'pause' && !(await saveAnswers(current.questions.map(answerPayload)))) {
      return viewRef.current?.status !== 'active'
    }
    busyRef.current = true
    // Invalidate polls begun before this mutation, including an uncertain resume.
    viewRevision.current++
    setBusy(true)
    setError('')
    try {
      const next = await api<QuizView>(`/quizzes/${current.id}/${action}`, {
        method: 'POST',
        body: JSON.stringify(action === 'pause' ? { cause: 'manual' } : {}),
      })
      if (action === 'resume') {
        acceptResumeStatus(next)
      } else {
        updateView(next)
      }
      timerSubmit.current = false
      if (next.status === 'active') setStage('question')
      return true
    } catch (reason) {
      let message = reason instanceof Error ? reason.message : `Could not ${action} the ${mode}.`
      if (action === 'resume') {
        uncertainResume.current = true
        setResumeUncertain(true)
        try {
          await recoverResume()
        } catch {
          message += ' Could not check the attempt status. The timer may still be running.'
        }
      }
      setError(message)
      return false
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  useEffect(() => {
    onRegisterLeave(leave)
    return () => onRegisterLeave(async () => true)
  }, [leave, onRegisterLeave])

  useEffect(() => {
    let cancelled = false
    api<Source[]>('/sources')
      .then((items) => {
        if (cancelled) return
        const eligible = items.filter(
          (source) =>
            source.provider === certification.provider &&
            source.certification === certification.code &&
            ['official', 'third_party'].includes(source.kind) &&
            source.questionCount > 0,
        )
        setSources(eligible)
        const sourceIds = eligible
          .filter((source) => sourceSelection.current?.includes(source.id) ?? true)
          .map((source) => source.id)
        setOptions((current) => ({ ...current, sourceIds }))
      })
      .catch((reason) => {
        if (!cancelled)
          setError(reason instanceof Error ? reason.message : 'Could not load question banks.')
      })
      .finally(() => {
        if (!cancelled) setSourcesLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [certification.provider, certification.code])

  useEffect(() => {
    if (stage !== 'setup') return
    let cancelled = false
    void recoverSetup().then((recovered) => {
      // Returning from results may reuse a read invalidated when those results opened.
      if (!cancelled && recovered && recoveredAttempt.current === undefined) {
        void recoverSetup()
      }
    })
    return () => {
      cancelled = true
    }
  }, [stage, plural, recoverSetup, scopeQuery])

  useEffect(() => {
    if (!notice) return
    const timeout = window.setTimeout(() => setNotice(''), 30_000)
    return () => window.clearTimeout(timeout)
  }, [notice])

  useEffect(() => {
    if ((stage !== 'question' && stage !== 'review') || !view || view.status !== 'active') return

    const tick = () => {
      const remain = Math.max(
        0,
        Math.ceil((view.deadline - (Date.now() + deadlineOffset.current)) / 1000),
      )
      setSecondsLeft(remain)
      const threshold = warningThreshold(remain * 1000)
      if (threshold && !noticesShown.current.has(threshold)) {
        noticesShown.current.add(threshold)
        setNotice(threshold === '10-minute' ? '10 min remaining' : '2 min remaining')
      }
      if (remain === 0 && !timerSubmit.current && !busyRef.current && !leavingRef.current) {
        timerSubmit.current = true
        void submit(true)
      }
    }

    tick()
    const interval = window.setInterval(tick, 1000)
    return () => window.clearInterval(interval)
  }, [stage, view, submit])

  useEffect(() => {
    if (!view || !['active', 'paused'].includes(view.status)) return
    let cancelled = false

    const poll = async () => {
      if (busyRef.current || leavingRef.current) return
      const revision = viewRevision.current
      try {
        const next = await api<QuizView>(`/quizzes/${view.id}`)
        if (
          cancelled ||
          revision !== viewRevision.current ||
          busyRef.current ||
          leavingRef.current ||
          (pendingAnswers.current && next.status === 'active')
        )
          return
        if (uncertainResume.current) {
          acceptResumeStatus(next)
          return
        }
        const current = viewRef.current
        const merged = current ? mergeQuizPoll(current, next) : next
        if (merged !== current) updateView(merged)
      } catch (reason) {
        if (!cancelled)
          setError(reason instanceof Error ? reason.message : `Could not refresh ${mode} status.`)
      }
    }

    const interval = window.setInterval(() => {
      void poll()
    }, 5000)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [stage, view?.id, view?.status, updateView, acceptResumeStatus, mode])

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (
        !pendingStart.current &&
        !uncertainStart.current &&
        !uncertainResume.current &&
        !busyRef.current &&
        viewRef.current?.status !== 'active'
      )
        return
      event.preventDefault()
      event.returnValue = ''
    }

    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [])

  const questions = view?.questions ?? []
  const currentQuestion = questions[questionIndex]

  function changeAnswer(question: QuizQuestion, patch: Partial<QuizAnswer>) {
    if (!view || busy || leavingRef.current || secondsLeft === 0 || view.status !== 'active') return
    const updatedQuestions = view.questions.map((item) =>
      item.questionId === question.questionId ? { ...item, ...patch } : item,
    )
    const next = { ...view, questions: updatedQuestions }
    pendingAnswers.current = true
    viewRef.current = next
    setView(next)
    void saveAnswers(updatedQuestions.map(answerPayload))
  }

  let timerIndicatorLabel = 'More than 10 minutes remaining'
  if (secondsLeft <= 120) {
    timerIndicatorLabel = '2 minutes or less remaining'
  } else if (secondsLeft <= 600) {
    timerIndicatorLabel = '10 minutes or less remaining'
  }

  const reviewIds = reviewQuestionIds(questions)
  let heading = title
  if (stage === 'completed' && view) {
    const resultMode = view.options.mode ?? 'quiz'
    const resultTitle = resultMode === 'exam' ? 'Exam' : 'Quiz'
    heading = resultMode === 'review' ? 'Due Review results' : `${resultTitle} results`
  } else if (mode !== 'review' && onPresetChange) {
    heading = 'Practice'
  }

  return (
    <main
      className={`quiz-page ${stage === 'question' || stage === 'review' || stage === 'paused' ? 'practice-session' : ''}`}
    >
      {stage !== 'question' && stage !== 'review' && stage !== 'paused' && (
        <div className="page-heading practice-heading">
          <p className="eyebrow">TIMED STUDY SESSION</p>
          <div className="practice-title-row">
            <h1>{heading}</h1>
            <p className="practice-certification">
              {certification.provider} · {certification.name} · {certification.code}
            </p>
          </div>
          {mode === 'review' && (
            <p className="intro">Up to 20 due questions · 20 minutes · no quiz/exam pass target</p>
          )}
        </div>
      )}
      {error && (
        <div className="message error" role="alert">
          <strong>Couldn’t complete that action</strong>
          <pre>{error}</pre>
          {recoveryFailed && (
            <button disabled={busy || recoveryLoading} onClick={() => void recoverSetup()}>
              Retry recovery
            </button>
          )}
          {(mutationError || autoSubmitFailed) && (
            <button
              onClick={() =>
                autoSubmitFailed
                  ? void submit(true)
                  : view && void saveAnswers(view.questions.map(answerPayload))
              }
            >
              {autoSubmitFailed ? 'Retry submission' : 'Retry answer save'}
            </button>
          )}
        </div>
      )}
      {(stage === 'question' || stage === 'review') && view && (
        <>
          <div className="quiz-status">
            <span className="practice-progress">
              {stage === 'review'
                ? 'Review before submitting'
                : `Question ${questionIndex + 1} of ${questions.length}`}
            </span>
            <span className="answer-save-status" role="status">
              {busy ? 'Saving…' : pendingAnswers.current ? 'Unsaved changes' : 'Saved'}
            </span>
            <span
              className={`timer-warning ${secondsLeft <= 120 ? 'urgent' : 'warning'} ${notice ? '' : 'pending'}`}
              role="status"
              aria-live="polite"
              aria-atomic="true"
            >
              {notice || '\u00a0'}
            </span>
            <strong
              className={`timer ${secondsLeft <= 600 ? 'warning' : ''} ${secondsLeft <= 120 ? 'urgent' : ''}`}
            >
              <span
                className="timer-indicator"
                role="img"
                aria-label={timerIndicatorLabel}
                title={timerIndicatorLabel}
              />
              <span className="sr-only">Time remaining: </span>
              {formatTime(secondsLeft)}
            </strong>
            <button disabled={busy || secondsLeft === 0} onClick={() => void changePause('pause')}>
              Pause
            </button>
            <PracticeActions
              mode={mode}
              disabled={busy || secondsLeft === 0}
              onReview={() => setStage('review')}
              onSubmit={() => {
                if (
                  window.confirm(
                    'Submit and score your saved answers? Unanswered questions count as incorrect.',
                  )
                )
                  void submit()
              }}
              onAbandon={() => void abandon()}
            />
          </div>
          {pendingAnswers.current && mutationError && (
            <p role="alert">
              Your last changes are not saved. Retry before the timer expires; automatic scoring
              uses saved answers.
            </p>
          )}
        </>
      )}
      {stage === 'setup' && (
        <>
          {mode === 'review' && <DueReviewStatus key={stage} options={options} />}
          <section className="quiz-panel practice-setup">
            <h2>Set up your {mode === 'review' ? 'review' : 'quiz'}</h2>
            {mode !== 'review' && onPresetChange && (
              <PracticePresets
                mode={mode}
                disabled={busy}
                onChange={onPresetChange}
                autoFocus={focusPreset}
              />
            )}
            {recoverable && (
              <section className="quiz-panel recovery-panel">
                <h2>
                  {recoverable.status === 'paused' && (
                    <ResultIndicator
                      status="paused"
                      correctCount={null}
                      total={recoverable.total}
                    />
                  )}
                  {recoverable.status === 'paused' ? 'Paused' : 'In-progress'} {mode}
                </h2>
                <p>
                  Your saved answers are ready.{' '}
                  {recoverable.status === 'paused'
                    ? 'The timer is stopped.'
                    : 'The timer is still running.'}
                </p>
                <button
                  className="primary"
                  disabled={busy || recoveryLoading || recoveryFailed}
                  onClick={() => void loadAttempt(recoverable.id)}
                >
                  Continue {mode}
                </button>
              </section>
            )}
            {!recoverable && (
              <>
                <p>Choose the question banks for this {mode}.</p>
                {(certification.provider !== 'AWS' || certification.code !== 'CLF-C02') &&
                  mode !== 'review' && (
                    <p className="muted">
                      These are timed practice presets, not this certification’s official exam
                      format. Questions are sampled without exam-domain weighting.
                    </p>
                  )}
                {sourcesLoading ? (
                  <p role="status">Loading question banks…</p>
                ) : (
                  <QuizSourcePicker
                    sources={sources}
                    selected={options.sourceIds ?? []}
                    onChange={(sourceIds) => {
                      setOptions((current) => ({ ...current, sourceIds }))
                      onSourceIdsChange?.(sourceIds)
                    }}
                  />
                )}
                <button
                  className="primary"
                  disabled={
                    sourcesLoading ||
                    recoveryLoading ||
                    recoveredAttempt.current === undefined ||
                    recoveryFailed ||
                    uncertainStart.current ||
                    !options.sourceIds?.length
                  }
                  onClick={() => void start()}
                >
                  {mode === 'review'
                    ? 'Start Due Review (up to 20 questions)'
                    : `Start ${count}-question ${mode}`}
                </button>
              </>
            )}
          </section>
          <CompletedResults
            certification={certification}
            mode={mode}
            onOpen={(id) => void loadAttempt(id)}
          />
        </>
      )}
      {stage === 'loading' && (
        <div className="empty-state" role="status">
          Loading {mode}…
        </div>
      )}
      {stage === 'question' && view && currentQuestion && (
        <>
          {view.status !== 'active' && (
            <div className="message warning" role="alert">
              This {mode} is no longer active.
            </div>
          )}
          <QuestionEditor
            question={currentQuestion}
            disabled={busy || secondsLeft === 0 || view.status !== 'active'}
            onChange={(patch) => changeAnswer(currentQuestion, patch)}
          />
          <div className="quiz-actions question-navigation">
            <button
              disabled={busy || questionIndex === 0}
              onClick={() => setQuestionIndex((i) => i - 1)}
            >
              Previous question
            </button>
            <button
              disabled={busy}
              onClick={() => {
                if (questionIndex === questions.length - 1) {
                  setStage('review')
                } else {
                  setQuestionIndex((i) => i + 1)
                }
              }}
            >
              {questionIndex === questions.length - 1 ? 'Review answers' : 'Next question'}
            </button>
          </div>
        </>
      )}
      {stage === 'review' && view && (
        <>
          <section className="quiz-panel">
            <h2>Answer review</h2>
            <p>Select a question to return to it.</p>
            <ul className="review-legend" aria-label="Answer completion colors">
              <li>
                <span className="review-legend-swatch review-unanswered" aria-hidden="true" />
                Unanswered
              </li>
              <li>
                <span className="review-legend-swatch review-partial" aria-hidden="true" />
                Partially answered
              </li>
              <li>
                <span className="review-legend-swatch review-answered" aria-hidden="true" />
                Fully answered
              </li>
            </ul>
            <ul className="review-list">
              {questions.map((question, index) => (
                <li key={question.questionId} className={`review-${reviewAnswerState(question)}`}>
                  <button
                    className="review-tile"
                    aria-label={`Question ${index + 1}, ${question.selected.length} of ${question.selectCount} answers selected, ${question.confidence ?? 'Not Recorded'}${question.flagged ? ', marked for review' : ''}`}
                    onClick={() => {
                      setQuestionIndex(index)
                      setStage('question')
                    }}
                  >
                    <span className="review-tile-heading">
                      <span className="review-number">{index + 1}.</span>{' '}
                      <span className="review-confidence">
                        {question.confidence ?? 'Not Recorded'}
                      </span>
                    </span>
                    <span className="review-tile-mark">
                      {question.flagged && (
                        <span
                          className="review-flag"
                          role="img"
                          aria-label="Marked for review"
                          title="Marked for review"
                        >
                          ⚑
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <p>
              {reviewIds.length} question{reviewIds.length === 1 ? '' : 's'} flagged for review.
            </p>
            <div className="quiz-actions">
              <button
                onClick={() => {
                  setQuestionIndex(0)
                  setStage('question')
                }}
              >
                Return to {mode}
              </button>
              <button
                className="primary"
                disabled={busy || view.status !== 'active' || secondsLeft === 0}
                onClick={() => void submit()}
              >
                Submit and score
              </button>
            </div>
          </section>
        </>
      )}
      {resumeUncertain && (
        <section className="quiz-panel resume-uncertain" role="alert">
          <h1>Attempt status unconfirmed</h1>
          <p>
            The timer may still be running. Retry resume to continue, or retry navigation to suspend
            the attempt safely.
          </p>
          <button disabled={busy} onClick={() => void changePause('resume')}>
            Retry resume
          </button>
          <button className="danger" disabled={busy} onClick={() => void abandon()}>
            Abandon {mode}
          </button>
        </section>
      )}
      {stage === 'paused' && view && !resumeUncertain && (
        <section className="quiz-panel paused-panel">
          <p className="eyebrow">{title} paused</p>
          <h1>{formatTime(Math.max(0, Math.ceil((view.deadline - view.pausedAt!) / 1000)))}</h1>
          <p>
            Time remaining · Your answers are saved. Paused time does not affect your study stats.
          </p>
          <AttemptTiming quiz={view} />
          <div className="quiz-actions">
            <button className="primary" disabled={busy} onClick={() => void changePause('resume')}>
              Resume {mode}
            </button>
            <button className="danger" disabled={busy} onClick={() => void abandon()}>
              Abandon {mode}
            </button>
          </div>
        </section>
      )}
      {stage === 'completed' && view && (
        <Result
          view={view}
          onBack={() => {
            setView(undefined)
            viewRef.current = undefined
            setStage('setup')
          }}
        />
      )}
      {stage === 'abandoned' && (
        <section className="quiz-panel">
          <h2>{title} abandoned</h2>
          <p>This attempt is closed and cannot be resumed.</p>
          <button
            className="primary"
            onClick={() => {
              setView(undefined)
              viewRef.current = undefined
              setStage('setup')
            }}
          >
            Back to {mode} setup
          </button>
        </section>
      )}
    </main>
  )
}

function answerPayload(question: QuizQuestion): QuizAnswer {
  return {
    questionId: question.questionId,
    selected: question.selected,
    confidence: question.confidence,
    flagged: question.flagged,
  }
}

function QuestionEditor({
  question,
  disabled,
  onChange,
}: {
  question: QuizQuestion
  disabled: boolean
  onChange: (patch: Partial<QuizAnswer>) => void
}) {
  const multiple = question.type === 'multi_select'

  function toggle(id: number) {
    let selected: number[]
    if (question.selected.includes(id)) selected = question.selected.filter((value) => value !== id)
    else if (!multiple) selected = [id]
    else if (question.selected.length < question.selectCount) selected = [...question.selected, id]
    else return
    onChange({ selected })
  }

  return (
    <article className="quiz-panel quiz-question">
      <div className="question-meta">
        <span>{question.domain ? `Domain ${question.domain}` : 'Domain not mapped'}</span>
        <span>
          {question.sourceName} · {question.sourceKind === 'official' ? 'Official' : 'Third-party'}
        </span>
      </div>
      <h2>{question.question}</h2>
      <ConceptLabels question={question} />
      <p className="selection-instruction">
        <strong>{multiple ? `Select ${question.selectCount} answers` : 'Select one answer'}</strong>
      </p>
      <fieldset className="answer-choices" disabled={disabled}>
        <legend className="sr-only">Answer choices</legend>
        {question.answers.map((answer, index) => (
          <label className="choice" key={answer.id}>
            <input
              type={multiple ? 'checkbox' : 'radio'}
              name={`question-${question.questionId}`}
              checked={question.selected.includes(answer.id)}
              onChange={() => toggle(answer.id)}
            />
            <span className="choice-letter">{String.fromCharCode(65 + index)}</span>
            <span>{answer.text}</span>
          </label>
        ))}
      </fieldset>
      <div className="confidence-row">
        <fieldset disabled={disabled}>
          <legend>Confidence</legend>
          {(['Confident', 'Educated Guess', 'Unsure'] as Confidence[]).map((value) => (
            <label key={value}>
              <input
                type="radio"
                name={`confidence-${question.questionId}`}
                checked={question.confidence === value}
                onChange={() => onChange({ confidence: value })}
              />{' '}
              {value}
            </label>
          ))}
          <button
            className="confidence-clear"
            type="button"
            disabled={disabled || question.confidence === null}
            onClick={() => onChange({ confidence: null })}
          >
            Clear
          </button>
        </fieldset>
        <label className="flag-control">
          <input
            type="checkbox"
            disabled={disabled}
            checked={question.flagged}
            onChange={(event) => onChange({ flagged: event.target.checked })}
          />{' '}
          Mark for Review
        </label>
      </div>
    </article>
  )
}

function Result({ view, onBack }: { view: QuizView; onBack: () => void }) {
  const mode = view.options.mode ?? 'quiz'
  const correct = view.questions.filter((question) => question.correct).length
  const percent = view.questions.length ? (correct / view.questions.length) * 100 : null
  const answered = view.questions.filter((question) => question.selected.length > 0).length
  const passed = percent !== null && meetsPracticeTarget(percent)
  const review = view.questions
  const [copyNotice, setCopyNotice] = useState('')

  function downloadReport() {
    const url = URL.createObjectURL(
      new Blob([quizReport(view)], { type: 'text/markdown;charset=utf-8' }),
    )
    const link = document.createElement('a')
    link.href = url
    link.download = `${mode}-${view.id}.md`
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  async function copyReport() {
    try {
      await navigator.clipboard.writeText(quizReport(view))
      setCopyNotice('Report copied.')
    } catch {
      setCopyNotice('Copy unavailable. Download the report instead.')
    }
  }

  return (
    <>
      <DeleteResultButton id={view.id} onDeleted={onBack} />
      <DeletedBankNotice names={view.deletedBankNames} />
      <section className="quiz-panel result-score">
        <p className="eyebrow">{mode.toUpperCase()} COMPLETE</p>
        <h2>
          {correct} of {view.questions.length}
        </h2>
        <p>Score: {percent === null ? '—' : `${Math.round(percent)}%`} · skips count as misses</p>
        {mode !== 'review' && (
          <>
            <p className={passed ? 'correct-text' : 'incorrect-text'}>
              <strong>Practice target (80%): {passed ? 'Pass' : 'Fail'}</strong>
            </p>
            <p>This is a practice target, not an official certification score.</p>
          </>
        )}
        {mode === 'review' && (
          <p>Due Review · no quiz/exam pass target. Only correct + Confident passes a due check.</p>
        )}
        <AttemptTiming quiz={view} />
        <div className="quiz-actions">
          <button onClick={onBack}>
            Back to {mode === 'review' ? 'review' : 'practice'} history
          </button>
          <button onClick={() => void copyReport()}>Copy discussion report</button>
          <button onClick={downloadReport}>Download report</button>
        </div>
        <p role="status">{copyNotice}</p>
      </section>
      <section className="quiz-panel">
        <h2>All answers and confidence</h2>
        <p>
          Accuracy on answered questions:{' '}
          {answered ? `${Math.round((correct / answered) * 100)}%` : '—'} · {answered} answered ·{' '}
          {view.questions.length - answered} skipped
        </p>
        {review.length === 0 && <p>All answers are correct and marked confident.</p>}
        {review.map((question) => (
          <article className="result-question" key={question.questionId}>
            <h3>{question.question}</h3>
            <p className={question.correct ? 'correct-text' : 'incorrect-text'}>
              {question.correct ? 'Correct' : 'Incorrect'} ·{' '}
              {question.confidence ?? 'Confidence not recorded'}
              {question.confidence !== 'Confident' ? ' · Review' : ''}
              {question.flagged ? ' · Marked for review' : ''}
            </p>
            <p className="muted">
              {question.sourceName} · {question.reference} ·{' '}
              {question.domain ? `Domain ${question.domain}` : 'Domain not mapped'}
              {question.area ? ` · ${question.area}` : ''}
              {question.topic ? ` · ${question.topic}` : ''}
            </p>
            <ConceptLabels question={question} />
            <ul>
              {question.answers.map((answer) => {
                const selected = question.selected.includes(answer.id)
                const isCorrect = question.correctAnswerIds?.includes(answer.id)
                return (
                  <li
                    key={answer.id}
                    className={isCorrect ? 'result-correct' : selected ? 'result-selected' : ''}
                  >
                    {answer.text}
                    {selected ? ' · Your choice' : ''}
                    {isCorrect ? ' · Correct answer' : ''}
                  </li>
                )
              })}
            </ul>
          </article>
        ))}
      </section>
    </>
  )
}
