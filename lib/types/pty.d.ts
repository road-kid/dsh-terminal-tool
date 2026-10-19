import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'

export declare const name = 'terminal-tool-pty'
export declare const inject: string[]
export type PtyConfig = {
  readonly backendType: string
  readonly bashPath: string
  readonly shellArgs: readonly string[]
  readonly pythonUtf8: boolean
  readonly loginShell: boolean
  readonly confinedPolicy: 'unconfined' | 'escalate' | 'fail'
}
export declare const Config: z<PtyConfig>
export declare function apply(ctx: Context, config: PtyConfig): Promise<void>
