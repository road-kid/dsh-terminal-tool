import type { Dictionary } from './types.ts'

/** Locale namespace owned by this client bundle. */
export const LOCALE_NAMESPACE = 'terminal-tool'

export const en: Dictionary = {
  title: 'Terminal tool',
  description:
    'Choose which shell backs the model’s terminal tool. Git Bash mounts a bash tool for the session and removes pwsh from it.',
  pwsh: 'PowerShell',
  bash: 'Git Bash',
  bashPath: 'Git Bash path',
  bashPathPlaceholder: 'Detect automatically',
  bashPathHint: 'Leave empty to auto-discover Git Bash. A configured path is used as-is.',
  autoDiscover: 'Auto-discover when the path is empty',
  newSessionOnly: 'Applies to new sessions only.',
  saving: 'Saving…',
  saveFailed: 'The host refused the change. Try again.',
}

export const zh: Dictionary = {
  title: '终端工具',
  description:
    '选择模型终端工具使用的 shell。切换到 Git Bash 后，会话会挂载 bash 工具并移除 pwsh。',
  pwsh: 'PowerShell',
  bash: 'Git Bash',
  bashPath: 'Git Bash 路径',
  bashPathPlaceholder: '自动检测',
  bashPathHint: '留空则自动发现 Git Bash；填写后按填写的路径使用。',
  autoDiscover: '路径为空时自动发现',
  newSessionOnly: '仅对新会话生效。',
  saving: '正在保存…',
  saveFailed: 'Host 拒绝了这次修改，请重试。',
}
