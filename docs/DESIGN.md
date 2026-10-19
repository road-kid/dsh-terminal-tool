# dsh-terminal-tool — 设计文档

| 项 | 值 |
|---|---|
| 包名 | `dsh-terminal-tool` |
| 插件 entry id | `terminal-tool` |
| 目标宿主 | DeepSeek Harness `>=0.2.1-rc.2 <0.3.0`（Windows / Desktop profile） |
| 契约基线 | 各第一方包 `lib/types/*.d.ts`（0.2.1-rc.2，npm 实数） |
| 文档状态 | 实现定稿（0.5.0）：新增 `minimalMode` 与 `minimal-gitbash` 预设变体（§13） |

> **临时替代方案**：DSH 还没有内置的「终端 / Git Bash 选择」能力，Windows 上平台组合只提供 PowerShell。**在官方能力落地前，本插件是它的临时替代方案**：复用官方执行器与工具，在 `agent/created` 里把新会话的终端换成 Git Bash；Windows 受限档位下的 `confinedPolicy` 也属于这段临时接线，不改变宿主沙箱本身。**官方提供等价设置后即可停用本插件**——移除 profile 里的插件行并重启，新会话即回到官方终端工具。插件不改 DSH 安装目录、不改任何 preset、不接管全局 `ctx.shell`，配置只落当前 profile 的 patch 层，卸载无残留。

---

## 1. 目标与范围

### 1.1 要解决的问题

DSH 在 Windows 上只组合 PowerShell 执行器：`@deepseek-ai/dsh-base` 的补丁层用平台表达式
把 bash 家族整条关掉（`disabled: !!js process.platform === 'win32'`，覆盖 `bash-sandbox`
与 `tool-bash`），只留 `pwsh-sandbox` / `tool-pwsh`。结果是模型在 Windows 上只看得见
`pwsh` 工具，而用户希望默认用本机 Git Bash。官方尚无等价的「终端选择」设置，所以本插件
是**临时替代品**，目标是在官方能力落地前补上这段接线。

### 1.2 本插件的能力清单

| # | 能力 | 交付方式 |
|---|---|---|
| F1 | Windows 上把模型可见的终端工具从 `pwsh` 换成 `bash` | `tools.restrict({deny:['pwsh']})` + 注入官方 `bash` 工具 |
| F2 | 工具名 `bash`、POSIX 方言描述、`bash -c` 语义 | 直接复用 `@deepseek-ai/dsh-tool-bash` |
| F3 | `pwsh` 从工具目录消失（含 PTC 签名） | `restrict` 走注册表，PTC 渲染同源 |
| F4 | system prompt 的 PowerShell 段被压掉、bash 段到位 | `systemPrompt.section({name:'tool:pwsh', text:''})` + 官方工具自带 `tool:bash` 段 |
| F5 | 终端卡片 / 退出码 pill / 后台 `job_output`·`job_kill` | 官方工具 + 官方 `tool.call.toolview` 的 `bash` 渲染器（已存在） |
| F6 | 沙箱拒绝标记与 `sandbox_permissions` 升级链路 | 复用官方工具 + 我们执行器上报的 `sandbox` 事实 |
| F7 | 前台等满转后台（`promoteOnTimeout`） | 官方工具的 Config 默认值即为 true |
| F8 | 跟随会话当前目录（0.2.1+） | 官方工具的 `workingDirectory` 逻辑 |
| F9 | 设置里可选 `pwsh` / `bash`，可指定 Git Bash 路径 | 本插件 `export const Config`（volatile 字段）→ 第一方 `configForms` 服务 + 自写 `settings.general.item` 行（控件为官方 UI atoms） |
| F10 | 自动发现 Git Bash，硬排除 WSL | 本插件 `discover.ts` |
| F11 | 路径非法时安全降级（会话照旧 pwsh，不半坏） | 替换前置校验，失败只写诊断 |
| F12 | 只对新会话生效 | 每个 `agent/created` 读取一次配置快照 |
| F13 | 诊断日志 | `%TEMP%\dsh-terminal-tool.log`，`DSH_TERMINAL_TOOL_DIAG_FILE` 可改道 |
| F14 | 原生 Windows 程序中文输出乱码缓解 | 注入 `PYTHONIOENCODING=utf-8`（仅当未设置） |
| F15 | 受限沙箱策略：`unconfined` / `escalate` / `fail`，默认 `unconfined` | `src/confined.ts` 的 `planLaunch` + 执行器分支 |
| F16 | 极简模式：`minimalMode` 三值（默认 `oneshot`）；`variant` 下注册 `minimal-gitbash` 预设变体并接持久 Git Bash 后端 | `src/config.ts` 的 `minimalMode` + `src/preset.ts` + `src/pty.ts`（`dsh-terminal-tool/pty` 入口），见 §13 |

### 1.3 明确不做

- 不接管全局 `ctx.shell`，不动 `dsh-base` / 任何 preset 快照，不改 DSH 安装目录。
- 不修改宿主沙箱实现，也不自行实现升级审批：`escalate` 的 `approveEscalation` 仍由第一方 `dsh-tool-bash` 负责，插件只把 MSYS 启动失败标成 `denied`。默认 `unconfined` 会绕过文件沙箱，但这是配置面的显式选择（见 2.4），不是隐式旁路。
- 不改写官方 `minimal` 预设，也不接管官方持久终端注册表。持久 shell 等价物以**新增预设** `minimal-gitbash` 交付（§13），官方定义只读、原样保留；没有会话引用时变体自行注销。

---

## 2. 设计原则：能复用就不重写

第一方在 0.2.1-rc.2 已经提供了这个功能需要的全部积木，缺的只是「在 Windows 上把它们换成
bash 那一套」的接线。因此本项目的每条行为都跑在第一方代码上，自写部分只包含第一方确实
没有的东西。

| 关注点 | 实现方式 |
|---|---|
| bash 工具本体（~65 KB） | **直接挂载官方 `@deepseek-ai/dsh-tool-bash`** |
| 沙箱升级 / 拒绝标记 | 官方工具自带 |
| 受限沙箱启动决策 | 自写 `src/confined.ts`（`planLaunch` / `isMsysStartupDenial`）；审批仍归官方 `tool-bash` |
| 后台任务 / 转后台 / 会话 cwd | 官方工具自带 |
| 工具卡片渲染 | 官方 `tool.call.toolview` 的 `bash` 槽 |
| 执行器（argv 里那把 bash） | **继承官方 `LocalBashExecutor`，只重写 argv / env 与受限启动分支** |
| 类型 | 官方 `.d.ts`（devDependency，精确钉 `0.2.1-rc.2`） |
| 设置 UI | **自写客户端半区**（`src/client/`）：向 `settings.general.item` 注册「终端工具」行；控件全部复用官方 `@deepseek-ai/dsh-client-ui-primitives`（`Button` / `Input` / `Menu` / `IconChevronDownOutlineRegular`） |
| 工具隐藏 / 提示词裁剪 | 官方 `tools.restrict()` / `systemPrompt.section()` |
| 自动发现 | 自写（`discover.ts`，第一方无等价物） |
| 每会话替换编排 | 自写（`replace.ts`，第一方无等价物） |

这套方案成立的前提有四条，均已在本机核实：

1. 第一方包**以 0.2.1-rc.2 发布到 npm 且带完整 `lib/types/*.d.ts`**（已用 `npm pack`
   验证 20 个包），因此可以做真 TypeScript 类型检查，不需要 duck-typing 兜底。
2. 宿主 loader（`dsh-app-boot` 的 profile-resolution interception）**允许 profile 内插件
   静态 `import '@deepseek-ai/dsh-*'`**，且已有活跃第三方插件实证（`dsh-connect-qoder-x`
   首行即 `import { resolveRetryPolicy } from '@deepseek-ai/dsh-llm'`）。
3. 工具卡片渲染器 `tool.call.toolview` 的 `bash` 槽已由第一方提供，注册名为 `bash`
   的工具自动复用官方卡片。
4. **Web shell 以冻结模块表（`PLATFORM_MODULES`）播种官方 UI atoms**：0.2.1-rc.2 起
   `@deepseek-ai/dsh-client-ui-primitives` 和 `react` 一样由页面提供，插件 client bundle
   只需 `require()`，既不必内联副本，也能拿到宿主样式表已经皮肤好的 CSS module 类名。

净效果：自写代码约 1.7 K 行 TS，且每一条行为都跑在第一方代码上，随官方升级而升级。

### 2.1 关键取舍：为什么仍然走 `agent/created` 替换

第一方「把 Windows 的终端换成 bash」有两条路：

- **路线 A（组合层）**：在 bundle patch 里 `disabled: true` 掉 `pwsh-sandbox`，
  改为挂载 bash 执行器 + `tool-bash`。这是最「配置化」的做法，但代价是：
  ① `ctx.shell` 单实例，切换需要**重启**，无法运行期切换；
  ② 只影响 host 平面，preset 快照里逐行写死的 `tool-pwsh`/`tool-bash` 仍在每个 agent
  的 scope 里生效，**四个官方 preset 不会自动跟随**；
  ③ 用户切换回 pwsh 也要重启。
- **路线 B（会话层，本项目采用）**：host 组合保持原样（官方 pwsh 执行器继续服务 hooks /
  内部调用），在 `agent/created` 里对**新会话**做三件事：隐藏 `pwsh`、注入 `bash`、抹掉
  PowerShell 提示词段。

选 B 的理由：它满足「一个开关、所有 preset 自动跟随、不碰 preset 文件、不接管
`ctx.shell`」这组用户可见需求；同时 `tools.restrict` /
`tools.register` / `systemPrompt.section` 都是 `@deepseek-ai/dsh-tools` /
`@deepseek-ai/dsh-system-prompt` 的公开 API（`register(definition): () => void`、
`restrict(filter): () => void` 均有 `restrict` 的作用域语义：只过滤继承层、不影响本层
注册）。代价是两条必然的行为约束：只对新会话生效、`minimal` preset 的持久 shell 需要单独处理（见 §13：它不是一个执行器替换能解决的面，改用预设变体交付）。

### 2.2 关键取舍：`isolate('shell')` 注入 bash 执行器

官方 `bash` 工具通过 `ctx.shell` 取执行器。要在「不接管全局 `ctx.shell`」的前提下让它拿到
Git Bash 执行器，本项目用 cordis 的一等服务隔离：

```js
// cordis Context.isolate(name, label)
const shadow = Object.create(this[symbols.isolate]);
shadow[name] = label ?? Symbol(name);
return this.extend({ [symbols.isolate]: shadow });
```

即：为每个 agent 建一个 `agentCtx.isolate('shell')` 的子上下文，在这个子树里挂我们的执行器
（它 `super(ctx, 'shell')` 注册为子树内的 `ctx.shell`），再在同一子树里挂官方 `tool-bash`。
子树外（host 全局、其它 agent）看到的仍然是官方 pwsh 执行器。机制与官方
`@deepseek-ai/dsh-experimental-terminal-bundle` 的 `isolate: { terminals: true }` 相同
（都是按名取一个全新影子），但隔离的服务名与被隔离的 bundle 不同：那边是 `terminals` 服务
与持久终端后端，这里是 `shell` 执行器。两者互不感知，也不共享影子。

> 实现细节：`isolate(name, label?)` 的 `label` 类型是 `symbol`，不传时 cordis 自己
> `Symbol(name)` 生成一个新 symbol，于是**每次调用得到全新的私有影子**——正是这里要的语义
> （「这个 agent 的执行器，别人看不见」）。因此不需要为每个 agent 拼 label，也没有跨会话
> 复用影子的问题；幂等由 `tools.get('bash', agent)` 探测保证（第二次 install 直接跳过）。

> 落地校验项：`tools.register` 的「注册到哪个 scope」由 ctx 的 agent 归属决定。
> 若从 agent 子树注册仍落到全局层，则第二个 agent 会撞重名；因此实现里**先
> `ctx.tools.get('bash', agent)` 探测**，已可见则跳过注册（设计为幂等），两条路径都安全。

### 2.3 客户端半区：复用官方 UI atoms，而不是自绘控件

设置行最初用手搓的胶囊按钮 / `<input>` / `<select>`。现在改为直接使用第一方
`@deepseek-ai/dsh-client-ui-primitives` 的 `Button` / `Input` / `Menu` /
`IconChevronDownOutlineRegular`，与官方 General 段的 `PreferenceRow` 同源：

- **枚举偏好用官方下拉**：终端类型是一枚 36px 的触发器（`--dsw-radius-md`、
  `--dsw-alias-bg-module-platform`、chevron），点开官方 `Menu`；命中多条候选时，
  路径控件也换成同一套下拉。
- **手填路径用官方 `Input`**，「自动发现」用官方 outline `Button size="sm"`。
- 行的版式仍由 `styles.ts` 提供：两列（标题 14px/20px + 说明 12px/18px，控件居右，
  24px 间距）、16px 纵向内边距、`.5px` 底部分隔线（`--dsw-alias-border-l2`），
  颜色一律走 `--dsw-alias-*` 设计变量。
- **bundle 保持该包 external**：Web shell 把它播种进冻结模块表（`PLATFORM_MODULES`），
  插件 bundle 像 `require('react')` 一样 `require()` 它；内联第二份会复制 CSS module
  类名，宿主样式表就皮肤不到，hooks / 上下文身份也会分裂。
- **它只是 devDependency**：仅用于 TypeScript 类型（精确钉 `0.2.1-rc.2`），运行时由
  宿主提供，插件不安装任何运行时依赖。目标宿主范围为 `>=0.2.1-rc.2 <0.3.0`
  （`engines.dsh`），该范围内 Web shell 都自带这个模块表。

### 2.4 关键取舍：受限档位默认 `unconfined`，而不是一律走官方升级

MSYS2 在 Windows 受限档位下初始化命名共享内存就被拒，这不是偶发失败，而是**每次启动都失败**。因此三种策略的取舍是：

- **`unconfined`（默认）**：win32 + 受限档位时直接启动 Git Bash，一次调用即成功。代价写在明面上：模型执行的命令不受文件沙箱约束。默认选它，是因为不这样受限档位下就没有可用的 Git Bash；设置行会在选中时显示同样的提示，用户可随时改回。
- **`escalate`**：先按官方方式 `ctx.sandbox.confine()`；失败标 `denied`，模型收到官方 denial 提示后带 `sandbox_permissions: danger-full-access` 重试，由第一方 `dsh-tool-bash` 的 `approveEscalation` 审批。保留完整沙箱语义，代价是每次都要首次失败加一次审批往返。
- **`fail`**：抛 `SandboxUnavailableError`，错误信息指导改配置。给需要「宁可不可用也不降级」的环境。

审批不重复实现：`approveEscalation` 在官方工具 `execute` 之前调用，批准后以 `danger-full-access` 的 `sandboxPolicy` 进入 `GitBashExecutor`。插件只负责把 MSYS 崩溃分类成 `denied`，不碰审批，也不修改宿主沙箱实现。非 Windows 或非受限档位不受 `confinedPolicy` 影响。

---

## 3. 架构

```
                 profile cordis.patch.yml (由 plugin_manager 写入)
                 └── insert: terminal-tool  (win32 only, Config)
                              │
   ┌──────────────────────────┴──────────────────────────────┐
   │ src/index.ts  apply(ctx, config)                        │
   │  ├── diag: apply / settings snapshot                    │
   │  ├── ctx.on('agent/created', onAgentCreated)            │
   │  └── 导出面（测试用）: Config, discoverBash, ...         │
   └──────────────────────────┬──────────────────────────────┘
                              │ 每个新会话
                 ┌────────────▼─────────────┐
                 │ src/replace.ts            │
                 │ 读快照 → 校验 → 三步动作   │
                 └───┬────────┬─────────┬────┘
           isolate shell│      │restrict │section
                 ┌──────▼───┐ ┌▼────────┐ ┌▼──────────────┐
                 │executor  │ │tools    │ │systemPrompt   │
                 │(子树)     │ │.restrict│ │.section       │
                 │+官方      │ │deny pwsh│ │tool:pwsh → '' │
                 │tool-bash │ └─────────┘ └───────────────┘
                 └──────────┘
                        │
                 ┌──────▼───────────────────────────────┐
                 │ src/executor.ts                      │
                 │ class GitBashExecutor extends        │
                 │   LocalBashExecutor                  │
                 │  ├ resolve(): 补 env(PATH/PYTHONIO…) │
                 │  ├ execute(): executeArgv([bashPath, │
                 │  │            '-c', command])        │
                 │  └ planLaunch(): direct/confine/fail │
                 └──────────────────────────────────────┘

  另一条独立的线（minimalMode === 'variant' 时才有）：
   src/index.ts —— syncVariant() → src/preset.ts（读 minimal 文档 → 克隆 → 注册）
                                   └→ verify()（激活返回后查名册，失败置 failed）
   minimal-gitbash 预设的持久终端组 —— gitbash-pty 行 → src/pty.ts（lib/pty.js）
                                   └→ BashTerminalBackend + 注入的 spawnTerminal
```

### 3.1 模块清单

| 文件 | 职责 | 行数预算 |
|---|---|---|
| `src/index.ts` | 宿主入口：`apply` / `Config` / 导出面 | ~120 |
| `src/config.ts` | schemastery Config（全 volatile）、快照读取与校验 | ~110 |
| `src/discover.ts` | Git Bash 发现、WSL 硬排除、候选排序 | ~220 |
| `src/paths.ts` | `bashInstallRoot` / `bashPathEntries` / `composePath` / `pathKey` | ~120 |
| `src/executor.ts` | `GitBashExecutor extends LocalBashExecutor`（含沙箱分支） | ~170 |
| `src/confined.ts` | 受限启动决策 `planLaunch` 与 MSYS 启动失败签名分类 | ~80 |
| `src/preset.ts` | 预设变体管理：读官方 `minimal` 文档、克隆并改写持久终端组、注册/注销、引用计数 | ~410 |
| `src/pty.ts` | `dsh-terminal-tool/pty` 入口：以 `gitbash` 类型注册持久终端后端（复用官方 `BashTerminalBackend`） | ~170 |
| `src/replace.ts` | 每会话替换：校验、isolate、挂载、restrict、section、回滚 | ~200 |
| `src/diag.ts` | 诊断日志（文件 + `DSH_TERMINAL_TOOL_DIAG_FILE`） | ~60 |
| `src/types.ts` | 内部类型与可选服务的最窄投影 | ~80 |
| `src/shared/protocol.ts` | Host/客户端线路协议：路由路径、常量、视图类型 | ~100 |
| `src/routes.ts` | 两条 `/api` 路由（都不写配置；`/state` 不扫描、`/discover` 按需扫描） | ~180 |
| `src/client/index.ts` | 客户端入口：注册 `settings.general.item` 行（`inject=['slots','locale']`） | ~145 |
| `src/client/row.tsx` | 行组件：官方 atoms（方言下拉 + 路径 Input/下拉 + 「自动发现」Button） | ~230 |
| `src/client/store.ts` | 行状态机：读 `/state`、写 `configForms`、自动发现、错误降级 | ~280 |
| `src/client/api.ts` | 两条路由的取数封装 | ~40 |
| `src/client/styles.ts` | 行版式：两列骨架、下拉触发器样式（官方 `--dsw-alias-*` 设计变量） | ~50 |
| `src/client/locales.ts` | 中英文案（`row.title` / `row.description` / 各控件与提示） | ~55 |

### 3.2 组合形态（cordis.patch.yml，全文）

```yaml
- insert:
    - id: terminal-tool
      name: dsh-terminal-tool
      disabled: !!js process.platform !== 'win32'
```

与「仅 Windows 挂载」语义一致：非 win32 时 `apply` 不执行、client bundle 不进
启动图。不 `insert` 任何额外行，因为执行器与工具都是在**会话子树里动态挂载**的。

### 3.3 客户端半区数据流

```
设置 → 通用 → 终端工具（lib/client.js）
  ├── 挂载：POST /api/dsh-terminal-tool/state（只读，不扫描）
  │        + configForms.get('terminal-tool') 的 snapshot（值更可信）
  │        /state 另带 minimalMode 与 variant（status / id / refs / reason）
  ├── 选择方言 / 受限策略 / 极简模式 / 提交路径 / 点「自动发现」：
  │        POST /api/dsh-terminal-tool/discover（仅此时扫描）
  │        然后 configForms.mutate([...]) 一次原子写回（profile patch 层）
  └── 渲染：官方 Button / Input / Menu / IconChevronDownOutlineRegular
           + styles.ts 提供的两列版式
```

写入不经 `/api`：两条路由只是读 / 扫描面。`/state` 与 `/discover` 的契约在
`src/shared/protocol.ts`；设置行在拿到 `configForms` 前以只读形态渲染，服务迟到时
替换旧注册（不会叠出两行）。

---

## 4. 配置模型（`export const Config`）

规则（`@deepseek-ai/dsh-settings` README）：**只有标了 `.volatile()` 的字段才会被投影进
设置表单**；表单按 profile entry id（`terminal-tool`）定位本插件，由客户端半区渲染；
写入落到活动 profile 的 Cordis patch，保留注释与 `!!js` 表达式。因此本插件的 Config
字段全部 `.volatile()`（schemastery 不允许在整个对象上标 `.volatile()`，逐个叶子标）。

```ts
export const Config = z.object({
  ...LocalBashExecutor.Config.dict,                                       // 继承官方执行器字段
  dialect:       z.union(['pwsh', 'bash'] as const).default('pwsh').volatile(),  // F9
  bashPath:      z.string().default('').volatile(),                       // 空 = 自动发现
  bashCandidates: z.array(z.string()).default([]).volatile(),             // 发现顺序 / 手动多条
  autoDiscover:  z.boolean().default(true).volatile(),
  discoverTimeoutMs: z.number().default(1500).volatile(),                 // 发现探测上限
  loginShell:    z.boolean().default(false).volatile(),                   // 是否 -l 登录壳
  extraPath:     z.array(z.string()).default([]).volatile(),              // 追加进 PATH
  pythonUtf8:    z.boolean().default(true).volatile(),                    // F14
  confinedPolicy: z.union(['unconfined', 'escalate', 'fail'] as const)
                   .default('unconfined').volatile(),                     // F15
  minimalMode:   z.union(['leave', 'oneshot', 'variant'] as const)
                   .default('oneshot').volatile(),                        // F16
})
```

语义要点：
- `dialect` 默认 `pwsh` = 安装后**行为不变**，用户显式选 `bash` 才切换（不替用户选）。
- `bashPath` 为空且 `autoDiscover` 为真 → 每次新会话按 `bashCandidates` + 内置发现顺序解析；
  **会话装配路径不写回配置**（避免插件在只读/钩子路径上改 profile），但会写一行诊断。
  写回只发生在用户点「自动发现」时（见 D1）。
- `confinedPolicy` 只在 win32 + 受限档位下生效：`unconfined`（默认）直接启动，模型命令不受
  文件沙箱限制；`escalate` 走官方沙箱与官方审批；`fail` 抛 `SandboxUnavailableError`。
  非法值在快照时回退 `unconfined`，与 schema 默认一致。
- 任一字段非法（如路径指向 WSL）→ 该会话跳过替换，会话保持 pwsh。
- `minimalMode` 只影响 agent preset 为 `minimal` 或 `minimal-gitbash` 的会话，默认 `oneshot`
  与 0.4.x 完全一致。非法值在 `readMinimalMode()` 里回退 `oneshot`（`leave` / `variant`
  原样保留），不阻断启动。三个取值的语义、变体生命周期与沙箱行为见 §13。

---

## 5. 生命周期

### 5.1 启动（apply）

1. `diag('apply: platform=...')`。
2. 读一次 Config 快照并校验；非法只诊断，不抛错（配置错误不得阻断宿主启动）。
3. `registerRoutes(ctx, …)` 注册两条 `/api` 路由（`/state` / `/discover`，都不写配置）；`connection`
   服务是可选注入，缺失时只写诊断，设置行报「无 state」而不是让插件失败。`/state` 的
   `variant` 取自 `variant.state()`。
4. `createVariantManager(ctx)`，`syncVariant(初始快照)` 发起变体注册并在其后 `verify()`；
   `ctx.effect(...)` 登记 `variant.release()` 作为卸载时的注销。`loader/volatile-update`
   时重跑 `sync → verify`（volatile 改动不重载 fiber，见 §13.5）。
5. 注册 `ctx.on('agent/created', …)`；监听体整体 try/catch ——
   **通知型监听器抛出会影响会话启动**，这是硬纪律。

### 5.2 新会话（`agent/created`）

`payload.agent` 需满足：`agent.id` 是 string、`agent.ctx` 是对象；否则跳过。

1. 读**本次**配置快照（→ F12：只有新会话看到新选择）。
2. 门禁（任一不满足 → 写诊断并返回，永不抛）：
   `platform==='win32'` / `dialect==='bash'` / 有 `agent.ctx` / `agent.ctx.tools` 可见 /
   `tools.register`、`tools.restrict` 是函数 / `systemPrompt.section` 是函数 /
   宿主 `ctx.subprocess.spawn` 可见。
3. 解析 bash 路径：显式 `bashPath` → 校验；否则 `discoverBash()`；均失败 → 会话保持 pwsh。
4. 幂等：`agentCtx.tools.get('bash', agent)` 已可见 → 直接跳过整个替换（`already-replaced`）。
5. 建子树：`const shellCtx = agentCtx.isolate('shell')`（不传 label，每次得到全新私有影子）。
6. `shellCtx.plugin(GitBashExecutor, resolved)` —— 子树内提供 `ctx.shell`。
7. `shellCtx.plugin(ToolBash, { enableRunInBackground: true, promoteOnTimeout: true })`，
   随即回查 `tools.get('bash', agent)`：没出现就回滚（否则后面的 `restrict` 会让会话失去终端工具）。
8. `agentCtx.tools.restrict({ deny: ['pwsh'] })` —— **仅当 `tools.get('pwsh', agent)` 可见时**执行；
   `restrict` 对未知名字会抛错，缺 pwsh 的组合（自定义 preset）必须跳过而不是崩。
9. `agentCtx.systemPrompt.section({ name: 'tool:pwsh', order: orderPwsh, text: '' })`
   （`order` 取 `getSectionOrder('TOOL_PWSH')`，读不到用常量 1010；空文本在渲染时被丢弃）。
10. 所有 disposer 登记到 `agentCtx.effect(...)`；失败按**逆序全部回滚**（只撤一部分会留下
    「pwsh 已隐藏但 bash 没注册」的半坏状态）。

### 5.3 卸载 / 关闭开关

`restrict` 与 `section` 的 disposer 随 agent ctx 释放；执行器与工具随子树 fiber 释放。
把 `dialect` 改回 `pwsh` → 插件行 config 变更触发 fiber 重载，新会话不再替换；
已开会话保持原状。

变体走另一条路：`minimalMode` 是 volatile 字段，改动不重载 fiber，只触发
`loader/volatile-update` → 重跑 `sync → verify`。引用保护（`retained`）只发生在
**改选项**这条路径上；fiber 真正释放（禁用 / 卸载插件）时 `ctx.effect` 里的
`variant.release()` 无条件注销定义，因为插件本身已经不在了，这是可接受的取舍。

---

## 6. 执行器设计（`GitBashExecutor`）

```ts
export class GitBashExecutor extends LocalBashExecutor {
  static inject = ['subprocess'] as const;          // 与官方 bash-local 一致
  readonly bashPath: string;
  readonly extraPath: readonly string[];

  resolve(request: ShellExecRequest): ShellExecSpec {
    const spec = super.resolve(request);
    return { ...spec, env: composeEnv(spec.env, this.pathEntries) };  // PATH/PYTHONIOENCODING
  }

  execute(spec: ShellExecSpec): Promise<ShellExecution> {
    const argv = [this.bashPath, ...(loginShell ? ['-l'] : []), '-c', spec.command];
    return this.executorArgv(spec, argv);           // 见下
  }
}
```

- **只重写少量扩展点**：`LocalBashExecutor.execute()` 里的超时分类、输出收集、
  `onProcessDone` 钩子、`result()` 投影全部继承官方实现，不复制。
- 扩展点合法性：`protected executeArgv(spec, argvOrPrepare, onStarted?)` 是官方
  `lib/types/index.d.ts` 里声明的 protected 成员，子类重写 `execute()` 调它是**设计内**用法。
- **沙箱分支**：`execute()` 先用
  `planLaunch({ hasSandbox: this.sandbox !== undefined, policyMode: policy?.mode, choice: this.confinedPolicy, platform: process.platform })`
  决策：无沙箱 / 无 policy → `direct`；`danger-full-access` → `direct`（原有行为）；
  非 win32 → `confine`；win32 + 受限档位按 `unconfined` → `direct`、`escalate` → `confine`、
  `fail` → 抛 `SandboxUnavailableError`。
  - `direct`：直接 `executeArgv(spec, argv)`，结果带 `sandbox: { mode, denied: false }`。
    `mode` 报的是**这次调用的实际边界**：无 policy 或受限档位下 `unconfined` 直启时取
    `danger-full-access`（没有后端包住子进程）。不填 `enforcement`——官方该枚举描述的是
    "有活动后端时能保证多少"，这里没有后端可描述，借用 `partial` 会让调用方误以为存在一层
    被削弱的边界。`escalate`/`confine` 路径仍透传官方 `enforcement`。
  - `confine`：`ctx.sandbox.confine(argv, policy, signal)` 取 `.argv` 再执行，并沿用官方
    `@deepseek-ai/dsh-sandbox` 的 `classifyRunnerFailure` / `isRunnerSpawnFailure` /
    `SandboxUnavailableError` / 拒绝签名匹配来产出 `result.sandbox`
    （`{mode, denied, enforcement, runnerFailed?}`）。
  - `fail`：错误信息指导改 `confinedPolicy`，或带 `sandbox_permissions: danger-full-access`
    重试；不自动重试。

  `sandboxMode` getter 是工具层决定是否暴露 `sandbox_permissions`、以及是否要求
  `ctx.sandboxPolicy` 存在的依据（F6）。它返回 `ctx.sandboxPolicy.defaultMode`，但当这次
  启动实际会绕过沙箱（win32 + 受限档位 + `unconfined`）时返回 `undefined`：否则
  `tool-bash` 会向模型宣称命令在沙箱内运行、并暴露用不上的升级参数。`danger-full-access`
  仍照常返回，因为那本来就是未受限模式。
- **MSYS 启动失败分类**：`onProcessDone` 计算 `denied` 时同时匹配官方拒绝签名与
  `isMsysStartupDenial(exitCode, stderr)`。后者在退出码为 `3221225794` / `3221225506`，
  或 stderr（小写后）含 `ntcreatedirectoryobject(\basenamedobjects\msys-` /
  `couldn't create signal pipe` 时命中；前台与后台一致。
- **不硬编码 `bash`**：argv[0] 用解析出的绝对路径，绕开「PATH 上 `bash` 常命中 WSL 启动器」
  这个陷阱。

### 6.1 PATH 组装（`src/paths.ts`）

Git Bash 的 `git`/`ls`/`grep` 需要 `Git\bin`、`Git\usr\bin`、以及 `ucrt64|mingw64|clang64`
中**真实存在**的那个。规则：

- `bashInstallRoot(bashPath)`：`…/Git/bin/bash.exe` → `…/Git`；`…/Git/usr/bin/bash.exe` → 上两层。
- `bashPathEntries(root)` = `[root\bin, root\usr\bin, root\<env>\bin(存在者)]`。
- `composePath(entries, hostPath)`：按**归一化键**（小写、去尾分隔符、`/`→`\`）去重，
  自建项在前，宿主 PATH 在后。

---

## 7. 自动发现（`src/discover.ts`）

**硬排除 WSL**（关键）：`%SystemRoot%\System32\bash.exe` 与 `…\WindowsApps\bash.exe`
一律拒绝 —— `where bash` 在 Windows 上通常先解析到 WSL 启动器，误用会得到
`Wsl/Service/CreateInstance/E_ACCESSDENIED` 或另一个 Linux 文件系统。

候选来源（按序，全部按**目录存在性**判断，默认**不**执行 `bash --version`：
同步 spawn 会阻塞宿主事件循环）：

1. `bashCandidates`（用户显式给的路径或安装根）。
2. 注册表 `HKLM\SOFTWARE\GitForWindows` 的 `InstallPath`（只读键值，不 spawn）。
3. `%ProgramFiles%\Git`、`%ProgramFiles(x86)%\Git`、`%LocalAppData%\Programs\Git`。
4. `%ProgramFiles%\MSYS2`、`C:\msys64`、`%LocalAppData%\MSYS2`。
5. `%SystemDrive%\cygwin64`、`%SystemDrive%\cygwin`。
6. PATH 上的 `git.exe` → 由同一安装反推 `bash.exe`（**不是**直接用 PATH 上的 `bash`）。

每个候选根展开为 `bin\bash.exe`、`usr\bin\bash.exe`；第一个通过
`validateBashPath()`（文件名是 `bash`/`bash.exe`、文件存在、非 WSL、非目录）的即命中。
返回 `{ path, source }`，并把全部命中按发现顺序返回供诊断（多条命中时通过
`bashCandidates` 手工指定首选）。

---

## 8. 错误、降级与诊断

| 场景 | 行为 |
|---|---|
| 非 Windows | 插件行 `disabled`，`apply` 不执行 |
| 配置非法 | 启动时写一行诊断，不抛错；会话保持 pwsh |
| 路径非法 / 未发现 | 该会话跳过替换，写诊断；**不**注册任何东西 |
| 缺少某个可选服务 | `ctx.get(...)` 判空后逐项门禁，缺一个只影响对应动作 |
| 挂载工具失败 | 逆序回滚已完成的动作，写诊断 |
| 命令超时 | 官方工具语义：`promoteOnTimeout` → 转后台 |
| 受限沙箱下 Git Bash 启动失败 | 按 `confinedPolicy` 处理：`unconfined` 直接启动（命令不受文件沙箱限制）；`escalate` 标 `denied`，交给官方升级与审批链路；`fail` 抛 `SandboxUnavailableError`。不修改沙箱本身 |
| 诊断日志 | `%TEMP%\dsh-terminal-tool.log`；`DSH_TERMINAL_TOOL_DIAG_FILE` 优先 |

测试记录与生产日志分离：自测脚本一律设 `DSH_TERMINAL_TOOL_DIAG_FILE` 到临时文件。

### 8.1 客户端半区（设置行）的降级

| 场景 | 行为 |
|---|---|
| 非 Windows | 行不渲染（`/state` 回 `platform` 后 `status='hidden'`） |
| 无 `configForms` | 行照常渲染但只读，并说明宿主设置服务不可用；不会假装能保存 |
| `/state` 失败 | 行保留（带错误提示），避免把坏安装静默隐藏 |
| 「自动发现」无命中 | 保留原路径，提示「没有找到 Git Bash，请直接填入 bash.exe 的完整路径。」，不清空输入 |
| 保存被宿主拒绝 | 「宿主拒绝了这次保存（版本冲突或字段不可编辑），请刷新后重试。」 |
| 宿主缺能力 | 行内展示「当前 DSH 版本不支持自动切换：{reason}」，控件禁用 |
| 变体注册失败 | 「极简模式」行在 `variant` 下展示失败原因（`/state` 的 `variant.reason`），不静默；其余三行仍可用 |
| 变体被保留 | 展示「仍有 {n} 个会话引用该变体，暂不删除」，与 `variant.status === 'retained'` 一致 |
| 挂载 | 不扫描、不写配置；只有点击才触发 `/discover` 与写回 |

---

## 9. 测试策略

| 层 | 手段 | 断言 |
|---|---|---|
| 类型 | `tsc --noEmit`（devDeps 钉 `@deepseek-ai/*@0.2.1-rc.2` 的真实 `.d.ts`） | 0 error |
| 纯逻辑单测 | `node scripts/selftest.mjs` | 发现顺序、WSL 排除、路径校验、PATH 去重、env 组装、受限策略快照与 `planLaunch` 决策、MSYS 启动失败签名、`/state` 与 `/discover` 的 handler（含 `minimalMode` / `variant` 字段）、两条路由的注册与降级、预设行克隆与变体生命周期（51 项） |
| 执行器 | `scripts/integration.mjs` 在真实 `tool-bash` 下起真 Git Bash | `echo "$BASH_VERSION"` / `uname -s` → `MINGW64_NT-…` |
| 契约 | `node scripts/contractcheck.mjs` | Config 字段全 volatile；patch 行 id/name/disabled 正确；导出面完整；客户端 bundle 装载形状；bundle 未内联第一方；`react` 与官方 atoms specifier 保持 external；`./pty` 入口与可选 peer（17 项） |
| 客户端半区 | `node scripts/clientsmoke.mjs` | 真实执行 `lib/client.js`：模块 id、`react` 与官方 UI atoms external、`inject` 面、`apply` 注册 `settings.general.item`、无 `configForms` 时降级为只读、迟到 `configForms` 替换而非叠加、重复 `apply` 幂等（8 项） |
| 行状态机 | `node scripts/rowselftest.mjs` | `/state` 读入、平台决定显隐、乐观写入、受限策略同步与写入、revision 冲突与抛错提示、自动发现持久化候选、发现为空（15 项） |
| 行渲染 | `node scripts/rendertest.mjs` | jsdom + React 18 真实渲染 `lib/client.js` 导出的组件，按 role/aria 断言：标题与描述、方言下拉触发器（`button[aria-haspopup="menu"]`）、`role="menuitem"`、选 bash 出路径行、受限策略下拉与切换写回、路径 `input[aria-label="Git Bash 路径"]`、Enter 提交、自动发现变下拉、发现为空、非 Windows 不渲染、只读禁用（12 项）。官方 atoms 由行为级替身 `scripts/primitives-double.mjs` 提供，断言不依赖 CSS 类名 |
| 集成 | `node scripts/integration.mjs`：真实 `dsh-tools` / `dsh-system-prompt` / `dsh-tool-bash` / `dsh-scope` 挂在一次性 cordis 应用里 | `bash` 出现且 `pwsh` 消失、祖先 scope 仍见 `pwsh`、prompt 段被清空、真命令跑在 Git Bash 上、二次 install 幂等、`dialect=pwsh` 完全不替换、`unconfined` 不调用 `confine` 且结果报 `danger-full-access`、`escalate` 的 MSYS 崩溃标 `denied`、`sandboxMode` 在会绕过时隐藏、`apply()` 接线 `agent/created`+`agent/disposed`、四种预设下的 `minimalMode` 分流（13 项） |
| 人工 | 装进 profile + 重启 + 新会话 | 模型工具目录只有 `bash`；卡片与退出码正常；`dialect=pwsh` 时完全复原 |

---

## 10. 交付物

```
dsh-terminal-tool/
├── package.json          # name / dsh.bundle.patch / exports / files / engines
├── cordis.patch.yml      # 仅 Windows 挂载的一行 insert
├── tsconfig.json         # strict，noEmit
├── build.mjs             # esbuild 打包 src → lib（+ 手写 .d.ts）；react、官方 atoms 与 dsh-terminal-bash external
├── locale/{en,zh}.json   # meta.title / meta.description（强制）
├── assets/icon.svg       # ≤256 KiB，包内相对路径
├── src/*.ts              # 宿主模块 + shared/protocol.ts + testing.ts（仅测试用入口，不发布）
├── src/client/*          # 客户端半区（官方 UI atoms + 版式 + 文案）
├── scripts/selftest.mjs
├── scripts/contractcheck.mjs
├── scripts/clientsmoke.mjs
├── scripts/rowselftest.mjs
├── scripts/rendertest.mjs
├── scripts/primitives-double.mjs  # 官方 UI atoms 的行为级测试替身
├── scripts/integration.mjs
├── docs/DESIGN.md        # 本文档
└── README.md             # 安装/使用/排障/已知限制
```

发布包（`npm pack`）只含：`lib/index.js`、`lib/index.js.map`、`lib/client.js`、
`lib/client.js.map`、`lib/pty.js`、`lib/pty.js.map`、`lib/types/**`、`locale/*.json`、
`assets/icon.svg`、`cordis.patch.yml`、`README.md`、`LICENSE`、`package.json` ——
`src/`、`scripts/`、`docs/`、`lib/testing.js` 一律不进 tarball。

---

## 11. 已知限制（将写入 README）

1. 仅 Windows。
2. 只对新会话生效。
3. 极简模式的变体不是自动生效的：
   - 变体必须每个新会话手选一次（预设选择器里选「极简模式 · Git Bash」），已存在的
     `minimal` 会话不会被重新组装；
   - 关掉选项不一定能移除变体：仍有会话引用 `minimal-gitbash` 时定义保留（`retained`），
     否则那些会话会永久打不开；没有会话删除 API，引用不会自行过期；
   - 持久终端没有沙箱升级通道，`escalate` 在变体里不可达，表现等同受限档位下拒绝执行；
   - 持久终端打开期间不能切换沙箱档位（官方 `ensureSandboxModeFence` 的约束）。
4. 受限沙箱（read-only / workspace-write）下 MSYS2 无法创建 BaseNamedObjects，
   Git Bash 无法在沙箱内启动：`NtCreateDirectoryObject(\BaseNamedObjects\msys-2.0S5-…): 0xC0000022`，
   `exit -1073741502`。**这是宿主沙箱行为，与插件无关**。默认 `confinedPolicy: unconfined`
   直接启动 Git Bash（模型命令不受文件沙箱限制）；`escalate` 走官方审批；`fail` 明确报错。
5. 原生 Windows 程序（`cmd`/`tasklist`/`powershell`）按 ANSI 代码页（中文 936）写管道，
   DSH 按 UTF-8 解码 → 中文乱码；`chcp 65001` 无效。仅缓解 Python（`PYTHONIOENCODING`）。
6. `cmd /c` 会被 MSYS 参数改写，需 `cmd //c` 或 `MSYS2_ARG_CONV_EXCL='*'`。
7. 首次安装必须重启 DSH（运行中插入的 row 只进组合树，`apply` 不会被调用）。
8. 宿主版本限定 `>=0.2.1-rc.2 <0.3.0`（`engines.dsh`）：设置行依赖 Web shell 的官方 UI
   atoms 模块表（`PLATFORM_MODULES`），大版本变更后需重新验证；Host 半区的替换逻辑不依赖它。

---

## 12. 设计期偏离与待验证项

| ID | 项 | 处理 |
|---|---|---|
| D1 | 自动发现结果不写回 profile 配置 | ~~有意为之~~ **已改**：用户点「自动发现」时把选中的 `bashPath` 与可用列表 `bashCandidates` 一次性原子写回（一次 `mutate` 两条 op），因为「扫完还得手抄路径」不可用。会话装配路径仍不写配置 |
| D2 | ~~用官方 settings 自动表单替代「设置→通用→终端工具」自定义行~~ | **该假设错误，已修正**：0.2.1-rc.2 的 `dsh-settings` 只在 Host 侧算 `volatileForm`/`autoGenerate`，全 asar 没有任何 client bundle 消费它渲染页面（`autoGenerate` 的语义只写在协议注释里）。因此设置页不会有任何自动 UI，必须自写 `settings.general.item` 行 —— 已实现于 `src/client/` |
| V1 | `tools.register` 从 agent 子树注册的落点（本层 vs 全局层） | **已在集成测试中确认落在 agent 自己的层**：`bash` 对该 agent 可见、对祖先 preset scope 不可见；幂等仍靠 `tools.get('bash', agent)` 探测双保险 |
| V2 | 官方 `tool-bash` 在 `isolate('shell')` 子树里解析 `ctx.shell` | **已由集成测试验证**：同一 agent 子树内的 `tool-bash` 拿到的是 `GitBashExecutor`，命令实际跑在 Git Bash 上（`uname -s` → `MINGW64_NT-…`） |
| V3 | client 半区设置行 | **已完成**：`src/client/` 注册 `settings.general.item`（id `terminal-tool`，order 60）；终端的枚举选择是官方下拉 + `Menu`，路径是官方 `Input`（多候选时同一套下拉），「自动发现」是官方 outline `Button`；两条 `/api` 路由由 `src/routes.ts` 提供 |
| V4 | 设置行能否直接复用官方 UI atoms | **已验证**：`@deepseek-ai/dsh-client-ui-primitives` 由 Web shell 以 `PLATFORM_MODULES` 播种，client bundle 保持 external（contractcheck / clientsmoke 断言）；jsdom 渲染测试用 `scripts/primitives-double.mjs` 行为级替身，按 role/aria 断言 |
| V5 | 注册变体后预设名册能否立刻看到 | **不能，已知体验缺口**：官方名册只在界面重新挂载时重拉（`ctx.remote.agentPresets.list()`），所以注册后已打开的新建会话界面不会立刻出现该项，需重开预设选择器（或刷新界面）才可见。M3 再研究刷新钩子 |
| V6 | 用 `sessionQuery` 会话头判断变体是否仍被引用 | **有盲区，已接受的取舍**：切换了 preset 但尚未产生第一轮对话的会话，其持久化会话头可能还没写入新 preset，扫描会漏掉它。活跃会话投影覆盖同一时刻的在线会话，两者叠加才是完整判断；仍不足时只能靠「保留」而不是「删除」来兜底 |
| V7 | 变体引用是否会自行过期 | **不会**：宿主没有会话删除 API，`listSessions()` 里存在的记录不会被清理，因此 `retained` 状态可能长期存在。注销只发生在引用数真正归零时 |

### 12.1 编码期发现的、与设计稿的差异（已按实际实现修正）

| 设计稿假设 | 实际 | 修正 |
|---|---|---|
| `agentCtx.isolate('shell', TAG + agent.id)` | `isolate` 的 label 参数类型是 `symbol`，不是 string | 改为 `isolate('shell')`，由 cordis 生成新 symbol；语义更强（每次全新影子） |
| `ctx.shell` 可在 `danger-full-access` 走 `super.execute(spec)` | `LocalBashExecutor.execute` 硬编码 `['bash','-c',cmd]`，走的还是系统 bash | 覆写 `execute()` 自己组 argv，再调 `protected executeArgv()` |
| 执行器 `static inject = ['subprocess','sandbox','sandboxPolicy']` | 无沙箱组合下 fiber 永不 ready，工具拿不到 `ctx.shell` | `inject = ['subprocess']`，`sandbox`/`sandboxPolicy` 用 `ctx.get()` 运行时探测 |
| `resolve()` 只补 PATH | `tool-bash` 在无沙箱时不会传 `sandboxPolicy`，而沙箱分支要用 `policy.mode` | `resolve()` 同时兜底 `sandboxPolicy: spec.sandboxPolicy ?? this.sandboxPolicy?.resolve()` |
| `restrict({deny:['pwsh']})` 无条件执行 | 名字未知会抛 `tools.restrict() names unknown global tool(s)…` | 先 `tools.get('pwsh', agent)` 探测，缺失则跳过并记 `warn` |
| 无条件 `systemPrompt.getSectionOrder('tool:pwsh')` | 该 API 的参数是常量名（`TOOL_PWSH`），传 section 名返回 `undefined` | 传 `'TOOL_PWSH'`，并保留 `?? 1010` 回退 |
| `lib/types/index.d.ts` 手写后 `from './config.ts'` | 发布包里没有 `.ts` 源，类型解析会悬空 | 声明文件内联全部公共类型 |
| 设置行自绘胶囊按钮 / `<input>` / `<select>`（早期版实现） | 与相邻官方设置项视觉、行为都不一致；官方对枚举偏好统一渲染成下拉 `Menu` | 改用官方 UI atoms（`Button` / `Input` / `Menu` / `IconChevronDownOutlineRegular`）；`styles.ts` 只保留版式 |
| 「client bundle 不得 import 第一方值模块」（早期对 client purity 约束的理解） | 官方 UI atoms 由 Web shell 的冻结模块表提供，和 `react` 同类，官方 `PreferenceRow` 也是直接引用 | client bundle 正常 `require('@deepseek-ai/dsh-client-ui-primitives')` 并保持 external；其余第一方包仍不得进入 client bundle |
| `dsh-terminal-tool/pty` 的 Config 含 `loginShell` / `pathEntries`（PLAN §5.3） | 实际只有 `backendType` / `bashPath` / `shellArgs` / `pythonUtf8` / `confinedPolicy`：持久终端不需要一次性执行器那套 PATH 合成，`shellArgs` 已能表达登录壳 | 以代码为准；`src/preset.ts` 仍会往 `gitbash-pty` 行写 `loginShell`，schemastery 会忽略该未知键——留作待清理项 |
| PLAN §5.3：「`bashPath` 由根插件填入，volatile 改了要重建变体」 | **已实现**：`converge()` 用 `specSignature()` 比较 `bashPath` / `confinedPolicy` / `loginShell` / `pythonUtf8`，不同则先注销再注册；相同则完全不碰定义（避免每次设置写入都退役一代 generation）。已绑定的会话继续跑旧 revision | 以代码为准 |
| 第四行「极简模式」的测试覆盖 | `scripts/rendertest.mjs` 新增两项（三项菜单与写回、变体三态提示）；`scripts/rowselftest.mjs` 未单独加用例（控制器写入路径与 `setConfinedPolicy` 完全同构） | 以渲染层覆盖为准 |

---

## 13. 极简模式与预设变体

### 13.1 为什么 `minimal` 是特例

出厂预设里只有 `minimal` 使用持久 PTY：它的组合文档中有一组
`isolate: { terminals: true }` 的持久终端行（Windows 上是持久 **pwsh**，POSIX 上是持久
bash），`bash` / `pwsh` 工具与 `tool:bash` 提示词段都由这一组提供。§5.2 的会话级替换只
覆盖「本会话可见的执行器」，替换不掉这组私有影子里的后端，因此 `minimal` 需要独立的
处理面。设计论证与三个方案的取舍见 [`PLAN-minimal-mode.md`](PLAN-minimal-mode.md)。

### 13.2 能力：`minimalMode`

新增 volatile 叶子 `minimalMode: 'leave' | 'oneshot' | 'variant'`，默认 `oneshot`，
因此升级不改变行为。它只对 agent preset 为 `minimal` 的会话（以及变体
`minimal-gitbash` 自身）生效，其它预设完全不受影响。

| 值 | `minimal` 会话 | 预设名册 |
|---|---|---|
| `leave` | 插件不介入，保留官方持久终端 | 不变 |
| `oneshot`（默认） | 替换为一次性 Git Bash `bash`，隐藏 `pwsh`（0.4.x 行为） | 不变 |
| `variant` | 同样不介入；另注册 `minimal-gitbash` | 多一项「极简模式 · Git Bash」（id `minimal-gitbash`，order `3.1`） |

三条补充规则：`variant` 不改变默认预设、不替用户选会话，只负责把变体放进名册；变体不可用
（找不到 Git Bash / 构造失败）时**不静默回落成 `oneshot`**，`minimal` 会话按 `leave` 语义处
理、设置行显示失败原因；选项只对新会话生效。

`src/replace.ts` 在闸门前两行短路：preset 是 `minimal-gitbash` → `already-replaced`；
preset 是 `minimal` 且 `minimalMode !== 'oneshot'` → `minimal-left`（新增的
`SkipReason`，见 `src/diag.ts`）。

### 13.3 独立入口 `dsh-terminal-tool/pty`

变体需要「持久 Git Bash」后端，而持久后端属于 `@deepseek-ai/dsh-terminal-bash` 的
能力面。把它做成**单独的导出入口**（`src/pty.ts` → `lib/pty.js`，`exports['./pty']`，
并列入 `files`）而不是塞进根插件，理由是加载面：根插件从不 import
`@deepseek-ai/dsh-terminal-bash`，没有持久终端栈的机器仍然能正常加载根插件；该包只声明为
**可选** `peerDependencies`（`peerDependenciesMeta.optional`），缺失时只有变体不可用。

入口的实现方式是无子类复用：`new BashTerminalBackend(ctx, resolved, spawnTerminal)`，
注入官方构造函数的第三个参数——一个负责真正落地的 `spawnTerminal`。它调用与执行器同源的
`planLaunch()`：

- `direct` → 以 `[bashPath, ...shellArgs]` 直接 `ctx.subprocess.spawnTerminal()`，不套
  受限包装；`pythonUtf8` 为真时补 `PYTHONIOENCODING=utf-8`。
- `confine` → 直接交给 `ctx.subprocess.spawnTerminal(spec)`（非 Windows 的正常路径）。
- `fail` → 抛 `SandboxUnavailableError`。

注册的 backendType 默认 `gitbash`，成功后 `ctx.terminals.registerBackend(backend)`，
失败只写诊断 `pty: backend registration failed`。这个入口必须挂在预设的持久终端组里
（`isolate: { terminals: true }`），否则会落到别人家的 `terminals` 注册表上。

### 13.4 行克隆：不改官方定义，只读一份再改写

`src/preset.ts` 的做法是「读—解析—克隆—改写—重注册」：

1. `agentPresets.readDocument('minimal')` 取官方定义原文。
2. `js-yaml` 解析，schema 是 `JSON_SCHEMA.extend(JsExpr)`——`!!js` 标签
   （`tag:yaml.org,2002:js`）照抄官方 `cordis-plugin-include` 的定义。谓词
   （`predicate`）必须保留，否则 re-dump 会写成普通映射 `{ __jsExpr: … }` 而不是标签，
   loader 就不再把它当表达式求值。
3. `structuredClone` 整棵行列表，仅改持久终端组：
   - 从该组的行列表里过滤掉 `terminal-pwsh` / `persistent-pwsh`；
   - 去掉 `persistent-bash` 上的 `disabled`，并把 `config.backendType` 设为 `gitbash`；
   - 在 `pty` 行之后插入 `gitbash-pty` 行（`name: 'dsh-terminal-tool/pty'`）。
4. 以 id `minimal-gitbash`、name「极简模式 · Git Bash」、order `3.1` 重新注册。
   遇到形状不符合预期的官方文档直接抛错（`minimal preset has no persistent-shell group`），
   不做猜测性修补——官方改了布局时应当明确失败，而不是生成一个半坏的预设。

官方 `minimal` 定义自始至终只读。

### 13.5 注册时机纪律

注册本身可以在插件激活期间发起（`ctx.inject(['agentPresets'], …)`）。但
`agentPresets.list()` / `resolve()` / `retain()` 必须等激活返回之后再调用：
在激活期间调 `list()` 会与 Host Loader 互等，形成死锁。

因此 `createVariantManager(ctx)` 把它拆成两步：`sync()` 只发起注册（`register()`），
`verify()` 在注册的 Promise 之后、由 `apply` 的 `.then()` 链调用，此时激活早已返回。
`verify()` 调 `agentPresets.list()` 找 `minimal-gitbash`，`entry.broken !== undefined`
时把状态置为 `failed` 并带上原因，由 `/state` 的 `variant.reason` 透到设置行。
`apply` 里另注册 `loader/volatile-update` 监听，配置一变就重跑 `sync → verify`。

### 13.6 注销的引用安全规则

注销也要等激活返回后，并且必须先数引用：

- 引用来源一：活跃会话——`ctx.get('sessions').list()` 后逐个读
  `sessionProjections.stateOf(session, 'agentPreset')`，读不到时用会话头的字段兜底。
- 引用来源二：已持久化的会话——`sessionQuery.listSessions()` 的
  `record.header.agentPreset`；服务缺失按 0 处理，扫描抛错只写诊断
  `variant: sessionQuery scan failed`。

规则：`minimalMode !== 'variant'` 时，若仍有引用则**保留定义**（`status: 'retained'`，
`refs` 计数），否则注销（`absent`）。原因是官方恢复路径按 id 解析预设、没有回退分支：
删掉定义会让这些会话永久打不开，用户只会看到一个笼统的 `gateway/internal`。没有会话删除
API，所以这些引用不会自行过期。

### 13.7 持久后端的沙箱语义

持久终端没有 `sandbox_permissions` 升级通道，`escalate` 在这条路上不可达。

| `confinedPolicy` | 持久后端的实际行为 |
|---|---|
| `unconfined`（默认） | `direct`：直接启动 Git Bash，不经沙箱；命令不受文件沙箱约束 |
| `escalate` | 仍走 `confine` 路径（`planLaunch` 返回 `confine`），于是照常撞上 MSYS 启动失败；持久终端**没有** `sandbox_permissions` 升级通道，所以失败后没有重试入口，实际结果等同拒绝 |
| `fail` | 抛 `SandboxUnavailableError`，信息同执行器路径 |

另有一条官方约束：`ensureSandboxModeFence` 禁止在持久终端打开期间切换沙箱档位，用户在
会话中改沙箱模式会被拒绝。这是宿主行为，插件不绕过。

### 13.8 客户端设置行

设置行在原有三行之后新增第四行「极简模式」，控件仍是官方 `Menu` 下拉（与「受限沙箱时」
同一套触发器），文案键为 `row.minimal.*`（zh/en 各一套）。它只在 `dialect === 'bash'`
且能力探测通过时渲染；选择器写回仍走 `configForms` 的 `{op:'set', path:['minimalMode']}`
一次原子写回。变体状态来自 `/state` 的 `variant` 字段，三种提示分别对应
`registered` / `retained`（带引用数）/ `failed`（带原因）。不新增路由：注册与注销都在
Host 侧，客户端只读状态。

### 13.9 与官方 terminal bundle 的关系

`@deepseek-ai/dsh-experimental-terminal-bundle` 提供全局 `terminal_*` 工具与一个独立的
`terminals` 注册表；本插件的 `pty` 入口只在某个预设的持久终端组里注册后端。两者不共享
注册表，也不互相读写状态。官方 bundle 已安装时，变体预设的组里仍是官方 `pty` 行在前、
本插件的 `gitbash-pty` 行在后，`terminal_*` 工具由前者提供，`bash` 走后者。
