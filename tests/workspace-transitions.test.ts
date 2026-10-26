import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runInThisContext } from 'node:vm'
import * as jsx from 'react/jsx-runtime'
import type { ReactElement, ReactNode } from 'react'
import ts from 'typescript'
import * as certifications from '../src/web/features/certifications/certifications.ts'
import * as session from '../src/web/app/workspace-session.ts'
import { createWorkspaceApi } from '../src/web/shared/lib/api.ts'

type Element = ReactElement<Record<string, unknown>>

const account = { id: 'synthetic-owner', name: 'Owner' }
const source = {
  id: 1,
  name: 'Synthetic questions',
  kind: 'third_party',
  key: 'synthetic',
  certification: 'DEMO-1',
  certificationName: 'Example',
  provider: 'Example',
  questionCount: 20,
}

/** Exercise App's public event props with hook state; child views and browser rendering stay outside. */
async function openPractice() {
  const slots: unknown[] = []
  const effects: Array<() => void> = []
  let cursor = 0
  let mounted = false
  const workspace = createWorkspaceApi(account.id)
  const hooks = {
    useState<T>(initial: T) {
      const slot = cursor++
      if (!(slot in slots)) {
        slots[slot] = initial
      }
      return [
        slots[slot],
        (next: T | ((previous: T) => T)) => {
          const update = next as (previous: T) => T
          slots[slot] = typeof next === 'function' ? update(slots[slot] as T) : next
        },
      ]
    },
    useRef<T>(initial: T) {
      const slot = cursor++
      if (!(slot in slots)) {
        slots[slot] = { current: initial }
      }
      return slots[slot]
    },
    useCallback<T>(callback: T) {
      return callback
    },
    useEffect(effect: () => void) {
      if (!mounted) {
        effects.push(effect)
      }
    },
  }
  const path = new URL('../src/web/app/App.tsx', import.meta.url)
  const compiled = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS },
  }).outputText
  const module = { exports: {} as typeof import('../src/web/app/App.tsx') }

  function load(name: string) {
    if (name === 'react') {
      return hooks
    }
    if (name === 'react/jsx-runtime') {
      return jsx
    }
    if (name.endsWith('/certifications.ts')) {
      return certifications
    }
    if (name === './workspace-session.ts') {
      return session
    }
    if (name.endsWith('/workspace-api.ts')) {
      return { useWorkspaceApi: () => workspace }
    }
    if (name === './use-appearance.ts') {
      return { useAppearance: () => ({}) }
    }
    if (name.endsWith('.tsx')) {
      const component = name.split('/').at(-1)!.replace('.tsx', '')
      return { [component]: component }
    }
    throw new Error(`Unexpected App dependency: ${name}`)
  }

  const initialize = runInThisContext(`(function(require, module, exports) {${compiled}\n})`)
  initialize(load, module, module.exports)

  function render() {
    cursor = 0
    const tree = module.exports.App({ account })
    mounted = true
    return tree
  }

  function search(matches: (element: Element) => boolean, node: ReactNode): Element | undefined {
    if (Array.isArray(node)) {
      return node.map((child) => search(matches, child)).find(Boolean)
    }
    if (!node || typeof node !== 'object' || !('props' in node)) {
      return undefined
    }
    const element = node as Element
    if (matches(element)) {
      return element
    }
    return search(matches, element.props.children as ReactNode)
  }

  function find(type: string) {
    return search((element) => element.type === type, render())
  }

  function props<T>(type: string): T {
    const element = find(type)
    assert.ok(element, `Missing ${type}`)
    return element.props as T
  }

  function alert() {
    const message = search((element) => element.props.role === 'alert', render())
    return message?.props.children ?? ''
  }

  render()
  effects.forEach((effect) => effect())
  await new Promise((resolve) => setImmediate(resolve))
  props<{ onNavigate: (next: string) => void }>('WorkspaceSidebar').onNavigate('practice')
  await new Promise((resolve) => setImmediate(resolve))
  assert.ok(find('QuizPage'))
  return { workspace, props, find, alert }
}

for (const action of ['page', 'logout'] as const) {
  test(`a rejected ${action} guard shows feedback, retains practice, and permits retry`, async (t) => {
    t.mock.method(globalThis, 'fetch', async () => Response.json([source]))
    const app = await openPractice()
    let fail = true
    let submissions = 0
    const practice = app.props<{
      onRegisterLeave: (guard: () => Promise<boolean>) => void
    }>('QuizPage')
    practice.onRegisterLeave(async () => {
      if (fail) {
        throw new Error('Synthetic save/pause rejection')
      }
      return true
    })

    function attemptTransition() {
      if (action === 'page') {
        app.props<{ onNavigate: (next: string) => void }>('WorkspaceSidebar').onNavigate('reports')
      } else {
        app.props<{ onSubmit: (event: unknown) => void }>('form').onSubmit({
          preventDefault() {},
          currentTarget: { submit: () => submissions++ },
        })
      }
    }

    attemptTransition()
    await new Promise((resolve) => setImmediate(resolve))
    assert.ok(app.find('QuizPage'), 'A rejected guard must keep practice mounted')
    assert.equal(app.find('ReportsPage'), undefined)
    assert.equal(submissions, 0, 'A rejected guard must not submit logout')
    assert.match(String(app.alert()), /Synthetic save\/pause rejection/)
    assert.match(String(app.alert()), /Retry/)
    if (action === 'logout') {
      assert.match(String(app.alert()), /still signed in/)
    }

    fail = false
    attemptTransition()
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(app.alert(), '', 'Retry clears the previous failure')
    if (action === 'page') {
      assert.ok(app.find('ReportsPage'))
    } else {
      assert.equal(submissions, 1, 'Retry uses the original native form exactly once')
    }
  })
}
