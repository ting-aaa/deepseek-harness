/** Real Loader, native child lifecycle, scoped tool execution, JSONL and SQLite; only the model is scripted. */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { onTestFinished } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { boot, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import Agents from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import FsLocal from '@deepseek-ai/dsh-fs-local'
import Llm from '@deepseek-ai/dsh-llm'
import type { LlmAdapter } from '@deepseek-ai/dsh-llm'
import Sessions, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import * as Persistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import Projections from '@deepseek-ai/dsh-session-projection'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageSqlite from '@deepseek-ai/dsh-storage-sqlite'
import Subagents from '@deepseek-ai/dsh-subagent'
import * as Spawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import * as Executor from '@deepseek-ai/dsh-tool-executor-native'
import Tools from '@deepseek-ai/dsh-tools'
import WorkingDirectory from '@deepseek-ai/dsh-working-directory'
import Approval from '@deepseek-ai/dsh-user-approval'
import Harness2 from '../src/index.ts'
import * as ToolHarness2 from '@deepseek-ai/dsh-experimental-tool-harness2'
import type { Config } from '../src/index.ts'

/** Boot a temporary Cordis file using production modules, then create its exact live parent. */
export async function bootHarness(model: LlmAdapter, config: Config = {}, bundle = false, subagentConfig: { maxDepth?: number } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-harness2-loader-'))
  let owner: Context | undefined
  onTestFinished(async () => {
    await owner?.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  })
  const path = join(root, 'library.sqlite')
  const configPath = join(root, 'cordis.yml')
  const modules = {
    sessions: Sessions, projections: Projections, llm: Llm, systemPrompt: SystemPrompt,
    tools: Tools, executor: Executor, agents: Agents, loop: AgentLoop, fs: FsLocal,
    workingDirectory: WorkingDirectory, persistence: Persistence, subagents: Subagents,
    spawn: Spawn, storage: Storage, storageSqlite: StorageSqlite, storageDomain: StorageDomain,
    approval: Approval, harness2: Harness2,
  }
  const configs: Record<string, object> = {
    subagents: subagentConfig, loop: { agents: [] }, workingDirectory: { defaultDirectory: root },
    persistence: { root: join(root, 'sessions'), compression: 'none' },
    storageSqlite: { path }, storageDomain: { backend: 'sqlite' }, harness2: config,
  }
  await writeFile(configPath, JSON.stringify(Object.keys(modules).filter(id => !bundle || id !== 'harness2').map(id => ({
    id, name: `cordis:${id}`, ...configs[id] === undefined ? {} : { config: configs[id] },
  }))))
  const patches = bundle ? loadOverlayPatches('harness2-test', fileURLToPath(new URL('../../harness2-bundle/cordis.patch.yml', import.meta.url))) : undefined
  for (const patch of patches ?? []) {
    for (const entry of patch.insert ?? []) {
      const names: Record<string, string> = {
        '@deepseek-ai/dsh-experimental-harness2': 'cordis:harness2',
        '@deepseek-ai/dsh-experimental-tool-harness2': 'cordis:toolHarness2',
      }
      const name = names[entry.name]
      if (name === undefined) throw new Error(`Unrecognized Harness² bundle row ${entry.name}`)
      entry.name = name
    }
  }
  const sessions: Session[] = []
  const events = new Map<SessionId, SessionEvent[]>()
  const ctx = await boot('harness2-test', configPath, patches, (ctx) => {
    owner = ctx
    Object.assign(ctx.loader.builtins, modules, { toolHarness2: ToolHarness2 })
    ctx.on('session/created', (session) => { sessions.push(session); events.set(session.id, []) })
    ctx.on('session/event', (session, event) => { events.get(session.id)?.push(event) })
  })
  ctx.llm.registerAdapter(['scripted'], model)
  const parent = await ctx.agentLoop.create(SessionId('harness2-parent'), { provider: 'scripted', model: 'test', maxTokens: 1024 }, { cwd: root })
  return { ctx, root, path, parent, sessions, events }
}

/** Read persisted plugin-owned records independently of the engine's returned result. */
export function storedRecords(path: string, table: 'previews' | 'lessons' | 'runs' | 'checkpoints'): Record<string, unknown>[] {
  const db = new DatabaseSync(path, { readOnly: true })
  try {
    return db.prepare(`SELECT value FROM u_harness2_${table} ORDER BY key`).all()
      .map(row => JSON.parse(String(row.value)) as Record<string, unknown>)
  } finally {
    db.close()
  }
}
