import type { Context } from '@deepseek-ai/cordis'
import type { Config as BashLocalConfig } from '@deepseek-ai/dsh-bash-local'
import z from '@deepseek-ai/schemastery'

export declare const name = 'terminal-tool'
export declare const inject: string[]
export type RawConfig = BashLocalConfig & {
  readonly dialect: 'pwsh' | 'bash'
  readonly bashPath: string
  readonly bashCandidates: readonly string[]
  readonly autoDiscover: boolean
  readonly discoverTimeoutMs: number
  readonly loginShell: boolean
  readonly extraPath: readonly string[]
  readonly pythonUtf8: boolean
}
export type SkipReason =
  | 'not-win32'
  | 'dialect-pwsh'
  | 'no-agent-context'
  | 'already-replaced'
  | 'bash-not-found'
  | 'missing-service'
  | 'mount-failed'
export type InstallResult =
  | { readonly status: 'installed'; readonly bashPath: string }
  | { readonly status: 'skipped'; readonly reason: SkipReason; readonly detail?: string }
export declare const Config: z<RawConfig>
export declare function apply(ctx: Context, config: RawConfig): void
export declare function installResultFor(agentId: string): InstallResult | undefined
