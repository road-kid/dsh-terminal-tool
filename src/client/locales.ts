import type { Dictionary } from './types.ts'

/**
 * Row copy.
 *
 * The namespace is the profile entry id (`terminal-tool`) so `label:()=>t('row.title')`
 * and the row body resolve through the same dictionary the slot declares.
 *
 * Wording follows the official General-section rows: a short noun-phrase title,
 * one factual sentence of description, no marketing language, and no promise the
 * plugin cannot keep. The description says *what the setting changes* and *when*
 * it takes effect, because that is the only thing a user needs to decide.
 */
export const LOCALE_NAMESPACE = 'terminal-tool'

export const zh: Dictionary = {
  'row.title': '终端工具',
  'row.description': '模型执行命令时使用的终端；改动只影响新会话。',
  'row.dialect.label': '终端类型',
  'row.dialect.pwsh': 'PowerShell（pwsh）',
  'row.dialect.bash': 'Git Bash（bash）',
  'row.path.label': 'Git Bash 路径',
  'row.path.placeholder': '例如 C:/Program Files/Git/bin/bash.exe',
  'row.path.none': '尚未选择',
  'row.path.missing': '点「自动发现」扫描本机，或直接填入 bash.exe 的完整路径。',
  'row.confined.label': '受限沙箱时',
  'row.confined.description':
    'Windows 沙箱会把命令降到低完整性，Git Bash 无法在其中启动；这里决定此时怎么办。',
  'row.confined.unconfined': '直接启动（不经沙箱）',
  'row.confined.escalate': '受限执行，失败后升级',
  'row.confined.fail': '报告错误',
  'row.confined.unconfinedNotice': '注意：选它之后，模型执行的命令不受文件沙箱限制。',
  'row.discover': '自动发现',
  'row.discovering': '正在扫描…',
  'row.foundNone': '没有找到 Git Bash，请直接填入 bash.exe 的完整路径。',
  'row.notSupported': '当前 DSH 版本不支持自动切换：{reason}',
  'row.saveFailed': '保存失败：{message}',
  'row.requestFailed': '请求失败：{detail}',
  'row.rejected': '宿主拒绝了这次保存（版本冲突或字段不可编辑），请刷新后重试。',
  'row.unavailable': '宿主设置服务不可用，无法保存。',
}

export const en: Dictionary = {
  'row.title': 'Terminal tool',
  'row.description': 'The terminal the model runs commands in; changes apply to new sessions only.',
  'row.dialect.label': 'Terminal kind',
  'row.dialect.pwsh': 'PowerShell (pwsh)',
  'row.dialect.bash': 'Git Bash (bash)',
  'row.path.label': 'Git Bash path',
  'row.path.placeholder': 'e.g. C:/Program Files/Git/bin/bash.exe',
  'row.path.none': 'Not chosen',
  'row.path.missing': 'Choose "Auto-detect" to scan this machine, or type the full path to bash.exe.',
  'row.confined.label': 'Under a confined sandbox',
  'row.confined.description':
    'The Windows sandbox drops commands to low integrity, where Git Bash cannot start; this decides what happens then.',
  'row.confined.unconfined': 'Run directly (no sandbox)',
  'row.confined.escalate': 'Confined, escalate on failure',
  'row.confined.fail': 'Report an error',
  'row.confined.unconfinedNotice': 'Note: with this choice, commands the model runs are not file-sandboxed.',
  'row.discover': 'Auto-detect',
  'row.discovering': 'Scanning…',
  'row.foundNone': 'No Git Bash found. Type the full path to bash.exe.',
  'row.notSupported': 'Not supported by this DSH version: {reason}',
  'row.saveFailed': 'Save failed: {message}',
  'row.requestFailed': 'Request failed: {detail}',
  'row.rejected': 'The host rejected this save (version conflict or a non-editable field). Refresh and retry.',
  'row.unavailable': 'The host settings service is unavailable, so changes cannot be saved.',
}
