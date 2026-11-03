/** SDK-profile experiment: train, freeze a revision, and compare held-out artifact outcomes. @module */
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { promisify } from 'node:util'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DeepSeekHarness } from '@deepseek-ai/dsh-sdk-client'
import type { RunResult } from '@deepseek-ai/dsh-sdk-client'
import { SUITE, TASK, grade } from './suite.ts'
import type { LedgerTask } from './suite.ts'

const root = fileURLToPath(new URL('../../../../', import.meta.url))
if (existsSync(join(root, '.env'))) process.loadEnvFile(join(root, '.env'))
const smoke = process.argv.includes('--scripted-smoke')
const dry = process.argv.includes('--dry-run')
const provider = smoke ? 'harness2-eval-smoke' : process.env['HARNESS2_EVAL_PROVIDER'] ?? 'deepseek-official'
const model = smoke ? 'scripted' : process.env['HARNESS2_EVAL_MODEL'] ?? 'deepseek-v4-flash'
if (dry) {
  process.stdout.write(`${JSON.stringify({ mode: 'dry-run', provider, model,
    tasks: SUITE.map(({ id, split }) => ({ id, split })), qualityMeasured: false }, null, 2)}\n`)
  process.exit(0)
}
if (!smoke && !process.env['DEEPSEEK_API_KEY'] && provider === 'deepseek-official') {
  throw new Error('Set DEEPSEEK_API_KEY for a real experiment, or use --scripted-smoke to verify plumbing without quality claims')
}
const parent = join(homedir(), '.dsh', 'harness2-evaluations')
await mkdir(parent, { recursive: true })
const directory = await mkdtemp(join(parent, 'run-'))
const home = join(directory, 'home')
const patch = join(directory, 'evaluation.patch.json')
const patchRows: object[] = [
  { id: 'optional-harness2', config: { rollout: 'workspace', editor: 'filesystem', k: 1, maxK: 1,
    runtime: null, maxStepsPerChild: 24, maxTokensPerChild: 4096, maxRolloutTokens: 100000,
    childTimeoutMs: 300000, scratchDirectory: join(directory, 'scratch') } },
]
if (smoke) patchRows.push({ id: 'harness2-eval-model', name: fileURLToPath(new URL('./scripted-model.mjs', import.meta.url)) })
await writeFile(patch, JSON.stringify([...patchRows.filter(row => 'config' in row),
  ...smoke ? [{ id: 'llm-deepseek', disabled: true }, { insert: patchRows.filter(row => 'name' in row) }] : []]))
const execute = promisify(execFile)
const allowed = new Set(['harness2_workspace_rollouts', 'harness2_remember', 'harness2_activate', 'harness2_apply'])
const domain = 'evaluation-ledger'
interface Measurement {
  id: string
  arm: string
  revision: number | null
  passed: boolean
  reason: string
  usage: { inputTokens: number; outputTokens: number }
  elapsedMs: number
  runId?: string
}
const reports: Measurement[] = []
const allRuns: RunResult[] = []

function tokens(runs: readonly RunResult[]) {
  let inputTokens = 0
  let outputTokens = 0
  const seen = new Set<string>()
  for (const run of runs) for (const notification of run.notifications) {
    if (notification.method !== 'session.event') continue
    const event = notification.params['event']
    if (event === null || typeof event !== 'object' || !('type' in event) || event.type !== 'assistant/message'
      || !('data' in event) || event.data === null || typeof event.data !== 'object') continue
    const key = `${notification.params['sessionId']}:${'seq' in event ? event.seq : ''}`
    if (seen.has(key)) continue
    seen.add(key)
    const usage = 'usage' in event.data ? event.data.usage : undefined
    if (usage !== null && typeof usage === 'object') {
      if ('inputTokens' in usage && typeof usage.inputTokens === 'number') inputTokens += usage.inputTokens
      if ('outputTokens' in usage && typeof usage.outputTokens === 'number') outputTokens += usage.outputTokens
    }
  }
  return { inputTokens, outputTokens }
}

function toolResult(run: RunResult, name: string): Record<string, unknown> {
  const call = run.events.find(event => event.type === 'tool/call' && event.data.name === name)
  if (call?.type !== 'tool/call') throw new Error(`Required tool ${name} was not called`)
  const result = run.events.find(event => event.type === 'tool/result' && event.data.message.toolCallId === call.data.callId)
  if (result?.type !== 'tool/result' || result.data.message.isError) throw new Error(`Required tool ${name} failed`)
  const content = result.data.message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
  const parsed: unknown = JSON.parse(content)
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`Invalid ${name} result`)
  return parsed as Record<string, unknown>
}

async function json(path: string): Promise<unknown> {
  try { return JSON.parse(await readFile(path, 'utf8')) } catch (error) {
    if (error instanceof SyntaxError || (error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

async function fixture(task: LedgerTask, arm: string): Promise<string> {
  const cwd = join(directory, `${task.id}-${arm}`)
  await mkdir(cwd)
  await writeFile(join(cwd, 'input.json'), JSON.stringify(task.rows))
  await execute('git', ['init', '--quiet', cwd], { timeout: 10000, windowsHide: true })
  return cwd
}

async function runtime(cwd: string): Promise<DeepSeekHarness> {
  const harness = new DeepSeekHarness({ profile: 'sdk', dshBin: join(root, 'apps/cli/lib/bin.js'),
    patches: [...process.env['HARNESS2_EVAL_PATCH'] ? [resolve(process.env['HARNESS2_EVAL_PATCH'])] : [], patch],
    dshHome: home, cwd, provider, model, maxTokens: 4096,
    approvalRequests: true, initializeTimeoutMs: 60000, requestTimeoutMs: 1800000 })
  await harness.client.start()
  harness.client.onRequest(async (method, params) => ({ outcome: method === 'approval/request'
    && typeof params['toolName'] === 'string' && allowed.has(params['toolName']) ? 'allowed-once' : 'rejected' }))
  try { await harness.start(); return harness } catch (error) { await harness.close(); throw error }
}

let revision = 0
try {
  for (const task of SUITE.filter(item => item.split === 'train')) {
    const cwd = await fixture(task, 'search')
    const started = performance.now()
    await using harness = await runtime(cwd)
    const session = harness.session()
    const runs = [await session.run('/permission auto')]
    const previewRun = await session.run(`Call harness2 with task=${JSON.stringify(TASK)}, domain=${domain}, k=1. `
      + 'Show the returned preview; do not remember, activate or apply it yet. H2_EVAL_TRAIN')
    runs.push(previewRun)
    const preview = toolResult(previewRun, 'harness2')
    if (preview['executor'] !== 'workspace' || preview['editor'] !== 'filesystem') throw new Error('Evaluation requires full workspace/file editing')
    const id = preview['runId']
    if (typeof id !== 'string') throw new Error('Preview omitted runId')
    const remembered = await session.run(`Call harness2_remember for runId=${id}. H2_EVAL_REMEMBER`)
    runs.push(remembered)
    const accepted = toolResult(remembered, 'harness2_remember')
    if (typeof accepted['revision'] !== 'number') throw new Error('Adoption omitted revision')
    revision = accepted['revision']
    const applied = await session.run(`Call harness2_apply for runId=${id}. H2_EVAL_APPLY`)
    runs.push(applied)
    if (toolResult(applied, 'harness2_apply')['applied'] !== true) throw new Error('Selected artifact was not applied')
    await harness.close()
    // The oracle runs only after adoption; no grade or hidden answer reaches the optimizer.
    reports.push({ id: task.id, arm: 'search', runId: id, revision,
      ...grade(task, await json(join(cwd, 'output.json')), await json(join(cwd, 'input.json'))),
      usage: tokens(runs), elapsedMs: performance.now() - started })
    allRuns.push(...runs)
  }
  for (const task of SUITE.filter(item => item.split === 'held-out')) for (const arm of ['baseline', 'optimized']) {
    const cwd = await fixture(task, arm)
    const started = performance.now()
    await using harness = await runtime(cwd)
    const runs: RunResult[] = []
    if (arm === 'optimized') {
      const binding = harness.session()
      runs.push(await binding.run('/permission auto'))
      const activation = await binding.run(`Call harness2_activate with domain=${domain}, mode=parallel, revision=${revision}. H2_EVAL_ACTIVATE`)
      runs.push(activation)
      if (toolResult(activation, 'harness2_activate')['revision'] !== revision) throw new Error('Frozen revision activation failed')
    }
    const session = harness.session()
    const subscription = harness.client.subscribe()
    const setup = await session.run('/permission auto')
    runs.push(setup)
    const run = await session.run(`${TASK}\nComplete this task directly with ordinary tools. Do not run harness2 or change bindings. H2_EVAL_SOLVE`)
    runs.push(run)
    const observed: RunResult['notifications'] = []
    for (let next = subscription.tryNext(); next !== undefined; next = subscription.tryNext()) observed.push(next)
    subscription.close()
    if (arm === 'optimized' && !observed.some((notification) => {
      if (notification.method !== 'session.event' || notification.params['sessionId'] !== run.sessionId) return false
      const event = notification.params['event']
      return event !== null && typeof event === 'object' && 'type' in event && event.type === 'harness2/overlay'
        && 'data' in event && event.data !== null && typeof event.data === 'object'
        && 'revision' in event.data && event.data.revision === revision
    })) throw new Error('Frozen overlay was not recorded on the evaluated session')
    await harness.close()
    reports.push({ id: task.id, arm, revision: arm === 'optimized' ? revision : null,
      ...grade(task, await json(join(cwd, 'output.json')), await json(join(cwd, 'input.json'))),
      usage: tokens(runs), elapsedMs: performance.now() - started })
    allRuns.push(...runs)
  }
  const summary = Object.fromEntries(['search', 'baseline', 'optimized'].map((arm) => {
    const rows = reports.filter(row => row.arm === arm)
    return [arm, { tasks: rows.length, passed: rows.filter(row => row.passed).length,
      inputTokens: rows.reduce((sum, row) => sum + row.usage.inputTokens, 0),
      outputTokens: rows.reduce((sum, row) => sum + row.usage.outputTokens, 0),
      elapsedMs: rows.reduce((sum, row) => sum + row.elapsedMs, 0) }]
  }))
  await writeFile(join(directory, 'report.json'), JSON.stringify({ mode: smoke ? 'scripted-smoke' : 'real-provider',
    qualityMeasured: !smoke, provider, model, revision, taskSpecification: TASK, summary, reports,
    totalUsage: tokens(allRuns) }, null, 2))
  process.stdout.write(`${resolve(directory, 'report.json')}\n`)
} catch (error) {
  await writeFile(join(directory, 'failure.json'), JSON.stringify({ mode: smoke ? 'scripted-smoke' : 'real-provider',
    completed: reports, error: error instanceof Error ? error.message : String(error) }, null, 2))
  throw error
}
