import { setImmediate as nextTurn } from 'node:timers/promises'
import type { Server } from 'node:http'
import type {
  DevEnvironment,
  FSWatcher,
  Plugin,
  ResolvedConfig,
  ViteDevServer,
  WebSocketServer,
} from 'vite'

/** Own Vite from environment allocation through fallible hooks, not only after its factory returns. */
export class DevelopmentVite {
  private vite: ViteDevServer | undefined
  private watchers = new Set<FSWatcher>()
  private sockets = new Set<WebSocketServer>()
  private environments = new Set<DevEnvironment>()
  private initializing = new Set<Promise<unknown>>()
  private closing: Promise<void> | undefined
  private http: Server | undefined
  private originalUpgradeListeners: ReturnType<Server['rawListeners']> = []

  /** Resolve plugins once and capture ownership before pre-ordered user initialization hooks.
   * @throws Preserves the startup error after disposal; aggregates a separate cleanup failure if needed.
   */
  async initialize(http: Server): Promise<ViteDevServer> {
    this.http = http
    this.originalUpgradeListeners = http.rawListeners('upgrade')
    const { createServer, resolveConfig } = await import('vite')
    const ownership: Plugin = {
      name: 'study-vite-ownership',
      enforce: 'pre',
      configureServer: {
        order: 'pre',
        handler: (vite) => {
          this.vite = vite
          this.watchers.add(vite.watcher)
        },
      },
    }
    try {
      const inline = {
        server: { middlewareMode: true as const, hmr: { server: http } },
        appType: 'spa' as const,
        plugins: [ownership],
      }
      const config = await resolveConfig(
        inline,
        'serve',
        undefined,
        undefined,
        false,
        undefined,
        (plugins) => {
          // File-config plugins precede inline plugins, even with enforce/order pre. Patch before sorting.
          const existing = plugins.indexOf(ownership)
          if (existing !== -1) {
            plugins.splice(existing, 1)
          }
          plugins.unshift(ownership)
        },
      )
      this.ownEnvironments(config)
      const vite = await createServer(config)
      this.vite = vite
      return vite
    } catch (error) {
      try {
        await this.close()
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], 'Vite initialization and cleanup failed.', {
          cause: cleanupError,
        })
      }
      throw error
    }
  }

  /** Capture watcher and HMR ownership before an environment's fallible init/options hooks. */
  private ownEnvironments(config: ResolvedConfig): void {
    for (const options of Object.values(config.environments)) {
      const create = options.dev.createEnvironment
      options.dev.createEnvironment = (name, configuration, context) => {
        this.sockets.add(context.ws)
        const creating = Promise.resolve()
          .then(() => create.call(options.dev, name, configuration, context))
          .then(
            (environment) => {
              this.environments.add(environment)
              const init = environment.init.bind(environment)
              environment.init = (options) => {
                if (options?.watcher) {
                  this.watchers.add(options.watcher)
                }
                return this.track(init(options))
              }
              return environment
            },
            (error) => {
              // Vite only reads name and calls init before awaiting it. Delay the original rejection
              // until init exposes the already allocated watcher, even if every factory failed.
              return {
                name,
                init: async (options: Parameters<DevEnvironment['init']>[0]) => {
                  if (options?.watcher) {
                    this.watchers.add(options.watcher)
                  }
                  throw error
                },
              } as unknown as DevEnvironment
            },
          )
        return this.track(creating)
      }
    }
  }

  /** Wait for parallel environment initialization before releasing resources from a rejected factory. */
  private track<T>(pending: Promise<T>): Promise<T> {
    this.initializing.add(pending)
    void pending.then(
      () => this.initializing.delete(pending),
      () => this.initializing.delete(pending),
    )
    return pending
  }

  /** Close HMR and environments, then watchers that finishing hooks may have reopened. */
  close(): Promise<void> {
    this.closing ??= this.dispose()
    return this.closing
  }

  /** Release partial environment resources even when Vite has not yet exposed its full server. */
  private async dispose(): Promise<void> {
    try {
      while (this.initializing.size) {
        await Promise.allSettled([...this.initializing])
      }
      if (this.vite) {
        await this.vite.close()
      } else {
        // A failed options hook can leave an environment without an initialized plugin container.
        await Promise.allSettled([
          ...[...this.environments].flatMap((environment) => [
            Promise.resolve().then(() => environment.close()),
            Promise.resolve().then(() => environment.depsOptimizer?.close()),
          ]),
          ...[...this.sockets].map((socket) => socket.close()),
        ])
      }
    } finally {
      try {
        await Promise.all([...this.watchers].map((watcher) => watcher.close()))
        // Chokidar resolves before fs.watch's native close callbacks. Cross the close phase before
        // a startup rejection can terminate Node and hide still-closing FSEventWrap resources.
        await nextTurn()
        await nextTurn()
      } finally {
        // Public-file scanning can reject after HMR attaches, before environment factories run.
        for (const listener of this.http?.rawListeners('upgrade') ?? []) {
          if (!this.originalUpgradeListeners.includes(listener)) {
            this.http?.removeListener('upgrade', listener as (...args: unknown[]) => void)
          }
        }
      }
    }
  }
}
