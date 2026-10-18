import type { Dictionary } from './types.ts'

/**
 * Row copy.
 *
 * The namespace is the profile entry id (`terminal-tool`) so `label:()=>t('row.title')`
 * and the row body resolve through the same dictionary the slot declares.
 */
export const LOCALE_NAMESPACE = 'terminal-tool'

export const zh: Dictionary = {
  'row.title': '终端工具',
  'row.dialect.pwsh': 'PowerShell（pwsh）',
  'row.dialect.bash': 'Git Bash（bash）',
  'row.path.label': 'Git Bash 路径',
  'row.path.placeholder': '例如 C:/Program Files/Git/bin/bash.exe',
  'row.path.none': '尚未选择',
  'row.path.missing': '还没选 Git Bash 路径：点「自动发现」扫一遍，或直接填一个 bash.exe 的绝对路径。',
  'row.discover': '自动发现',
  'row.discovering': '正在扫描…',
  'row.foundNone': '没有找到任何 Git Bash（既不是 Git for Windows，也不是 MSYS2/Cygwin）。',
  'row.newSession': '更改对新会话生效（运行中的会话保持启动时的选择）。',
  'row.notSupported': '当前版本不支持自动切换：{reason}',
  'row.saveFailed': '保存失败：{message}',
  'row.rejected': '宿主拒绝了这次保存（revision 冲突或字段不可编辑），请刷新后重试。',
  'row.unavailable': '宿主设置服务不可用（设置无法保存）。',
}

export const en: Dictionary = {
  'row.title': 'Terminal tool',
  'row.dialect.pwsh': 'PowerShell (pwsh)',
  'row.dialect.bash': 'Git Bash (bash)',
  'row.path.label': 'Git Bash path',
  'row.path.placeholder': 'e.g. C:/Program Files/Git/bin/bash.exe',
  'row.path.none': 'not chosen yet',
  'row.path.missing': 'No Git Bash path yet: click "Auto-detect", or type the absolute path to a bash.exe.',
  'row.discover': 'Auto-detect',
  'row.discovering': 'Scanning…',
  'row.foundNone': 'No Git Bash found (neither Git for Windows nor MSYS2/Cygwin).',
  'row.newSession': 'Changes apply to new sessions (running sessions keep the shell they started with).',
  'row.notSupported': 'Not supported by this DSH version: {reason}',
  'row.saveFailed': 'Save failed: {message}',
  'row.rejected': 'The host rejected this save (revision conflict or a non-editable field). Refresh and retry.',
  'row.unavailable': 'Host settings service unavailable (settings cannot be saved).',
}
