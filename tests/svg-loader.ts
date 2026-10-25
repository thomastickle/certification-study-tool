import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'

// Match Vite's raw SVG imports in Node-rendered component tests.
registerHooks({
  load(url, context, nextLoad) {
    if (!url.startsWith('file:') || !url.endsWith('.svg?raw')) {
      return nextLoad(url, context)
    }
    const path = new URL(url)
    path.search = ''
    return {
      format: 'module',
      source: `export default ${JSON.stringify(readFileSync(path, 'utf8'))}`,
      shortCircuit: true,
    }
  },
})
