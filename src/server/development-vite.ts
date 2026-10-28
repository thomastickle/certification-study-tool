import type { IncomingMessage, Server } from 'node:http'
import type { Duplex } from 'node:stream'
import type { ViteDevServer } from 'vite'
import { DevelopmentViteGraph } from './development-vite-graph.ts'

/** Serialize startup/reload handoffs while retaining every live and partial Vite graph until disposal. */
export class DevelopmentVite {
  private graphs = new Set<DevelopmentViteGraph>()
  private live: { graph: DevelopmentViteGraph; server: ViteDevServer } | undefined
  private starting: Promise<ViteDevServer> | undefined
  private reloading: Promise<void> | undefined
  private closing: Promise<void> | undefined
  private http: Server | undefined
  private upgrade: ((request: IncomingMessage, socket: Duplex, head: Buffer) => void) | undefined

  /** Establish one stable middleware/API handle; fallible replacements never displace its live graph.
   * @throws Preserves initial startup errors after the attempt has explicitly released its resources.
   */
  initialize(http: Server): Promise<ViteDevServer> {
    this.http = http
    this.upgrade = (request, socket, head) => {
      if (!this.live?.graph.upgrade(request, socket, head)) {
        socket.destroy()
      }
    }
    http.on('upgrade', this.upgrade)
    const graph = this.acquireGraph()
    this.starting = graph
      .initialize((force) => this.restart(force))
      .then((server) => {
        this.live = { graph, server }

        // Vite normally mutates one server during restart. Keep that stable public view without
        // overwriting the independent close handles for live/partial graphs.
        const close = () => this.close()

        return new Proxy(server, {
          get: (_target, key) => (key === 'close' ? close : Reflect.get(this.live!.server, key)),
          set: (_target, key, value) => Reflect.set(this.live!.server, key, value),
        })
      })
    return this.starting
  }

  /** Allocate an owner before invoking Vite, so even a rejected factory has a disposal path. */
  private acquireGraph(): DevelopmentViteGraph {
    const graph = new DevelopmentViteGraph()
    this.graphs.add(graph)
    return graph
  }

  /** Coalesce public and file-triggered reloads through the same owned creation path as startup. */
  private restart(forceOptimize = false): Promise<void> {
    if (this.closing) {
      return Promise.resolve()
    }
    this.reloading ??= this.replace(forceOptimize).finally(() => {
      this.reloading = undefined
    })
    return this.reloading
  }

  /** Retain Vite's logged-restart-failure semantics and keep the current graph on creation failure. */
  private async replace(forceOptimize: boolean): Promise<void> {
    // A file change during boot joins the initial acquisition before attempting a replacement.
    await this.starting
    if (this.closing) {
      return
    }
    const previous = this.live!
    const graph = this.acquireGraph()
    let server: ViteDevServer
    try {
      server = await graph.initialize(
        (force) => this.restart(force),
        previous.server.environments,
        forceOptimize,
      )
    } catch (error) {
      // Failed creation already disposed the attempt. Retain ownership/reporting if disposal failed.
      try {
        await this.releaseGraph(graph)
      } catch (cleanupError) {
        previous.server.config.logger.error(String(cleanupError), { timestamp: true })
      }
      // Vite's own restart() logs creation failures and resolves, retaining the live server.
      previous.server.config.logger.error(error instanceof Error ? error.message : String(error), {
        timestamp: true,
      })
      previous.server.config.logger.error('server restart failed', { timestamp: true })
      return
    }
    if (this.closing) {
      await this.releaseGraph(graph)
      return
    }
    await this.releaseGraph(previous.graph)
    this.live = { graph, server }
    server.config.logger.info('server restarted.', { timestamp: true })
  }

  /** Forget a graph only after its independent disposal has completed successfully. */
  private async releaseGraph(graph: DevelopmentViteGraph): Promise<void> {
    await graph.close()
    this.graphs.delete(graph)
  }

  /** Drain in-progress replacement work before closing every acquired graph and HMR bridge. */
  close(): Promise<void> {
    this.closing ??= this.dispose()
    return this.closing
  }

  /** Keep the HTTP listener's single upgrade route until all live/partial WebSocket owners close. */
  private async dispose(): Promise<void> {
    try {
      await this.starting?.catch(() => undefined)
      await this.reloading?.catch(() => undefined)
      const results = await Promise.allSettled([...this.graphs].map((graph) => graph.close()))
      const failures = results
        .filter((result) => result.status === 'rejected')
        .map((result) => result.reason)
      if (failures.length) {
        throw new AggregateError(failures, 'Vite graph disposal failed.')
      }
    } finally {
      if (this.upgrade) {
        this.http?.off('upgrade', this.upgrade)
      }
    }
  }
}
