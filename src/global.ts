#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGE = 'dsh-openai-oauth'
const LEGACY_PACKAGES = ['deepseek-harness-openai-oauth', 'dsh-llm-codex-app-server']
const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const packageVersion = (JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as { version: string }).version
const packageSpec = `${PACKAGE}@${packageVersion}`

function dshHome(): string {
  return process.env.DSH_HOME?.trim() || join(homedir(), '.dsh')
}

function manifest(profile: string): Record<string, unknown> | undefined {
  const path = join(dshHome(), 'profiles', profile, 'package.json')
  if (!existsSync(path)) return undefined
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
}

function existingProfiles(): string[] {
  const root = join(dshHome(), 'profiles')
  if (!existsSync(root)) return []
  return readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && manifest(entry.name) !== undefined)
    .map(entry => entry.name)
}

function installed(profile: string, name: string): boolean {
  const dependencies = manifest(profile)?.dependencies
  return typeof dependencies === 'object' && dependencies !== null && name in dependencies
}

function runDsh(profile: string, command: 'add' | 'remove', target: string): boolean {
  const executable = process.platform === 'win32' ? 'npx.cmd' : 'npx'
  const result = spawnSync(executable, [
    '--yes', '@deepseek-ai/dsh', 'plugin', '--profile', profile, command, target,
  ], { stdio: 'inherit' })
  if (result.error !== undefined) {
    console.error(result.error.message)
    return false
  }
  return result.status === 0
}

function profilesForInstall(): string[] {
  return [...new Set(['web', 'headless', ...existingProfiles()])]
}

function usage(): never {
  console.error('Usage: dsh-openai-oauth <install|uninstall>')
  process.exit(2)
}

const [command, ...flags] = process.argv.slice(2)
if (command === 'install') {
  if (flags.length > 0) usage()
  let ok = true
  for (const profile of profilesForInstall()) {
    const legacy = LEGACY_PACKAGES.filter(name => installed(profile, name))
    if (!runDsh(profile, 'add', packageSpec)) {
      ok = false
      continue
    }
    for (const name of legacy) ok = runDsh(profile, 'remove', name) && ok
  }
  if (ok) console.log(`Installed ${PACKAGE} for all current Harness profiles.`)
  else process.exitCode = 1
} else if (command === 'uninstall') {
  if (flags.length > 0) {
    console.error('Credential deletion is no longer supported by this command. Sign out in DSH settings before uninstalling; existing Codex data is preserved.')
    usage()
  }
  let ok = true
  for (const profile of existingProfiles()) {
    for (const name of [PACKAGE, ...LEGACY_PACKAGES].filter(name => installed(profile, name))) {
      ok = runDsh(profile, 'remove', name) && ok
    }
  }
  if (ok) console.log(`Removed ${PACKAGE} from all current Harness profiles.`)
  else process.exitCode = 1
} else {
  usage()
}
