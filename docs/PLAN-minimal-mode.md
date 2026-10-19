# 设计与实施单：极简模式终端选项（M2 / M3）

- 状态：**M2 已实施（0.5.0）**；M3 未开始（方案见 §11，等下一轮）
- 目标版本：M2 → `0.5.0`；M3 → `0.6.0`（分两轮，见 §11）
- 关联：M1（受限沙箱策略 `confinedPolicy`，`0.4.1`，commit `2946e3b`）
- 基线事实：DSH `0.2.1-rc.2`；本插件 `engines.dsh ">=0.2.1-rc.2 <0.3.0"`

---

## 0. 结论摘要

1. 设置页「终端工具」行新增第 4 行 **「极简模式」**，选项三项：
   `不处理（leave）` / `一次性替换（oneshot，默认，= 现状）` / `提供新预设变体（variant）`。
   字段为 volatile（设置页只能写 volatile 字段），写入后**不重挂载**，靠
   `loader/volatile-update` 事件做副作用。
2. 选项 `variant` 的语义按用户原话精确实现：**对 `minimal` 会话不处理**（保留官方持久 PowerShell），
   同时在 Host 侧注册一个预设变体 `minimal-gitbash`（= 官方 `minimal` 的完整克隆，只把
   持久 PowerShell 两行换成持久 Git Bash）。变体**仅在选中该项时注册**，取消选择即进入注销流程；
   注销受第 4 条约束。
3. 持久 Git Bash 由新的子入口 **`dsh-terminal-tool/pty`** 提供：复用官方
   `@deepseek-ai/dsh-terminal-bash` 的 `BashTerminalBackend`，通过它的第三个构造参数注入
   `spawnTerminal`，把「受限档位下被沙箱包装的 argv」换回 `[git-bash, …args]`——
   官方 fence / PTY 会话 / 启动握手 / 提示符逻辑全部保留，只替换「是否受文件沙箱」这一层。
   该行必须挂在变体预设的 `persistent-shell` 组（`isolate: { terminals: true }`）内，
   否则 `mountPreset` 会以 `Preset services require isolate realms` 失败。
4. **关键冲突（必须让步）**：注销预设定义会让**任何仍引用该 id 的持久会话无法再打开**
   （resume 读投影 → `agent-presets.register` 的 `resolve` 抛 `agent-preset/not-found`，
   被会话控制器压成不透明的 `gateway/internal`，且官方**没有删除会话的 API**，引用永不过期）。
   因此「不选就立刻删除」不可行，改为**引用安全的注销**（§4.3）：有引用时保留，
   无引用才注销；启动时若发现历史引用则补注册，让旧会话仍能恢复。
5. 与官方 `@deepseek-ai/dsh-experimental-terminal-bundle` **互不干扰**（不同 isolate realm、
   不同工具名），本轮不改它；「给它补 Git Bash 后端」列为 M3 可选增强（§7）。
6. 受限沙箱档位下持久 Git Bash 仍**物理不可用**（MSYS 死在 spawn 前，M1 已实测）；
   变体在 `unconfined` 下可用，`escalate`/`fail` 下按 M1 的 `planLaunch` 报错并给文案。

---

## 1. 背景：Windows「极简模式」到底是什么

官方 shipped `minimal` 预设（asar 内 `@deepseek-ai/dsh-web-app/presets/minimal.patch.yml`）的
`persistent-shell` 组（`isolate: { terminals: true }`）内容：

| 行 id | 包 | win32 行为 | 提供 |
|---|---|---|---|
| `pty` | `@deepseek-ai/dsh-terminal` | 启用 | 本组的 `terminals` 服务 |
| `terminal-bash` | `@deepseek-ai/dsh-terminal-bash` | `disabled`（`!!js process.platform === 'win32'`） | POSIX 持久 bash 后端 |
| `persistent-bash` | `@deepseek-ai/dsh-tool-bash-persistent` | `disabled`（同上） | 工具名 `bash`（持久） |
| `terminal-pwsh` | `@deepseek-ai/dsh-terminal-bash`（`shellDialect: pwsh`） | 启用 | win32 持久 pwsh 后端 |
| `persistent-pwsh` | `@deepseek-ai/dsh-tool-pwsh-persistent` | 启用 | 工具名 `pwsh`（持久） |

即：**Windows 极简模式当前 = 持久 PowerShell**（工具名 `pwsh`），而 POSIX 极简模式 = 持久 bash。

本插件 `0.4.x` 的行为：在 `agent/created` 里给每个需要 bash 的会话挂**一次性** Git Bash
（`dsh-tool-bash`），并把继承来的 `pwsh` 工具隐藏。对 `minimal` 会话的后果：
官方持久 pwsh 被换成一次性 bash——**状态不再跨调用**，与「极简模式」的原意相反
（README:270、DESIGN:501 已列为已知限制）。

三个选项就是对「minimal 会话该怎么办」的三种回答。

---

## 2. 三选项语义矩阵（精确）

`minimalMode` 只影响 **`agentPreset === 'minimal'`** 的会话；`standard` / `ptc` / 用户自建预设
在任何选项下都保持现状（一次性替换）。

| 选项 | `minimal` 会话的工具 | 变体是否注册 | `minimal-gitbash` 会话 | 备注 |
|---|---|---|---|---|
| `leave` | 官方持久 `pwsh`（不动） | 否 | 不存在 | 与官方行为完全一致 |
| `oneshot`（默认） | 一次性 `bash`（隐藏 `pwsh`） | 否 | 不存在 | = `0.4.x` 现状 |
| `variant` | 官方持久 `pwsh`（不动，同 `leave`） | 是（受 §4.3 引用保护） | 持久 `bash`（后台是 Git Bash） | 要得到持久 Git Bash，用户需在**新建会话**时选这个变体 |

三条补充规则：

1. `variant` 选项**不改变默认预设**，也不替用户选会话。它只负责「把变体放进预设名册」。
   文案必须写明这一点（见 §8）。
2. 变体不可用时（找不到 Git Bash / 受限档位拒绝 / 构造失败），**不静默回落成 `oneshot`**：
   宿主回到 `leave` 语义（minimal 会话保持官方持久 pwsh），设置行显示失败原因。
   理由：静默回落在用户看来就是「设置了却没生效」。
3. 选项只对**新会话**生效（composition 是启动快照，与 `0.4.x` 相同）。

判定用 `ctx.sessionProjections.stateOf(agent.session, 'agentPreset')`（`0.2.1-rc.2` 已提供
`agentPreset` 投影；`SessionHeader.agentPreset` 是深冻结的创建事实，`select()` 切换后不重写，
所以**必须读投影**）。

`src/replace.ts` 里新增早退分支（顺序在 `already-replaced` 之前，**先判变体再判选项**）：

```ts
const preset = optional<SessionProjections>(agentCtx, 'sessionProjections')
  ?.stateOf(agent.session, 'agentPreset')
if (preset === 'minimal-gitbash') {
  return skip(id, 'already-replaced')      // 变体自己带持久 bash，无需替换
}
if (preset === 'minimal' &&
    (snapshot.minimalMode === 'leave' || snapshot.minimalMode === 'variant')) {
  return skip(id, 'minimal-left')          // 新增 SkipReason：把官方持久终端留给它
}
```

---

## 3. 配置面

`src/config.ts` 新增一个 volatile 叶（**必须逐叶 `.volatile()`**，否则设置页投影不到）：

```ts
export type MinimalMode = 'leave' | 'oneshot' | 'variant'

minimalMode: z.union(['leave', 'oneshot', 'variant'] as const)
  .default('oneshot')
  .volatile(),
```

同步改动：`RawConfig`、`ConfigSnapshot`、`readMinimalMode()`（非法值回落到 `'oneshot'`，
与 `readConfinedPolicy` 同风格）、`snapshotConfig()`。

为什么默认 `oneshot`：保持 `0.4.x` 行为不变（升级不改变现有会话形态）。
决策点 D3 见 §12。

---

## 4. Host 侧：变体的生成与生命周期

### 4.1 从哪里拿变体的行数组

官方没有「只改 CLI 参数」的 API，**必须给完整 `plugins: EntryRow[]`**。三个来源比较：

| 来源 | 结论 |
|---|---|
| 复制一份硬编码行数组到源码 | 简单，但官方 minimal 一变就静默漂移（新增工具行会丢） |
| **运行时 `ctx.agentPresets.readDocument('minimal')` 取 YAML → 解析 → 变异**（推荐） | 始终跟随官方 shipped 版本；`readDocument` 是 `@Remote` 公开方法 |
| 反射内部 `definitions` Map | 私有字段，不做 |

`readDocument` 返回的是 `dump(plugins, { schema: entryListSchema, noRefs: true, lineWidth: -1 })`
的 YAML 文本（**只含 plugins 数组，不含 `insert:` 外层**）。解析必须用带 `!!js` tag 的 schema
（`@deepseek-ai/cordis-plugin-include` 导出 `entryListSchema`；也可自建等价 7 行）：

```ts
// 与官方 cordis-plugin-include/lib/index.js:15-28 逐字等价
import { JSON_SCHEMA, Type, load, dump } from 'js-yaml'
const JsExpr = new Type('tag:yaml.org,2002:js', {
  kind: 'scalar',
  resolve: (data) => typeof data === 'string',
  construct: (data) => ({ __jsExpr: data }),
  // 必须有 predicate（= 官方 isJsExpr：`v instanceof Object && '__jsExpr' in v`），
  // 否则 dump 把 !!js 写成普通映射 {__jsExpr: ...}，静默丢标签
  predicate: (v) => v instanceof Object && '__jsExpr' in v,
  represent: (data) => data['__jsExpr'],
})
export const entryListSchema = JSON_SCHEMA.extend(JsExpr)
```

依赖策略（决策点 D5）：把 `js-yaml` 加进 `dependencies`（`^4.1.0`）并在 `build.mjs` 的
`external` 里追加 `js-yaml`（现在能裸 import 只是因为它是 `cordis-plugin-include` 的
传递依赖被 hoist，属偶然）。实测：`load → dump → load` 与官方文本 deep-equal，
`!!js` 原样往返（含含引号的表达式）、`|-` 多行块保真、`noRefs` 消除锚点；
js-yaml 4.3.2 的 ESM 入口提供 `JSON_SCHEMA` / `Type` / `load` / `dump` 具名导出。
变异前先 `structuredClone(plugins)`（官方 `applyEntryPatches` 同款），避免污染 registry 缓存对象。

> 备选：把 js-yaml 打进 bundle（实测 +101.6 KiB 未压缩，minify 后 +42.6 KiB）。
> 选依赖而非内联，理由与 schemastery 相同：profile 从 GitHub 安装时会装 `dependencies`。

### 4.2 变异规则（唯一一份，写进 `src/preset.ts` 纯函数）

```ts
// cloneMinimalForGitBash(plugins, { bashPath, shellArgs, loginShell,
//   pythonUtf8, pathEntries, confinedPolicy }) => EntryRow[]
```

1. `persistent-shell.config` 数组里删除 `id: terminal-pwsh`、`id: persistent-pwsh`；
2. 找到 `id: persistent-bash`：删除 `disabled` 键（win32 上要启用），
   设 `config.backendType = 'gitbash'`，保留 `config.timeoutMs = 300000` 与官方 description；
3. 在 `id: pty` 之后插入一行：

   ```yaml
   - id: gitbash-pty
     name: dsh-terminal-tool/pty
     config:
       backendType: gitbash
       bashPath: C:/Program Files/Git/bin/bash.exe
       confinedPolicy: unconfined
       pythonUtf8: true
   ```

4. 其余行（`persona` / `tool-fs` / `compaction` 组 / `pty` / `terminal-bash`）原样保留；
   `terminal-bash` 保留（win32 上仍 `disabled`），让变体在行结构上仍是「minimal + 一个后端替换」。

定义本身：

```ts
{ id: 'minimal-gitbash', name: '极简模式 · Git Bash', order: 3.1,
  description: 'minimal 预设的持久 Git Bash 版本：一个 bash 工具，跨调用保持状态。',
  plugins }
```

- 变体 id 必须与官方 `minimal` **不同**（否则 `register` 抛 `Duplicate agent preset: minimal`）。
- `order` 用小数：官方 `standard=1`、`ptc=2`、`minimal=3`，变体 `3.1` 紧随其后。
- `name`/`description` 官方 UI **不做本地化**（非内置 id 直接显示 `name ?? id`），
  所以写中文即可；英文用户看到中文属于可接受偏差（决策点 D2）。

### 4.3 注册时机与注销条件（本方案最容易做错的地方）

**容易搞混的两条路径**（已逐一核到源码）：

- `register()` → `activate()` → `mountPreset()`：**不等宿主 Loader 树**。它只
  `await ctx.fiber.await()`（新建 scope 的 no-op fiber）与私有 `PresetTree.root.update()`；
  `PresetTree` 不在宿主 `loader.await()` 的 `getTasks()` 里。
  → **在 `apply()` 里直接 `await register()` 不会死锁**，官方 `@deepseek-ai/dsh-agent-preset`
  就是这么做的（`static [Service.init]() { yield await this.ctx.agentPresets.register(this.config) }`）。
- `diagnostic()`（`list` / `resolve` / `retain` / `mount` / `select` 都会走）：
  当 mount 里还有 pending 行时会 `await this.owner.loader.await()` —— 等整棵宿主 Loader 树
  settle。**在宿主行自己的 activation 里调这条路径 = 等自己 = 死锁**
  （registry 源码注释："Callers therefore must not run inside a Host row's own activation,
  which the settlement would wait on."）。

**结论**：注册可以在 activation 期做，**校验/查询必须等 activation 返回之后**。

**做法**：用 `ctx.inject(['agentPresets'], …)` 拿到一个匿名 fiber（不在 loader 任务集里，
天然免疫行序），在里面注册并把 disposer 交给 fiber：

```ts
// src/preset.ts
export function mountVariant(ctx: Context, spec: VariantSpec): void {
  ctx.inject(['agentPresets'], (child) => {
    const pending = child.ctx.agentPresets.register(definition)
    child.effect(() => async () => {
      const unregister = await pending            // activate 从不 reject，只有 broken
      await unregister()                          // 幂等
    }, 'terminal-tool.variant')
  })
}
```

**校验**（不能假设注册成功：mount 失败被吞进 `record.broken`，register 照样 resolve）：
在 activation 返回后调一次 `agentPresets.list()`，看变体条目有没有 `broken`；有则状态置
`failed` 并把 `broken` 文案透到行内。首个触发点是第一次 `POST /state`（设置行挂载），
不需要定时器：没有设置页打开时也没人需要看这个状态。

`ensureVariant()` 内部状态机（模块级，单例）：

```
absent --(bash 可用 && (minimalMode===variant || needsRepair()))--> registering
registering --register ok & list() 无 broken--> registered
registering --register 抛错 / broken--> failed（记录 reason，行内显示；不回退 oneshot）
registered --(minimalMode!==variant 且无引用)--> unregistering --> absent
registered --(bashPath / confinedPolicy 变)--> 就地重建（先 unregister 再 register，同 id）
registered --(仍有引用)--> retained（保留，行内提示「N 个会话引用中」）
```

> 注意「就地重建」要谨慎：注销后立即重注册同 id，旧 generation 会被 `retired` 但**不会立刻释放**
> （`collect()` 在 `users !== 0` 时直接返回），活会话仍跑旧组合。因此**仅在 `bashPath` 这类
> 真正影响启动的字段变化时才重建**，并且重建后必须提示「已在运行的会话不受影响」。更好的是
> 让变体行的 `bashPath` 在 mount 时由 `discoverBash` 现取，配置变化只影响下次注册（M2 采用后者）。

**硬约束 B：注销会让引用它的持久会话再也打不开。**
resume 链路：`presetForObservation(observation)` 取投影 → `composeAgent(id)` →
`(await presets.resolve(id)).id`。定义不存在 → `RemoteError('agent-preset/not-found')`
→ 控制器 catch 压成 `RemoteError('gateway/internal', 'resume failed for session "…"')`
（用户在界面上只看到「会话打不开」）。且官方**没有删除会话 API**，引用永不过期。

因此注销判定：

```ts
function variantReferences(ctx: Context): { live: number; persisted: number } {
  // 1) live：ctx.get('sessions')?.list()，读 sessionProjections.stateOf(s, 'agentPreset')
  //    （投影，不是 header —— select() 切换后 header 不重写）
  // 2) 持久：ctx.get('sessionQuery')?.listSessions()，读每条 record.header.agentPreset
  //    sessionQuery 可能不存在（部署没挂 session-query 包）→ 按可选处理，退回只查 live
  //    漏报：blank 期用 select() 切过来的会话只追加事件、不改 header
}
```

- 有任何引用 → **保留**（`retained`），设置行显示「变体保留：仍有 N 个会话引用，删掉会让它们打不开」；
- 无引用 → 立即注销（满足「不选就删」的用户预期）；
- 启动时 `minimalMode !== 'variant'` 但 `variantReferences()` 命中 `minimal-gitbash`
  → **静默补注册**（`retained` 状态，行内说明原因），否则老会话变砖。
  这是对「只在选中时存在」的唯一让步，理由是官方语义硬约束（决策点 D1：可改为「不修复」，
  代价是切回 `oneshot`/`leave` 后旧变体会话永久打不开）。

`unregister()` 的语义已核实：幂等；`collect()` 只在 `retired && users === 0` 时真正 dispose
scope，所以**注销不会打断正在使用该变体的活动会话**（它们继续跑，只是不能再 resume）。
另外 `unregister()` 之后 `record.ready` 仍会被 await，且 mount 失败从不上抛——所以
**注销前后都要用 `list()`/`resolve()` 观察真实状态**，不能只看 promise 是否 resolve。

### 4.4 与「一次性替换」的交叉

- 变体会话：`agent/created` 时 `tools.get('bash', agent) !== undefined` → 自然 skip
  （变体已带持久 bash），另外按 §2 显式记 `already-replaced`。
- `minimal` 会话在 `variant` 选项下：skip（`minimal-left`），不碰官方 pwsh。
- 诊断日志新增 `SkipReason: 'minimal-left'`；`ReplaceReport.reason` 原样透出到 `/state`。

---

## 5. 持久 Git Bash 后端：`dsh-terminal-tool/pty`

### 5.1 为什么是「注入 spawnTerminal」而不是子类重写

官方 `BashTerminalBackend`（`@deepseek-ai/dsh-terminal-bash`）：

```js
constructor(ctx, config,
  spawnTerminal = (spec) => ctx.subprocess.spawnTerminal(spec),
  createSession = (terminal, config) => new LocalPtySession(terminal, config))
```

`spawn()` 内部顺序：`ensureSandboxModeFence` → `sandboxPolicy.resolve` →
`spawnArgv`（danger-full-access 直接返回 `[shellPath,…shellArgs]`，否则 `sandbox.confine` 包装）
→ `spawnTerminal({argv, cwd, env, …})` → `startupSession`。

若子类重写 `spawn()`，需要照抄 `spawnArgv` / `ensureSandboxModeFence` / `startupSession` /
`rejectAfterStartupCleanup` / `childEnvironment` 五个私有函数（约 100 行）；
**注入第三个构造参数**只需换掉最后一步：

```ts
const backend = new BashTerminalBackend(ctx, resolved, (spec) => {
  const plan = planLaunch({ hasSandbox, policyMode, choice: confinedPolicy, platform: 'win32' })
  if (plan.kind === 'direct') {
    // 丢弃受限档位的沙箱包装，恢复原始 argv
    return ctx.subprocess.spawnTerminal({ ...spec, argv: [resolved.shellPath, ...resolved.shellArgs] })
  }
  // 注意构造签名是 (mode, detail)，不是 (reason)
  if (plan.kind === 'fail') throw new SandboxUnavailableError(policy.mode, plan.reason)
  return ctx.subprocess.spawnTerminal(spec)        // confine：保留官方包装
})
ctx.terminals.registerBackend(backend)
```

保留的官方行为：沙箱档位 fence（持久会话开着时禁止切档位）、`LocalPtySession` 的
xterm headless 状态机、`initialize()` 的 prompt 握手、`childEnvironment` 的
`TERM=dumb` / `PS1=dsh> ` / `PROMPT_COMMAND` 退出码标记、`DSH_*` 环境。

`spawnTerminal` 收到的 spec 只有 `{argv, cwd, env, rows, cols, terminalType:'dumb',
graceMs, signal}`（官方 `spawn()` 里逐字段现造，不转发 `owner`/`sessionId`）——
注入实现只应改 `argv`，**不要**期待能拿到会话身份。
即：**持久 Git Bash 与「一次性 Git Bash」共用同一个 `planLaunch` 决策表与同一套诊断**。

### 5.2 挂载位置

`src/pty.ts` → `lib/pty.js`，作为独立入口（**不能让 `lib/index.js` 静态 import 它**，
否则没装实验 bundle 的机器上根插件会因缺 `dsh-terminal-bash` 加载失败）：

- `package.json`：`exports['./pty'] = { types: './lib/types/pty.d.ts', default: './lib/pty.js' }`；
  `files` 加 `lib/pty.js`/`.map`；
- `build.mjs`：新增第 4 段 esbuild（esm/node），`external` 追加
  `@deepseek-ai/dsh-terminal-bash`、`@deepseek-ai/dsh-terminal`、`@deepseek-ai/dsh-sandbox`；
- 依赖面：`@deepseek-ai/dsh-terminal-bash` 进 **peerDependencies**（宿主提供，与现有 6 个 peer 同风格）
  + **devDependencies**（取类型）；`engines.dsh` 决定预检，不因 peer 缺包被静态禁用；
- 该行只能出现在变体预设的 `persistent-shell` 组内（`isolate: { terminals: true }`），
  组内按行序挂载：`pty` 先提供 `terminals`，我们后注册后端。

### 5.3 配置

```ts
// lib/pty.js 的 Config（schemastery）
{ backendType: 'gitbash', bashPath: string(必填), shellArgs?: string[],
  loginShell: boolean, pythonUtf8: boolean, pathEntries: string[],
  confinedPolicy: 'unconfined'|'escalate'|'fail' }
```

`shellArgs` 默认 `['--noprofile','--norc','-i']`（与官方 `DEFAULT_BASH_ARGS` 一致）；
`bashPath` 由根插件在生成变体行时用**当前发现的 Git Bash 绝对路径**填入（volatile 改了要重建变体）。

### 5.4 沙箱语义（沿用 M1，写清楚不假装）

| `confinedPolicy` | 变体在 win32 的持久 Git Bash |
|---|---|
| `unconfined`（默认） | 可启动；`spawnTerminal` 直接拿原始 argv，**不经文件沙箱**（与一次性 bash 的 direct 分支同义） |
| `escalate` | 尝试受限启动 → MSYS 在 spawn 前就 `0xC0000022` 崩溃；**终端工具没有 `sandbox_permissions` 升级通道**，所以升级不可达。行为：走官方 confine 路径并透出明确错误 |
| `fail` | 直接抛 `SandboxUnavailableError`，理由是 M1 的 `unavailableReason` |

持久终端**没有被官方包暴露升级通道**（`dsh-tool-bash-persistent` 没有 `sandbox_permissions`
参数），这一点必须在 README 里写明，不能让人以为 `escalate` 能给终端用。

---

## 6. 客户端（设置行）

在现有「终端工具」item 内新增第 4 行（沿用第 3 行「受限沙箱策略」的排版：`tterm-row` +
`tterm-field-label` + `tterm-field-description` + 官方 `Menu` 选择器）：

```
行标题：极简模式
行描述：选择如何处理 minimal 预设（Windows 上它是持久 PowerShell）。
选择器：[ 不处理（保留持久 PowerShell） ▾ ]
         · 不处理（保留持久 PowerShell）
         · 一次性终端替换（当前行为）
         · 提供 Git Bash 预设变体（需在新建会话时选择）
提示（随选项/状态变化）：
  leave    → 官方行为不变：极简模式继续使用持久 PowerShell。
  oneshot  → 极简模式会话得到一次性 Git Bash，跨调用状态不保留。
  variant  → 已注册预设「极简模式 · Git Bash」；新建会话时在预设里选它。
             仍有 2 个会话引用该变体，暂不删除（删掉它们将无法恢复）。
             变体注册失败：<reason>
```

- `store.ts`：`RowState` 增加 `minimalMode: MinimalMode`、`variantState:
  'absent'|'registered'|'retained'|'failed'`、`variantReason?: string`、`variantRefs: number`；
  `RowController` 增加 `setMinimalMode(mode)`；写入用 `[{op:'set', path:['minimalMode'], value}]`。
- `/state`（`StateView`）增加 `minimalMode`、`variant: { state, id, reason?, refs }`；
  **不新增路由**（注册动作在 Host 侧，客户端只读状态）。
- locale：新增 `row.minimal.label/.description/.leave/.oneshot/.variant` 与
  `row.minimal.hint.{leave,oneshot,variant,variantRetained,variantFailed}`，
  zh/en 各 10 条（`contractcheck` 会校验成对）。
- `styles.ts` 不需要新增类（复用 `tterm-row` / `tterm-selector`）。
- 已知体验缺口：官方预设名册只在**界面重新挂载**时重拉（`ctx.remote.agentPresets.list()`），
  所以注册变体后，已打开的新建会话界面不会立刻出现它；文案提示「重开新建会话界面即可见」。
  M3 再研究刷新钩子（§11）。

---

## 7. 与官方 `@deepseek-ai/dsh-experimental-terminal-bundle` 的关系

事实：该 bundle = `optional-persistent-terminals` 组（`isolate: { terminals: true }`）+
`@deepseek-ai/dsh-terminal` + `@deepseek-ai/dsh-terminal-bash`（win32 用 pwsh）+
`@deepseek-ai/dsh-tool-terminal`（工具 `terminal_open/send/read/signal/close/list`）。
它给**所有预设**（含 minimal）加全局 `terminal_*` 工具，Win 上后端是 pwsh。

本方案的处理：

| 场景 | 行为 |
|---|---|
| bundle 未装 / 未启用 | 与现状一致；变体自带 `terminals` 组，不依赖 bundle |
| bundle 已启用 | 两套终端并存、互不感知：`terminal_*` 仍是 pwsh；变体会话的 `bash` 是持久 Git Bash。工具名不冲突 |
| 是否接管 `terminal_*` 的后端 | **本轮不做**。可选 M3 增强：在 profile patch 里向 `optional-persistent-terminals` 组 `insert` 我们的 pty 行（`applyEntryPatches` 支持向已有组追加行，id 不存在时 warn+skip 安全降级），让 `terminal_open {type:'gitbash'}` 可用。需要额外验证「profile 层 patch 能否命中 bundle 插入的行」与「bundle 先挂载」 |

变体 id `minimal-gitbash` 属于本插件的保留命名；若第三方（如 `dsh-gitbash-shell`）注册同名，
`register` 会抛 `Duplicate agent preset`，我们捕获后按 `failed` 展示（不崩插件）。

---

## 8. 文案（文案风格沿用官方：短句、动宾、无营销词）

| locale 键 | zh | en |
|---|---|---|
| `row.minimal.label` | 极简模式 | Minimal mode |
| `row.minimal.description` | 选择如何处理 minimal 预设的终端。 | Choose how the minimal preset gets its shell. |
| `row.minimal.leave` | 不处理（保留持久 PowerShell） | Leave it (persistent PowerShell) |
| `row.minimal.oneshot` | 一次性终端替换 | Replace with a one-shot shell |
| `row.minimal.variant` | 提供 Git Bash 预设变体 | Offer a Git Bash preset variant |
| `row.minimal.hint.leave` | 官方行为不变：极简模式继续使用持久 PowerShell。 | Unchanged: the minimal preset keeps its persistent PowerShell. |
| `row.minimal.hint.oneshot` | 极简模式会话得到一次性 Git Bash，跨调用状态不保留。 | The minimal preset gets a one-shot Git Bash; state does not persist. |
| `row.minimal.hint.variant` | 已注册「极简模式 · Git Bash」；新建会话时选择它即可。 | Registered "Minimal · Git Bash"; pick it when starting a session. |
| `row.minimal.hint.variantRetained` | 仍有 {count} 个会话引用该变体，暂不删除。 | {count} session(s) still reference the variant, so it is kept. |
| `row.minimal.hint.variantFailed` | 变体注册失败：{reason} | Variant registration failed: {reason} |

---

## 9. 文件改动清单

### A. Host（M2）

| 文件 | 改动 |
|---|---|
| `src/config.ts` | 新增 `MinimalMode`、`minimalMode` 叶、`readMinimalMode`、`ConfigSnapshot.minimalMode` |
| `src/preset.ts`（新） | `cloneMinimalForGitBash()`（纯函数）+ `createVariantManager()`（`ensureVariant` / `syncMode` / 引用检查 / 状态机）；只依赖注入进来的 `agentPresets`、`sessionQuery`、`sessions`、`discoverBash` |
| `src/pty.ts`（新） | 持久 Git Bash 后端插件：resolve config → 构造 `BashTerminalBackend`（注入 `spawnTerminal`）→ `ctx.terminals.registerBackend` |
| `src/index.ts` | apply 接线：`loader/volatile-update` 监听、`agent/created` 前 ensure、`/state` 前 ensure、首次 `list()` 校验（activation 返回后）；导出 `minimalModeOf` |
| `src/replace.ts` | §2 的早退分支 + `SkipReason: 'minimal-left'` |
| `src/routes.ts` | `RouteDeps` 增 `variantState`；`StateView` 透出 `minimalMode` / `variant` |
| `src/shared/protocol.ts` | `MinimalMode`、`VariantStateView`、`StateView` 两个新字段 |
| `src/diag.ts` | `SkipReason` 加 `'minimal-left'` |
| `build.mjs` | 第 4 段（`src/pty.ts`）、external 追加、d.ts 生成追加 `pty.d.ts` |
| `package.json` | `exports['./pty']`、`files` 追加 `lib/pty.*`、`dependencies` 加 `js-yaml`、peer 加 `dsh-terminal-bash`、devDeps 加 `js-yaml`/`@deepseek-ai/dsh-terminal-bash` |

### B. 客户端（M2）

`src/client/types.ts`（`TerminalToolValues.minimalMode`）、`store.ts`（state/controller/写入）、
`row.tsx`（第 4 行 + 提示）、`locales.ts`（10 条 zh/en）。

### C. 测试

| 文件 | 新增 |
|---|---|
| `scripts/selftest.mjs` | `cloneMinimalForGitBash` 变异断言（行数、删掉的两行、`backendType`、插入位置）；`readMinimalMode` 回落 |
| `scripts/integration.mjs` | fake `agentPresets`（记录 register/unregister、`list` 返回名册）+ fake `sessions`/`sessionQuery`：①`variant` → 注册一次；幂等；②有引用时切走 → 不注销（`retained`）；③无引用 → 注销；④启动修复；⑤`fail` 时不静默回落 |
| `scripts/rowselftest.mjs` | 三选项渲染/回调 → 断言 `mutate` ops；`variantFailed` 提示 |
| `scripts/rendertest.mjs` | 第 4 行存在、菜单三项、提示文案随状态切换 |
| `scripts/contractcheck.mjs` | 新增 locale 键成对、`Config` 新字段、`StateView` 新字段与 `lib/types` 一致 |
| 可选真机 | `DSH_TERMINAL_TOOL_PTY_E2E=1` 时才跑：真注册变体、创建 `minimal-gitbash` 会话、`cd /tmp && pwd` 验证跨调用状态 |

### D. 文档

`README.md`（新章节「极简模式」三选项 + 已知限制改写 + 与持久终端 bundle 的关系更新）、
`docs/DESIGN.md`（§1.2 能力表加 F16；§2 新增「运行时预设变体」原则；§5 生命周期加变体状态机；
§8 降级表加变体失败；§11/§12 更新）、本文。

---

## 10. 风险与不做的

**风险**

1. **官方 minimal 漂移**：`readDocument` 解析失败或行结构不符合预期 → 变体 `failed`，
   不注册、不崩插件，行内报原因（M2 必须有这条兜底测试）。
2. **注销语义残余风险**：blank 期用 `select()` 切到变体的会话不改 header，`listSessions()`
   检测不到 → 可能误注销 → 该会话日后打不开。缓解：M2 用 header 扫描（成本低）；
   M3 用 `sessionQuery.observeSession()` 逐会话重放（准确但贵）。
3. **注册与查询的时序纪律**：注册可在 activation 期（`ctx.inject` 子 fiber）安全进行，
   但 `list()`/`resolve()`/`retain()`/`select()` 会 `await loader.await()`，**必须等 activation
   返回后**再调（否则整个插件行不 ready）。M2 要在真机确认「首帧设置行能显示变体状态」。
4. **受限档位**：持久 Git Bash 在 `workspace-write` 下仍不可用（物理约束，M1 已证）。
5. **变体行预检**：`dsh-terminal-tool/pty` 作为预设行会走 `prepareProfileEntries` 兼容预检，
   用我们的 `engines.dsh` 判定；若未来 `engines.dsh` 写错会被静默 `disabled`（仅 stderr 一行）。
   测试里要断言变体 `list()` 不返回 `broken`。

**不做**

- 不自动把变体设为默认预设，不自动替用户切换会话预设。
- 不改官方 preset 文件、不写 profile（沿用 M1 的「零全局写入」红线）。
- 不接管 `ctx.shell`、不动实验 bundle 的行。
- 不做 POSIX 支持（插件本身只在 win32 启用）。

---

## 11. 分期：M2 做什么、M3 做什么

### M2（`0.5.0`）——让三种使用方式真正可用

1. 配置字段 `minimalMode` + 三种语义（`leave` / `oneshot` / `variant`）。
2. 变体生成（官方 minimal 克隆 + 变异）与生命周期（懒注册、引用安全注销、启动修复）。
3. 持久 Git Bash 后端 `dsh-terminal-tool/pty`（注入 `spawnTerminal` + `planLaunch` 决策）。
4. 设置行第 4 行 + locale + `/state` 字段。
5. 测试与文档（README/DESIGN/本草图）。
6. 验收：`npm run check` 全绿；真机三选项各跑一次；profile 重装；重启桌面端肉眼验收。

### M3（`0.6.0`）——加固与共存（本轮不做）

M3 不是新功能，**实际意义**是把 M2 里三条「尽力而为」变成「可证明安全 / 可复用」：

1. **引用检测精度**：用 `sessionQuery.observeSession()` 覆盖 blank 期 `select()` 切换的会话，
   把误注销风险降到零；并给设置行加「清理变体」显式按钮（有引用时二次确认 + 明示后果）。
2. **名册刷新**：研究在注册/注销后让官方预设选择器立即刷新（事件通道或重挂载钩子），
   消除「重开界面才可见」。
3. **持久 Git Bash 通用化**：评估把 `dsh-terminal-tool/pty` 作为独立行接入实验 bundle 的
   `optional-persistent-terminals` 组（`terminal_open {type:'gitbash'}`），让持久 Git Bash
   不再只存在于 minimal 变体里——这是「持久化 + 通用」的真正落点。
4. **真机矩阵**：`unconfined` / `escalate` / `fail` × 三种会话（standard / minimal /
   minimal-gitbash）×「切档位 fence」行为，全部实测记录进 DESIGN。
5. **侧栏/其它入口**：评估 `terminal-controller` 行与本插件的关系（避免用户两处配置互相打脸）。

---

## 12. 需要你拍板的决策点

| 编号 | 决策 | 我的建议 |
|---|---|---|
| D1 | 启动时发现「有会话引用变体但选项已切走」→ 补注册（旧会话可恢复）还是不管（旧会话打不开）？ | **补注册**（`retained`），行内说明原因 |
| D2 | 变体显示名：中文「极简模式 · Git Bash」还是英文 `Minimal · Git Bash`？ | 中文（本插件文档与 UI 面向中文用户；官方非内置预设不本地化） |
| D3 | `minimalMode` 默认值：`oneshot`（= 0.4.x 现状）还是 `variant`（更符合「极简模式」本意）？ | **`oneshot`**（升级不改变行为），用户在设置页主动切到 `variant` |
| D4 | 注销时机：无引用就立刻删（体验最贴近「不选就没有」）还是保守到进程退出？ | **无引用立刻删** + 启动修复（D1） |
| D5 | `js-yaml` 走依赖（`dependencies` + external）还是打进 bundle？ | **依赖**（bundle 里重复一份 YAML 解析器没必要；profile 重装会带上） |
| D6 | M2 是否连「实验 bundle 接管」一起做？ | **不连**，M3 再做（需要额外验证 profile patch 命中 bundle 行） |

---

## 13. 实施结果（0.5.0，M2 完成）

决策点按实现落地：

| 编号 | 落地结果 |
|---|---|
| D1 | 补注册：`sync('variant')` 在定义缺失时重建；定义已存在时按 `specSignature()` 判断是否重建 |
| D2 | 变体显示名 `极简模式 · Git Bash`（`order: 3.1`） |
| D3 | `minimalMode` 默认 `oneshot`（升级不改变既有行为） |
| D4 | 无引用立即注销；仍有引用时 `retained`，不销毁定义 |
| D5 | `js-yaml` 进 `dependencies` 并保持 external（不内联进 bundle） |
| D6 | 未接管实验 bundle；`dsh-terminal-tool/pty` 只在变体预设组内注册，M3 再评估接入 |

代码落点：

- `src/preset.ts`（新）：行克隆（`parsePresetRows` / `cloneMinimalForGitBash` / `formatPresetRows`）、`createVariantManager()`（`sync`/`verify`/`release`）、`specSignature()`、引用计数。
- `src/pty.ts`（新）：`dsh-terminal-tool/pty` 入口，复用 `BashTerminalBackend` 并注入 `spawnTerminal`，按 `planLaunch` 决定 direct / confine / fail。
- `src/config.ts` / `src/diag.ts` / `src/shared/protocol.ts` / `src/routes.ts`：`minimalMode` 字段、`minimal-left` 跳过原因、`/state` 的 `minimalMode` 与 `variant`。
- `src/replace.ts`：`presetOf()` 读会话预设，`minimal` + 非 `oneshot` 直接 `minimal-left`；变体会话按 `already-replaced` 跳过。
- `src/index.ts`：`ctx.inject(['agentPresets'], …)` 里首次同步、`loader/volatile-update` 重同步、`ctx.effect` 释放、`/state` 的 `variant` 懒刷新。
- 客户端：`src/client/{types,store,row,locales}.ts(x)` 第 4 行三项下拉与三态提示（`registered` / `retained` / `failed`）。
- `build.mjs` / `package.json`：第 3 个 esbuild 入口 `lib/pty.js`、`exports['./pty']`、可选 peer `@deepseek-ai/dsh-terminal-bash`、`js-yaml` 依赖。

验收：`npm run check` 全绿（contractcheck 17 / clientsmoke 8 / selftest 51 / rowselftest 15 / rendertest 14 / integration 13）。
真机三选项验收与 profile 重装由 Lead 在本轮收尾完成。
