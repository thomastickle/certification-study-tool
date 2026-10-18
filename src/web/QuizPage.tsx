import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  Confidence,
  QuizAnswer,
  QuizOptions,
  QuizQuestion,
  QuizSummary,
  QuizView,
} from '../shared/quiz-contracts.ts'
import type { Source } from '../shared/contracts.ts'
import { QuizSourcePicker } from './QuizSourcePicker.tsx'
import { api } from './api.ts'
import { quizReport } from '../shared/quiz-report.ts'
import {
  meetsPracticeTarget,
  mergeQuizPoll,
  reviewQuestionIds,
  warningThreshold,
} from './quiz-state.ts'

type Stage = 'setup' | 'loading' | 'question' | 'review' | 'completed' | 'abandoned'

type Props = { onRegisterLeave: (leave: () => Promise<boolean>) => void }

const initialOptions: QuizOptions = { sourceFilter: 'mixed', sourceIds: [], questionType: 'mixed' }

export function QuizPage({ onRegisterLeave }: Props) {
  const [stage, setStage] = useState<Stage>('setup')
  const [options, setOptions] = useState(initialOptions)
  const [sources, setSources] = useState<Source[]>([])
  const [sourcesLoading, setSourcesLoading] = useState(true)
  const [view, setView] = useState<QuizView>()
  const [summaries, setSummaries] = useState<QuizSummary[]>([])
  const [questionIndex, setQuestionIndex] = useState(0)
  const [secondsLeft, setSecondsLeft] = useState(0)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [mutationError, setMutationError] = useState(false)
  const [autoSubmitFailed, setAutoSubmitFailed] = useState(false)
  const viewRef = useRef<QuizView | undefined>(undefined)
  const busyRef = useRef(false)
  const deadlineOffset = useRef(0)
  const noticesShown = useRef(new Set<string>())
  const timerSubmit = useRef(false)
  const pendingAnswers = useRef(false)

  const updateView = useCallback((next: QuizView) => {
    viewRef.current = next
    setView(next)
    deadlineOffset.current = next.serverNow - Date.now()
    if (next.status === 'completed') setStage('completed')
    if (next.status === 'abandoned') setStage('abandoned')
  }, [])
  const saveAnswers = useCallback(
    async (answers: QuizAnswer[]) => {
      const current = viewRef.current
      if (!current || current.status !== 'active' || busyRef.current) return
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
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'Could not save answers.')
        setMutationError(true)
      } finally {
        busyRef.current = false
        setBusy(false)
      }
    },
    [updateView],
  )

  const submit = useCallback(
    async (automatic = false) => {
      const current = viewRef.current
      if (!current || current.status !== 'active' || busyRef.current) return
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
              : 'question',
        )
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'Could not submit the quiz.')
        if (automatic) setAutoSubmitFailed(true)
      } finally {
        busyRef.current = false
        setBusy(false)
      }
    },
    [updateView],
  )

  async function start() {
    pendingAnswers.current = false
    setMutationError(false)
    setAutoSubmitFailed(false)
    setStage('loading')
    setError('')
    setNotice('')
    noticesShown.current.clear()
    timerSubmit.current = false
    try {
      const next = await api<QuizView>('/quizzes', {
        method: 'POST',
        body: JSON.stringify(options),
      })
      updateView(next)
      setStage(next.status === 'completed' ? 'completed' : 'question')
      setQuestionIndex(0)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not start a quiz.')
      setStage('setup')
    }
  }

  async function loadCompleted(id: string) {
    setStage('loading')
    setError('')
    try {
      const next = await api<QuizView>(`/quizzes/${id}`)
      updateView(next)
      setStage(
        next.status === 'completed'
          ? 'completed'
          : next.status === 'abandoned'
            ? 'abandoned'
            : 'setup',
      )
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load that result.')
      setStage('setup')
    }
  }

  const leave = useCallback(async () => {
    const current = viewRef.current
    if (!current || current.status !== 'active') return true
    if (!window.confirm('Leave this active quiz? It will be abandoned and cannot be resumed.'))
      return false
    if (busyRef.current) {
      window.alert('Please wait for the current answer save to finish, then try leaving again.')
      return false
    }
    busyRef.current = true
    setBusy(true)
    try {
      const next = await api<QuizView>(`/quizzes/${current.id}/abandon`, {
        method: 'POST',
        body: '{}',
      })
      updateView(next)
      setStage('abandoned')
      return true
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not abandon the quiz.')
      return false
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }, [updateView])
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
            source.provider === 'AWS' &&
            source.certification === 'CLF-C02' &&
            ['official', 'third_party'].includes(source.kind) &&
            source.questionCount > 0,
        )
        setSources(eligible)
        setOptions((current) => ({ ...current, sourceIds: eligible.map((source) => source.id) }))
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
  }, [])

  useEffect(() => {
    if (stage !== 'setup') return
    let cancelled = false
    api<QuizSummary[]>('/quizzes')
      .then((items) => {
        if (!cancelled) setSummaries(items.filter((item) => item.status === 'completed'))
      })
      .catch((reason) => {
        if (!cancelled)
          setError(reason instanceof Error ? reason.message : 'Could not load completed quizzes.')
      })
    return () => {
      cancelled = true
    }
  }, [stage])

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
        setNotice(
          threshold === '10-minute'
            ? '10 minutes remaining. Keep an eye on the timer.'
            : '2 minutes remaining. Review and submit your answers.',
        )
      }
      if (remain === 0 && !timerSubmit.current && !busyRef.current) {
        timerSubmit.current = true
        void submit(true)
      }
    }

    tick()
    const interval = window.setInterval(tick, 1000)
    return () => window.clearInterval(interval)
  }, [stage, view, submit])

  useEffect(() => {
    if ((stage !== 'question' && stage !== 'review') || !view || view.status !== 'active') return
    let cancelled = false

    const poll = async () => {
      if (busyRef.current) return
      try {
        const next = await api<QuizView>(`/quizzes/${view.id}`)
        if (cancelled || busyRef.current || (pendingAnswers.current && next.status === 'active'))
          return
        const current = viewRef.current
        const merged = current ? mergeQuizPoll(current, next) : next
        if (merged !== current) updateView(merged)
        if (next.status !== 'active')
          setStage(next.status === 'completed' ? 'completed' : 'abandoned')
      } catch (reason) {
        if (!cancelled)
          setError(reason instanceof Error ? reason.message : 'Could not refresh quiz status.')
      }
    }

    const interval = window.setInterval(() => {
      void poll()
    }, 5000)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [stage, view?.id, view?.status, updateView])

  useEffect(() => {
    if ((stage !== 'question' && stage !== 'review') || view?.status !== 'active') return

    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }

    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [stage, view?.status])

  const questions = view?.questions ?? []
  const currentQuestion = questions[questionIndex]

  function changeAnswer(question: QuizQuestion, patch: Partial<QuizAnswer>) {
    if (!view || busy || secondsLeft === 0 || view.status !== 'active') return
    const updatedQuestions = view.questions.map((item) =>
      item.questionId === question.questionId ? { ...item, ...patch } : item,
    )
    const next = { ...view, questions: updatedQuestions }
    pendingAnswers.current = true
    viewRef.current = next
    setView(next)
    void saveAnswers(updatedQuestions.map(answerPayload))
  }

  const reviewIds = reviewQuestionIds(questions)

  return (
    <main className="quiz-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">TIMED STUDY SESSION</p>
          <h1>
            {stage === 'completed'
              ? 'Quiz results'
              : stage === 'review'
                ? 'Review your answers'
                : 'Quiz'}
          </h1>
          <p className="intro">20 questions · 20 minutes · 80% practice target</p>
        </div>
      </div>
      {error && (
        <div className="message error" role="alert">
          <strong>Couldn’t complete that action</strong>
          <pre>{error}</pre>
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
            <span>
              {stage === 'review'
                ? 'Review before submitting'
                : `Question ${questionIndex + 1} of ${questions.length}`}
            </span>
            <strong
              className={secondsLeft <= 120 ? 'timer urgent' : 'timer'}
              aria-label="Time remaining"
            >
              {formatTime(secondsLeft)}
            </strong>
            {stage === 'question' && (
              <button onClick={() => setStage('review')}>Review answers</button>
            )}
          </div>
          {notice && (
            <div className="message warning" role="status" aria-live="polite">
              {notice}
            </div>
          )}
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
          <section className="quiz-panel">
            <h2>Set up your quiz</h2>
            <p>Choose the question banks and answer format for this quiz.</p>
            {sourcesLoading ? (
              <p role="status">Loading question banks…</p>
            ) : (
              <QuizSourcePicker
                sources={sources}
                selected={options.sourceIds ?? []}
                onChange={(sourceIds) => setOptions((current) => ({ ...current, sourceIds }))}
              />
            )}
            <div className="option-grid">
              <label>
                Question format
                <select
                  value={options.questionType}
                  onChange={(e) =>
                    setOptions({
                      ...options,
                      questionType: e.target.value as QuizOptions['questionType'],
                    })
                  }
                >
                  <option value="mixed">Mixed formats</option>
                  <option value="single_select">Single answer</option>
                  <option value="multi_select">Multiple answers</option>
                </select>
              </label>
            </div>
            <button
              className="primary"
              disabled={sourcesLoading || !options.sourceIds?.length}
              onClick={() => void start()}
            >
              Start 20-question quiz
            </button>
          </section>
          <section className="quiz-panel">
            <div className="section-heading">
              <h2>Completed quizzes</h2>
              <button
                onClick={() => {
                  void api<QuizSummary[]>('/quizzes')
                    .then(setSummaries)
                    .catch((reason) => setError(String(reason.message)))
                }}
              >
                Refresh results
              </button>
            </div>
            {summaries.length === 0 ? (
              <p className="muted">Load your completed quiz history.</p>
            ) : (
              <ul className="history-list">
                {summaries
                  .filter((item) => item.status === 'completed')
                  .map((item) => (
                    <li key={item.id}>
                      <span>
                        {new Date(item.finishedAt ?? item.startedAt).toLocaleString()} ·{' '}
                        {item.correctCount ?? 0}/{item.total}
                      </span>
                      <button onClick={() => void loadCompleted(item.id)}>Review results</button>
                    </li>
                  ))}
              </ul>
            )}
          </section>
        </>
      )}
      {stage === 'loading' && (
        <div className="empty-state" role="status">
          Loading quiz…
        </div>
      )}
      {stage === 'question' && view && currentQuestion && (
        <>
          {view.status !== 'active' && (
            <div className="message warning" role="alert">
              This quiz is no longer active.
            </div>
          )}
          <QuestionEditor
            question={currentQuestion}
            disabled={busy || secondsLeft === 0 || view.status !== 'active'}
            onChange={(patch) => changeAnswer(currentQuestion, patch)}
          />
          {busy && (
            <p className="muted" role="status">
              Saving answer…
            </p>
          )}
          <div className="quiz-actions">
            <button disabled={questionIndex === 0} onClick={() => setQuestionIndex((i) => i - 1)}>
              Previous question
            </button>
            <button
              disabled={questionIndex === questions.length - 1}
              onClick={() => setQuestionIndex((i) => i + 1)}
            >
              Next question
            </button>
            <button className="danger" disabled={busy} onClick={() => void leave()}>
              Abandon quiz
            </button>
          </div>
        </>
      )}
      {stage === 'review' && view && (
        <>
          <section className="quiz-panel">
            <h2>Answer review</h2>
            <p>Select a question number to return to it. Marked items need attention:</p>
            <ul className="review-list">
              {questions.map((question, index) => (
                <li key={question.questionId}>
                  <button
                    onClick={() => {
                      setQuestionIndex(index)
                      setStage('question')
                    }}
                  >
                    Question {index + 1}
                  </button>
                  <span>
                    {question.selected.length === 0 ? 'Unanswered · ' : ''}
                    {question.flagged ? 'Flagged · ' : ''}
                    {question.confidence ?? 'Confidence not recorded'}
                    {question.confidence && question.confidence !== 'Confident' ? ' · Review' : ''}
                  </span>
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
                Return to quiz
              </button>
              <button
                className="primary"
                disabled={busy || view.status !== 'active' || secondsLeft === 0}
                onClick={() => void submit()}
              >
                Submit and score
              </button>
              <button className="danger" disabled={busy} onClick={() => void leave()}>
                Abandon quiz
              </button>
            </div>
          </section>
        </>
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
          <h2>Quiz abandoned</h2>
          <p>This attempt is closed and cannot be resumed.</p>
          <button
            className="primary"
            onClick={() => {
              setView(undefined)
              viewRef.current = undefined
              setStage('setup')
            }}
          >
            Back to quiz setup
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

function formatTime(seconds: number) {
  return `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`
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
        <span>Domain {question.domain}</span>
        <span>
          {question.sourceName} · {question.sourceKind === 'official' ? 'Official' : 'Third-party'}
        </span>
      </div>
      <h2>{question.question}</h2>
      <p className="muted">
        {multiple ? `Select ${question.selectCount} answers` : 'Select one answer'}
      </p>
      <fieldset disabled={disabled}>
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
          Mark for return
        </label>
      </div>
    </article>
  )
}

function Result({ view, onBack }: { view: QuizView; onBack: () => void }) {
  const correct = view.questions.filter((question) => question.correct).length
  const percent = view.questions.length ? Math.round((correct / view.questions.length) * 100) : 0
  const passed = meetsPracticeTarget(percent)
  const review = view.questions
  const [copyNotice, setCopyNotice] = useState('')

  function downloadReport() {
    const url = URL.createObjectURL(
      new Blob([quizReport(view)], { type: 'text/markdown;charset=utf-8' }),
    )
    const link = document.createElement('a')
    link.href = url
    link.download = `quiz-${view.id}.md`
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
      <section className="quiz-panel result-score">
        <p className="eyebrow">QUIZ COMPLETE</p>
        <h2>
          {correct} of {view.questions.length}
        </h2>
        <p>{percent}% correct</p>
        <p className={passed ? 'correct-text' : 'incorrect-text'}>
          <strong>Practice target (80%): {passed ? 'Pass' : 'Fail'}</strong>
        </p>
        <p>This is a practice target, not an AWS scaled score.</p>
        <div className="quiz-actions">
          <button onClick={onBack}>Back to quiz history</button>
          <button onClick={() => void copyReport()}>Copy discussion report</button>
          <button onClick={downloadReport}>Download report</button>
        </div>
        <p role="status">{copyNotice}</p>
      </section>
      <section className="quiz-panel">
        <h2>All answers and confidence</h2>
        {review.length === 0 && <p>All answers are correct and marked confident.</p>}
        {review.map((question) => (
          <article className="result-question" key={question.questionId}>
            <h3>{question.question}</h3>
            <p className={question.correct ? 'correct-text' : 'incorrect-text'}>
              {question.correct ? 'Correct' : 'Incorrect'} ·{' '}
              {question.confidence ?? 'Confidence not recorded'}
              {question.confidence !== 'Confident' ? ' · Review' : ''}
              {question.flagged ? ' · Marked for return' : ''}
            </p>
            <p className="muted">
              {question.sourceName} · {question.reference} · Domain {question.domain}
              {question.area ? ` · ${question.area}` : ''}
              {question.topic ? ` · ${question.topic}` : ''}
            </p>
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
