// Opt-in end-to-end check: DSH_CLI=/absolute/path/to/dsh/lib/bin.js node scripts/harness-permission-smoke.mjs
// Uses real DSH agents, tools and sandbox policy with an isolated DSH_HOME/workspace.
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const cli = process.env.DSH_CLI
assert.ok(cli, 'Set DSH_CLI to the installed DSH entry point')
const provider = resolve(process.env.DSH_SMOKE_PROVIDER ?? fileURLToPath(new URL('../lib/index.js', import.meta.url)))
const root = await mkdtemp(join(tmpdir(), 'dsh-real-permissions-'))
const report = []
async function files(dir) {
  const result = []
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, e.name)
    if (e.isDirectory()) result.push(...await files(path))
    else if (e.name.endsWith('.jsonl.zstd')) result.push(path)
  }
  return result
}
async function run(args, cwd, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = '', stderr = ''
    child.stdout.on('data', b => { stdout += b })
    child.stderr.on('data', b => { stderr += b })
    const timer = setTimeout(() => { child.kill('SIGTERM') }, 120_000)
    child.on('error', reject)
    child.on('close', code => { clearTimeout(timer); resolve({ code, stdout, stderr }) })
  })
}
try {
  for (const mode of (process.env.DSH_SMOKE_MODE ? [process.env.DSH_SMOKE_MODE] : ['danger-full-access', 'read-only'])) {
    const dir = join(root, mode), home = join(dir, 'home'), workspace = join(dir, 'workspace')
    await mkdir(workspace, { recursive: true })
    const target = join(workspace, 'settings.json')
    const before = '{"enabled":false}\n'
    await writeFile(target, before)
    const patch = join(dir, 'patch.json')
    await writeFile(patch, JSON.stringify([
      { insert: [{ id: 'llm-codex-app-server', name: provider }] },
      { id: 'agent-default-model', config: { provider: 'openai-codex', model: process.env.DSH_SMOKE_MODEL ?? 'gpt-5.6-sol', reasoningEffort: 'low' } },
      { id: 'sandbox-policy', config: { mode, workspaceRoot: workspace } },
      { id: 'approval', config: { policy: 'never' } },
      { id: 'permission', config: { defaultPreset: mode, presets: { [mode]: { sandbox: mode, approval: 'never' } } } },
      { id: 'session-title-llm', disabled: true },
    ]))
    const result = await run(['--profile', 'headless', '--patch', patch,
      'Update settings.json so enabled is true, then read it back to verify. Only change this file. Attempt the requested edit through the available file tools. If a tool rejects it, report the actual error and stop without escalation or trying another write mechanism.'], workspace,
      { ...process.env, DSH_HOME: home, DSH_PERMISSION_MODE: mode })
    assert.equal(result.code, 0, result.stderr.slice(-5000))
    const paths = await files(join(home, 'sessions'))
    const events = paths.flatMap(p => execFileSync('zstd', ['-dc', p], { encoding: 'utf8' }).trim().split('\n').map(JSON.parse))
    const calls = events.filter(e => e.type === 'tool/call').map(e => e.data)
    const writes = calls.filter(c => ['edit', 'write'].includes(c.name))
    assert.ok(writes.length, `No DSH edit/write attempted: ${JSON.stringify({ calls, answer: result.stdout })}`)
    const writeIds = new Set(writes.map(c => c.callId))
    const writeResults = events.filter(e => e.type === 'tool/result').flatMap(e => e.data.message.content).filter(b => writeIds.has(b.toolCallId))
    assert.ok(writeResults.length)
    const after = await readFile(target, 'utf8')
    if (mode === 'danger-full-access') {
      assert.equal(JSON.parse(after).enabled, true)
      assert.ok(writeResults.some(r => !r.isError))
    } else {
      assert.equal(after, before)
      assert.ok(writeResults.some(r => r.isError), JSON.stringify(writeResults))
    }
    const evidence = { mode, tools: calls.map(c => c.name), writeResults, after, answer: result.stdout.trim() }
    report.push(evidence)
    console.log(JSON.stringify(evidence))
  }
  if (process.env.DSH_SMOKE_REPORT) await writeFile(process.env.DSH_SMOKE_REPORT, JSON.stringify(report, null, 2) + '\n')
} finally {
  await rm(root, { recursive: true, force: true })
}
