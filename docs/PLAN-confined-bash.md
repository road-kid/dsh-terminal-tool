# 实施单：M1 —— 受限沙箱下让 Git Bash 可用（confinedPolicy）

状态：已实施（M1 完成，测试全绿；M2 见另一会话报告 §5 与 REVIEW 结论）
范围：只做 M1。M2（持久终端 gitbash backend）不在本轮。

## 1. 背景（一句话）

Windows 上 DSH 的受限档位（`read-only` / `workspace-write`）会把子进程降到 Low 完整性，
MSYS2 运行时（`msys-2.0.dll`）初始化命名共享内存时被拒，Git Bash 在命令执行前就崩：
`NtCreateDirectoryObject(\BaseNamedObjects\msys-2.0S5-…): 0xC0000022`，进程退出码
`3221225794`（0xC0000142）。官方 `dsh-bash-local` 是 POSIX-only，插件本来就绕开了它；
本轮只解决「受限档位下怎么处理」这一个问题，不改 `app.asar`、不改官方包。

## 2. 新增配置 `confinedPolicy`

类型：`'unconfined' | 'escalate' | 'fail'`，**默认 `'unconfined'`**（用户已确认）。

| 值 | 语义 | 调用形态 |
| --- | --- | --- |
| `unconfined` | win32 + 受限档位时直接启动 Git Bash，不经沙箱 | 一次调用即成功，命令不受文件沙箱约束 |
| `escalate` | 先按官方方式进入沙箱；失败标 `denied`，模型收到官方升级提示后带 `sandbox_permissions: danger-full-access` 重试并获审批 | 首次失败 + 一次审批往返 |
| `fail` | 直接抛 `SandboxUnavailableError`，错误信息指导用户改配置 | 明确报错，不自动重试 |

**重要**：`escalate` 的审批完全由第一方 `dsh-tool-bash` 负责（`approveEscalation`
在 `execute` 之前调用，批准后以 `danger-full-access` 的 `sandboxPolicy` 进入
`GitBashExecutor.execute`）。插件**不得**自己实现审批，只需把崩溃标成 `denied`。

## 3. 启动决策表（`src/confined.ts` 的 `planLaunch`）

输入：`{ hasSandbox, policyMode, choice, platform }`，输出
`{kind:'confine'} | {kind:'direct'} | {kind:'fail', reason}`：

1. `!hasSandbox || policyMode === undefined` → `direct`
2. `policyMode === 'danger-full-access'` → `direct`（原有行为）
3. `platform !== 'win32'` → `confine`（非 Windows 的 MSYS 在沙箱内正常）
4. win32 + 受限档位：`unconfined`→`direct`；`escalate`→`confine`；`fail`→`fail`

`direct` 的结果事实保持 `sandbox: { mode, denied: false }`（`mode` 取 `policy.mode`，
无 policy 时取 `'danger-full-access'`）。`fail` 抛
`new SandboxUnavailableError(mode, reason)`，reason 形如
`Git Bash cannot start under the ${mode} sandbox on Windows; set confinedPolicy to "unconfined" or retry with sandbox_permissions: danger-full-access`。

## 4. MSYS 死亡签名分类（同一文件）

```ts
export type ConfinedPolicy = 'unconfined' | 'escalate' | 'fail'
export const MSYS_DENIAL_SIGNATURES: readonly string[] = [
  'ntcreatedirectoryobject(\\basenamedobjects\\msys-',
  "couldn't create signal pipe",
]
export const MSYS_DENIAL_EXIT_CODES: readonly number[] = [3221225794, 3221225506]
export function isMsysStartupDenial(exitCode: number | null | undefined, stderr: string): boolean
```

规则：退出码命中任一 `MSYS_DENIAL_EXIT_CODES` → true；否则 stderr 小写后包含任一
`MSYS_DENIAL_SIGNATURES` → true；否则 false。**前台**与**后台**（`onProcessDone`）
两处都按 `matchesSignature(...) || isMsysStartupDenial(...)` 计算 `denied`。

## 5. 文件改动清单

### A. host 核心（`src/confined.ts` 新增，`src/executor.ts`、`src/config.ts`、`src/testing.ts`、`scripts/selftest.mjs`、`scripts/integration.mjs`）

- `src/confined.ts`：导出上表与 `planLaunch`、`LaunchPlan` 类型；纯函数，不 import 运行时值。
- `src/config.ts`：
  - `Config` 增加 `confinedPolicy: z.union(['unconfined','escalate','fail'] as const).default('unconfined').volatile()`（放在 `pythonUtf8` 之后）。所有字段都是逐叶 `.volatile()`，不要嵌套。
  - `RawConfig`、`ConfigSnapshot` 加 `readonly confinedPolicy: ConfinedPolicy`。
  - `snapshotConfig`：`read<string>(source.confinedPolicy, 'unconfined')`，只接受三个合法值，其余回退 `'unconfined'`。
  - `ExecutorArgs` 加 `readonly confinedPolicy: ConfinedPolicy`，`executorConfig()` 透传。
- `src/executor.ts`：
  - `GitBashExecutorConfig` 加 `readonly confinedPolicy?: ConfinedPolicy`，私有 getter `confinedPolicy` 默认 `'unconfined'`。
  - `execute`：用 `planLaunch({ hasSandbox: this.sandbox !== undefined, policyMode: policy?.mode, choice: this.confinedPolicy, platform: process.platform })` 选分支；`confine` 分支保留现状并加 `isMsysStartupDenial`；`direct` 分支即现有无沙箱分支；`fail` 分支抛 `SandboxUnavailableError`。
  - `onProcessDone`：`denied: (!runnerFailed && (matchesSignature(...) || isMsysStartupDenial(process.exitCode, stderr)))`。
- `src/testing.ts`：`export { isMsysStartupDenial, planLaunch, MSYS_DENIAL_EXIT_CODES, MSYS_DENIAL_SIGNATURES } from './confined.ts'` 与 `export type { ConfinedPolicy, LaunchPlan }`。
- `scripts/selftest.mjs`：快照默认值/非法值回退；`isMsysStartupDenial` 表驱动（含真实崩溃 stderr 样本 `fatal error - NtCreateDirectoryObject(\BaseNamedObjects\msys-2.0S5-1888ae32e00d56aa): 0xC0000022` + exit 3221225794）；`planLaunch` 四档矩阵。
- `scripts/integration.mjs`：加「win32 + workspace-write + unconfined 不调用 confine」「escalate 下崩溃被标 denied」用例（用 fake sandbox provider 即可，不依赖真机档位）。

### B. 客户端设置行（`src/client/types.ts`、`src/client/store.ts`、`src/client/row.tsx`、`src/client/locales.ts`、`locale/{zh,en}.json` 不改 meta、`scripts/rendertest.mjs`、`scripts/rowselftest.mjs`、`scripts/contractcheck.mjs`）

- `src/client/types.ts`：`TerminalToolValues` 加 `confinedPolicy?: 'unconfined' | 'escalate' | 'fail'`。
- `src/client/store.ts`：`RowState` 加 `confinedPolicy: ConfinedPolicy`（与 dialect 一起从 form snapshot 同步，默认 `'unconfined'`）；控制器加 `setConfinedPolicy(value)`，写入 `[{ op:'set', path:['confinedPolicy'], value }]`（照抄 `setDialect` 的乐观更新+错误处理）。
- `src/client/row.tsx`：`dialect === 'bash'` 时在路径行之后加一行官方 `PreferenceRow` 式布局：左列 `t('row.confined.label')` + `t('row.confined.description')`（选中 `unconfined` 时额外显示 `t('row.confined.unconfinedNotice')` 作为 hint，`role="note"`），右侧用现有 `Selector` 组件（`className="tterm-dialect"` 同类）显示三项，`onSelect` 调 `controller.setConfinedPolicy`。复用现有 `tterm-row / tterm-text / tterm-field-label / tterm-hint` 类，**不要**新增 CSS 除非必要。
- `src/client/locales.ts`（zh/en 各加以下 6 键，不要删旧键）：

| key | zh | en |
| --- | --- | --- |
| `row.confined.label` | 受限沙箱时 | Under a confined sandbox |
| `row.confined.description` | Windows 沙箱会把命令降到低完整性，Git Bash 无法在其中启动；这里决定怎么处理。 | The Windows sandbox drops commands to low integrity, where Git Bash cannot start; this decides how to handle it. |
| `row.confined.unconfined` | 直接启动（不经沙箱） | Run directly (no sandbox) |
| `row.confined.escalate` | 申请升级后运行 | Run after escalation |
| `row.confined.fail` | 报告错误 | Report an error |
| `row.confined.unconfinedNotice` | 注意：选它之后，模型执行的命令不受文件沙箱限制。 | Note: with this choice, commands the model runs are not file-sandboxed. |


- `scripts/rendertest.mjs`：新增用例「bash row shows the confined-sandbox choice」「choosing a confined policy writes it」（断言文案、默认显示「直接启动（不经沙箱）」、切换后写入 `[{op:'set',path:['confinedPolicy'],value:'escalate'}]`）；确认 pwsh 行不渲染该控件。
- `scripts/rowselftest.mjs`：按需补 store 控制器用例（同步 form 值、乐观更新）。
- `scripts/contractcheck.mjs`：bundle 文案断言补 `row.confined.label` / `row.confined.unconfined` / `row.confined.description`。

### C. 文档（`README.md`、`docs/DESIGN.md`）

- README：功能描述里加 `confinedPolicy` 三种取值与默认 `unconfined`；把「已知限制」中「必须在 danger-full-access 下才能用 Git Bash」改写成新行为（默认直接启动、可选 escalate/fail）；保留并强化「官方能力落地前的临时替代方案」表述；配置表补字段；安全说明写明 `unconfined` 的含义（模型命令不受文件沙箱限制，等于是插件层面的显式选择）。
- DESIGN：§ 能力清单补一条 F15（受限沙箱策略）；§ 关键取舍补 `unconfined` vs 官方升级的选择理由；§ 配置面同步。

## 6. 验收

1. `npx tsc --noEmit` 0 错误。
2. Lead 跑 `npm run check` 全绿（子代理**不要**跑 build/check，避免并发写 `lib/`）。
3. 真机（本机 workspace-write）：切 bash 后直接 `bash -c 'uname -s'` 成功——这是 `unconfined` 默认的直接证据；把设置改成 `escalate` 后首次调用出现
   `[sandbox: file access denied under workspace-write mode]` 与 `[sandbox: escalation available — retry this exact command once with sandbox_permissions: danger-full-access]`，重试成功。
4. 文档与真实行为一致，无「只读路由」「chips」「原生 select」等过时说法。

## 7. 非目标（本轮不做）

- M2 持久终端（`BashTerminalBackend` 子类 / 组内插入补丁）——已有审阅结论，另开一轮。
- 修改官方包、修改 `app.asar`、绕过审批。
- 版本号与提交由 Lead 统一处理。

## 6. 实施结果（0.4.0）

- `npm run check` 全绿：typecheck、build、contractcheck 15、clientsmoke 8、selftest 35、rowselftest 15、rendertest 11、integration 7。
- 额外收紧：`unconfined` 主动直启时结果标 `sandbox.enforcement: partial`，避免调用方误认为边界完整（README「结果事实」与 DESIGN §6 已同步）。
- `build.mjs` 手写声明补 `confinedPolicy`；contractcheck 的 volatile 字段清单与默认值断言已覆盖该字段。
- 三路子代理并行改写（host 核心 / 客户端行 / 文档），Lead 统一复核 diff、重建 lib、跑 check、同步 profile 安装并提交。