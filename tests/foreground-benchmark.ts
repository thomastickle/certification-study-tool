import assert from 'node:assert/strict'
import { fork } from 'node:child_process'
import { availableParallelism, cpus, freemem, loadavg, platform, release, totalmem } from 'node:os'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import type { Bank } from '../src/shared/contracts.ts'
import type { QuizAnswer, QuizSummary, QuizView } from '../src/shared/quiz-contracts.ts'
import type { FixtureInfo, Workload } from './foreground-benchmark-worker.ts'
import { summarize } from './performance-metrics.ts'
import { benchmarkWorkerLifetime } from './benchmark-worker-lifetime.ts'

const profiles: Record<string, Workload> = {
  small: { owners: 10, histories: 10, questions: 48, backlog: 1 },
  bank: { owners: 10, histories: 100, questions: 1000, backlog: 25 },
  history: { owners: 100, histories: 2000, questions: 1000, backlog: 100 },
  diverse: { owners: 100, histories: 2000, questions: 1000, backlog: 100, answered: true },
}
const selected = process.argv[2] ?? 'small'
const workload = profiles[selected]
assert.ok(workload, 'Choose small, bank or history')
const repetitions = Number(process.argv[3] ?? 3)
assert.ok(Number.isInteger(repetitions) && repetitions > 0 && repetitions <= 5)
console.log(
  JSON.stringify({
    host: {
      node: process.version,
      platform: platform(),
      release: release(),
      cpu: cpus()[0]?.model,
      logicalCpus: cpus().length,
      availableParallelism: availableParallelism(),
      totalMemory: totalmem(),
      freeMemory: freemem(),
      loadAverage: loadavg(),
    },
    workloadVersion: 'study-history-v2-answered',
    selected,
    workload,
    repetitions,
    timestamp: new Date().toISOString(),
  }),
)

// Repetitions are sequential, with fresh synthetic files and OS-selected loopback ports.
for (let repetition = 1; repetition <= repetitions; repetition++) {
  const worker = fork(
    fileURLToPath(new URL('./foreground-benchmark-worker.ts', import.meta.url)),
    [JSON.stringify(workload)],
    {
      stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
    },
  )
  const lifetime = benchmarkWorkerLifetime(worker)
  let failed = true

  /** Fail promptly when the fixture exits instead of waiting forever for IPC. */
  function receive(): Promise<unknown[]> {
    return new Promise((resolve, reject) => {
      if (worker.exitCode !== null || worker.signalCode !== null) {
        reject(new Error('Benchmark worker already exited'))
        return
      }

      const cleanup = () => {
        worker.off('message', message)
        worker.off('exit', exited)
        worker.off('error', failed)
      }

      const message = (value: unknown) => {
        cleanup()
        resolve([value])
      }

      const exited = () => {
        cleanup()
        reject(new Error('Benchmark worker exited before replying'))
      }

      const failed = (error: Error) => {
        cleanup()
        reject(error)
      }

      worker.once('message', message)
      worker.once('exit', exited)
      worker.once('error', failed)
    })
  }

  try {
    const [message] = (await receive()) as [{ ready: FixtureInfo }]
    assert.ok(message.ready, 'Worker must finish synthetic setup before HTTP sampling')
    const fixture = message.ready

    /** IPC commands execute sequentially and are never part of HTTP latency samples. */
    async function command<T = unknown>(name: string, completedId?: string): Promise<T> {
      assert.ok(worker.connected, 'Benchmark worker IPC must remain connected')
      const response = receive()
      worker.send({ name, completedId })
      const [reply] = (await response) as [{ result: T; error?: string }]
      assert.equal(reply.error, undefined)
      return reply.result
    }

    /** Client clock includes connection, queueing, HTTP transfer and complete response consumption. */
    async function call<T>(path: string, data?: unknown, method = 'POST', actor = 0): Promise<T> {
      const response = await fetch(fixture.origin + path, {
        method,
        signal: lifetime.signal,
        headers: { 'Content-Type': 'application/json', 'x-synthetic-actor': String(actor) },
        ...(data === undefined ? {} : { body: JSON.stringify(data) }),
      })
      const text = await response.text()
      assert.ok(response.ok, `${path}: HTTP ${response.status}: ${text.slice(0, 100)}`)
      return (text ? JSON.parse(text) : null) as T
    }

    /** Request count and workload wall time are independent of service/timer metrics. */
    async function phase<T>(
      name: string,
      action: (sample: <R>(operation: () => Promise<R>) => Promise<R>) => Promise<T>,
    ) {
      await command('begin')
      const latencies: number[] = []
      const start = performance.now()

      const sample = async <R>(operation: () => Promise<R>): Promise<R> => {
        const requestStart = performance.now()
        const result = await operation()
        latencies.push(performance.now() - requestStart)
        return result
      }

      const result = await action(sample)
      const workloadElapsedMs = performance.now() - start
      const server = await command('end')
      console.log(
        JSON.stringify({
          selected,
          repetition,
          phase: name,
          httpLatencyMs: summarize(latencies),
          httpSamplesMs: latencies,
          workloadElapsedMs,
          server,
        }),
      )
      return result
    }

    console.log(
      JSON.stringify({
        selected,
        repetition,
        phase: 'startup-recovery',
        measurement: fixture.startup,
      }),
    )
    const input = await command<Bank>('bank')
    const preview = await phase('import-preview', (sample) =>
      sample(() => call<{ token: string }>('/api/private/imports/preview', { bank: input })),
    )
    await phase('import-confirm', (sample) =>
      sample(() =>
        call('/api/private/imports/confirm', {
          bank: input,
          token: preview.token,
          reviewed: false,
        }),
      ),
    )
    const quiz = await phase('quiz-start', (sample) =>
      sample(() =>
        call<QuizView>('/api/quizzes', { sourceFilter: 'mixed', questionType: 'mixed' }),
      ),
    )
    const answers: QuizAnswer[] = workload.answered
      ? await command<QuizAnswer[]>('answers', quiz.id)
      : quiz.questions.map((question) => ({
          questionId: question.questionId,
          selected: [],
          confidence: null,
          flagged: false,
        }))
    const submitted = await phase('quiz-complete', (sample) =>
      sample(() => call<QuizView>(`/api/quizzes/${quiz.id}/submit`, { answers })),
    )
    assert.equal(submitted.status, 'completed')
    assert.equal(submitted.correctCount, workload.answered ? 15 : 0)
    await phase('due-read', (sample) => sample(() => call('/api/quizzes/due', undefined, 'GET')))
    await command('replay')
    await phase('foreground-reconcile-backlog', (sample) =>
      sample(() => call('/api/sources', undefined, 'GET')),
    )
    await phase('private-delete-with-annotation', (sample) =>
      sample(() => call(`/api/private/sources/${fixture.privateSource}`, undefined, 'DELETE')),
    )
    await phase('shared-delete-event', (sample) =>
      sample(() => call(`/api/shared/sources/${fixture.sharedSource}`, undefined, 'DELETE')),
    )
    await phase('foreground-reconcile-new-event', (sample) =>
      sample(() => call('/api/sources', undefined, 'GET')),
    )
    const actorLatencies: number[][] = [[], []]
    await phase('busy-account-reads', async (sample) => {
      for (let batch = 0; batch < 5; batch++) {
        await Promise.all(
          Array.from({ length: 4 }, (_, index) =>
            sample(async () => {
              const actor = index % 2
              const start = performance.now()
              const result = await call('/api/quizzes/due', undefined, 'GET', actor)
              actorLatencies[actor]!.push(performance.now() - start)
              return result
            }),
          ),
        )
      }
    })
    console.log(
      JSON.stringify({
        selected,
        repetition,
        phase: 'contention-by-actor',
        httpLatencyMs: actorLatencies.map(summarize),
        httpSamplesMs: actorLatencies,
      }),
    )
    console.log(
      JSON.stringify({
        selected,
        repetition,
        phase: 'recurring-reconciliation',
        measurement: await command('recurring'),
      }),
    )
    console.log(
      JSON.stringify({
        selected,
        repetition,
        phase: 'correctness',
        result: await command('verify', submitted.id),
      }),
    )
    // Verification requests are outside every measured phase and are not timing samples.
    const records = await command<{ id: string; deletedBankNames: string[] }[][]>('records')
    for (const [actor, expected] of records.entries()) {
      const returned = await call<QuizSummary[]>('/api/quizzes', undefined, 'GET', actor)
      const actual = returned.map((record) => ({
        id: record.id,
        deletedBankNames: [...(record.deletedBankNames ?? [])].sort(),
      }))
      assert.deepEqual(
        actual.sort((a, b) => a.id.localeCompare(b.id)),
        expected.sort((a, b) => a.id.localeCompare(b.id)),
      )
    }
    console.log(
      JSON.stringify({
        selected,
        repetition,
        phase: 'evidence-costs',
        measurement: await command('evidence-costs'),
      }),
    )
    failed = false
  } finally {
    const exit = await lifetime.stop(failed)
    if (!failed) {
      assert.deepEqual(exit, { code: 0, signal: null }, 'Worker must shut down cleanly')
    }
  }
}
