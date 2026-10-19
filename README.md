# dsh-terminal-tool

在 Windows 上把模型的终端工具从 **pwsh** 换成 **本机 Git Bash** 的 DSH 插件。

设计取向：**一个开关、所有 preset 跟随、不动 preset 文件、不接管全局 `ctx.shell`**。默认 `dialect: pwsh`，装上去什么都不变；改成 `bash` 后，**新会话**拿到 `bash` 工具、`pwsh` 从该会话的工具目录里消失，已开的会话保持原状。

> **临时替代方案**：DSH 目前没有内置的「终端 / Git Bash 选择」能力。**在官方能力落地前，本插件是它的临时替代方案**——用官方已发布的执行器与工具，把 Windows 上新会话的终端换成 Git Bash；Windows 受限沙箱档位下的 `confinedPolicy` 同属这段临时接线。**官方提供等价设置后即可停用本插件**：从 profile 依赖里移除本行并重启，新会话即回到官方终端工具。插件不改 DSH 安装目录、不改任何 preset、不接管全局 `ctx.shell`，配置只写进当前 profile 的 patch 层；卸载不需要清理任何全局状态。`minimalMode: variant` 是这条界线上的例外，但不是对它的破坏：持久终端版本以**新增预设** `minimal-gitbash` 的形式注册，官方 `minimal` 预设原样保留；没有会话再引用它时，这个预设会自行消失。详见[极简模式](#极简模式minimal-preset)。

---

## 为什么要这个插件

DSH 0.2.1-rc.2 的平台组合在 Windows 上是互斥的：

```yaml
- id: bash-sandbox
  name: '@deepseek-ai/dsh-bash-sandbox'
  disabled: !!js process.platform === 'win32'
- id: pwsh-sandbox
  name: '@deepseek-ai/dsh-pwsh-sandbox'
  disabled: !!js process.platform !== 'win32'
- id: tool-bash          # 同样的平台断言
- id: tool-pwsh
```

`ctx.shell` 是单实例服务（同一 context 内加载第二个会抛错），所以 Windows 上根本没有 bash 执行器，`bash` 工具也不存在。想用 Git Bash 只有三条路：

| 路线 | 代价 |
|---|---|
| 改 `dsh-base` / profile patch 的平台断言 | 要动第一方组合，重启，且只影响那一个平面 |
| 自研 PTY / 自研工具 | 重写 60KB+ 的工具契约，容易与官方行为漂移 |
| **本插件：会话级隔离替换** | 只在新会话的 `isolate('shell')` 子树里注入执行器，宿主平面不动 |

本插件选第三条。

---

## 工作原理

插件本身不实现终端。它做四件事，全部复用第一方组件（官方 `minimal` 预设另有一个变体入口，见[极简模式](#极简模式minimal-preset)）：

1. **执行器**：`GitBashExecutor extends LocalBashExecutor`，只改三处——
   - `execute()` 用配置的 `bash.exe` 绝对路径组 `[bash, -c, command]`（基类硬编码 `"bash"`，在 Windows 上会命中 `System32\bash.exe`，那是 WSL 启动器）；
   - `resolve()` 注入 `PATH`（`spawnSpec` 里 `spec.env` 是唯一能塞 PATH 的位置）；
   - 受限档位下按 `confinedPolicy` 选择直接启动、走官方 `ctx.sandbox.confine()`，还是明确报错（见「受限沙箱策略」）。

   超时、输出收集与溢出、abort 分类、`dshEnv` 合并、结果整形全部继承，行为与官方 bash 执行器一致。

2. **工具本体**：直接挂官方 `@deepseek-ai/dsh-tool-bash`。前台/后台、超时转后台、`sandbox_permissions` 升级、会话 cwd、工具卡片、退出码标记，官方自带。

3. **会话级替换**（`src/replace.ts`，在 `agent/created` 里执行）：
   ```
   shellCtx = agentCtx.isolate('shell')       // 该 agent 私有的 shell realm
   shellCtx.plugin(GitBashExecutor, {...})    // 只在这个子树里可见
   shellCtx.plugin(ToolBash, {...})           // 注册出的 bash 落在 agent 自己的工具层
   agentCtx.tools.restrict({ deny: ['pwsh'] })          // 只过滤「继承来的」工具
   agentCtx.systemPrompt.section({ name: 'tool:pwsh', text: '' })  // 空文本=渲染时丢弃
   ```
   四步都登记在 `agentCtx` 上，会话结束由 cordis 逆序释放；中途失败则逆序回滚，会话退化为原样。

4. **配置与设置行**：所有字段 `.volatile()`，同一份 entry Config 由 Host 交给官方 `configForms` 服务；**客户端半区**（`lib/client.js`）把它渲染成 **设置 → 通用 → 终端工具** 的一行，写回仍落在 profile 的 patch 层。行内控件全部复用官方 `@deepseek-ai/dsh-client-ui-primitives` 的 `Button` / `Input` / `Menu` / `IconChevronDownOutlineRegular`，外观与相邻的官方设置项同源；该包只作为 devDependency 提供类型，运行时由 Web shell 的冻结模块表（`PLATFORM_MODULES`）播种，bundle 像 `require('react')` 一样 `require()` 它，插件不在运行时安装任何依赖。

### 关键设计约束（为什么不那么做）

- **不接管全局 `ctx.shell`**：那会让所有会话（包括没选 bash 的）跟着变，并且与宿主平台的执行器冲突。
- **不编辑 preset**：`preset-standard` 在 profile 里是完整快照，改它等于接管用户的组合文件，且升级会被覆盖。极简模式的变体同理——它是**新增**一个注册项（`minimal-gitbash`），不是改官方 `minimal` 的定义。
- **只对新会话生效**：工具与 prompt 是会话创建时装配的，运行中换不掉——这是 DSH 的语义，不是插件的取舍。
- **`restrict` 只过滤继承层**：官方文档明确 "never what its OWN layer registers"，所以从 agent scope 调 `restrict({deny:['pwsh']})` 恰好只隐藏 preset 带进来的 `pwsh`，不影响本层注册的 `bash`。
- **沙箱策略是显式配置，不由插件悄悄绕过**：默认 `confinedPolicy: unconfined` 在 Windows 受限档位下直接启动 Git Bash，命令因此不受文件沙箱约束——这是用户在设置里看得到、可改回的选择；`escalate` 仍走官方 `ctx.sandbox.confine()` 与官方审批，`fail` 明确报错。插件只把 MSYS 启动失败分类成 `denied`，不自己实现审批。

---

## 安装

### 前置条件

- Windows + DSH Desktop `>=0.2.1-rc.2 <0.3.0`（`package.json` 的 `engines.dsh` 范围；本插件在此范围内开发与验证）
- **Web shell 自带 `@deepseek-ai/dsh-client-ui-primitives`**：0.2.1-rc.2 起该包由 Web shell 的冻结模块表（`PLATFORM_MODULES`）播种，插件设置行的 bundle 像 `require('react')` 一样 `require()` 它，不会内联第二份 atoms。宿主升级到范围外时设置行可能加载失败，但 Host 半区的替换逻辑不依赖这张模块表
- 本机已装 Git for Windows（或 MSYS2 / Cygwin）
- Windows 受限沙箱下 Git Bash 无法在沙箱内启动：默认 `confinedPolicy: unconfined` 直接启动（模型命令不受文件沙箱限制），也可选 `escalate`（官方审批）或 `fail`（报错），见「受限沙箱策略」

### 步骤

```powershell
# 1. 构建（产物在 lib/）
git clone https://github.com/road-kid/dsh-terminal-tool.git
cd dsh-terminal-tool
npm install
npm run check        # typecheck → build → contractcheck → clientsmoke → selftest → rowselftest → rendertest → integration

# 2. 装进 profile（本机 profile 为 desktop）
#    用插件管理器从本地目录安装：
#    plugin_manager install_bundle → target = 本仓库的绝对路径
npm pack
# 或把 tarball / 目录放进 profile 的依赖里，例如
#   C:\Users\<you>\.dsh\profiles\desktop\package.json
```

插件包自带 `dsh.bundle.patch`，profile 的组合层会读取它并插入：

```yaml
- insert:
    - id: terminal-tool
      name: dsh-terminal-tool
      disabled: !!js process.platform !== 'win32'
```

**安装或升级后必须重启 DSH**：运行中插入的 row 只进组合树，插件的 `apply` 不会被调用。

### 启用

重启后打开 **设置 → 通用**，底部会多出一行 **终端工具**（客户端半区注册的 `settings.general.item` 行，id `terminal-tool`，order 60）：

```
终端工具                                     [Git Bash（bash） ▾]
模型执行命令时使用的终端；改动只影响新会话。
Git Bash 路径                    [C:/Program Files/Git/bin/bash.exe]  [自动发现]
```

（上面是选中 `bash` 后的样子；默认 `pwsh` 时没有第二行。）

- **版式与官方 General 段设置行一致**：两列，左侧标题（14px/20px）+ 一句说明（12px/18px），右侧控件；24px 列间距、16px 纵向内边距、`.5px` 底部分隔线（`--dsw-alias-border-l2`）。颜色全部取 `--dsw-alias-*` 设计变量，跟随主题。
- **终端类型**是一枚官方下拉触发器（36px、`--dsw-radius-md`、`--dsw-alias-bg-module-platform`、chevron），点开是官方 `Menu`——与官方段里所有枚举型偏好的渲染方式相同。**默认 `pwsh`**：装插件本身不改变任何行为。
- 选 `bash` 后才出现路径行。路径默认是官方 `Input`，直接填 `bash.exe` 的完整路径；「自动发现」命中多于一条时，输入框换成同一套下拉，列出全部可用路径。路径为空时有提示；扫描中按钮文案变为「正在扫描…」，扫不到会明确提示，而不是清空输入。
- 已经选好的路径**不会**被后续扫描改写（除非它已失效）。
- `bash` 时路径行之后还有 **受限沙箱时** 下拉（`unconfined` / `escalate` / `fail`，默认 `unconfined`）；选中 `unconfined` 会显示提示：模型执行的命令不受文件沙箱限制。三种取值的后果见「受限沙箱策略」。
- 再下一行是 **极简模式** 下拉（`leave` / `oneshot` / `variant`，默认 `oneshot`），只在方言为 `bash` 且平台受支持时出现，用于处理官方 `minimal` 预设的持久终端。选 `variant` 后行内会显示变体状态：已注册 / 注册失败（带原因）；关掉选项但仍有会话引用时，提示里会给出引用数。见[极简模式](#极简模式minimal-preset)。
- **挂载时不扫描、不写配置**：扫描只在点「自动发现」时发生，并把选中的 `bashPath` 与可用列表 `bashCandidates` 原子写回；`/state` 只读配置，所以打开设置是瞬时的。运行中的会话保持启动时的终端类型——这是 DSH 的装配语义。
- 能力或设置服务不可用时行内会说明原因（例如「当前 DSH 版本不支持自动切换：{reason}」）；配置只读时所有控件禁用。非 Windows 上整行不渲染。

设置行通过两条 `/api` 路由（都不写配置；写入仍走 `configForms`，落 profile patch 层）：

| 路由 | 作用 |
|---|---|
| `POST /api/dsh-terminal-tool/state` | 平台、设置可用性、当前值、能力探测。**不扫描**，所以打开设置是瞬时的 |
| `POST /api/dsh-terminal-tool/discover` | 用户点「自动发现」时才调用，返回全部可用候选 |

Config 字段（设置行直接编辑 `dialect`、`confinedPolicy` 与 `bashPath`；点「自动发现」会原子写回 `bashPath` + `bashCandidates`；其余字段仍可直接写 profile patch）：

| 字段 | 说明 |
|---|---|
| `dialect` | `pwsh`（默认，行为不变）/ `bash` |
| `bashPath` | 显式 bash.exe 绝对路径；留空 = 自动发现 |
| `bashCandidates` | 上一次「自动发现」的可用路径（也接受手填的安装根目录） |
| `autoDiscover` | 会话装配时 `bashPath` 为空是否自动发现 |
| `discoverTimeoutMs` | 一次发现的上限（只 stat 文件，不 spawn） |
| `loginShell` | 传 `-l`，读取登录 profile |
| `extraPath` | 追加到子进程 PATH 的目录 |
| `pythonUtf8` | 导出 `PYTHONIOENCODING=utf-8` |
| `confinedPolicy` | Windows 受限档位下的处理方式：`unconfined`（默认，直接启动，不经文件沙箱）/ `escalate`（先走官方沙箱；首次失败返回官方 denial 提示，模型带 `sandbox_permissions` 重试并审批）/ `fail`（抛 `SandboxUnavailableError`，提示改配置） |
| `minimalMode` | 官方 `minimal` 预设的处理方式：`leave`（保留官方持久终端）/ `oneshot`（默认，旧行为，换成一次性 `bash`）/ `variant`（另注册持久 Git Bash 预设 `minimal-gitbash`）。只影响 `minimal` 会话 |
| `timeoutMs` / `maxTimeoutMs` / `maxOutputBytes` / `maxSpillBytes` / `graceMs` | 继承自官方 bash 执行器的同名字段 |

把 `dialect` 改成 `bash`，**新建会话**即可看到工具目录里是 `bash` 而不再是 `pwsh`。已开的会话不受影响。

---

## 自动发现顺序

`bashPath` 为空且 `autoDiscover` 为真时，按下列顺序找，命中即止：

1. `bashCandidates` 里的每一项（展开为 `bin\bash.exe` / `usr\bin\bash.exe`）
2. 注册表 `HKLM\SOFTWARE\GitForWindows` 的 `InstallPath`
3. `%ProgramFiles%\Git`、`%ProgramFiles(x86)%\Git`、`%LocalAppData%\Programs\Git`
4. `%ProgramFiles%\MSYS2`、`C:\msys64`、`%LocalAppData%\MSYS2`
5. `%SystemDrive%\cygwin64`、`%SystemDrive%\cygwin`
6. PATH 上 `git.exe` 反推（`<root>\bin\bash.exe`）

**WSL 被硬排除**：`C:\Windows\System32\bash.exe` 和 `WindowsApps\bash.exe` 都不是 Git Bash，交给执行器会得到另一个操作系统和另一套文件系统。

发现只做文件系统探测（`statSync`）+ 一次异步 `reg.exe query`，**不会 spawn `bash --version`**——宿主在 `agent/created` 里串行派发事件，同步 spawn 会卡住整个进程。

---

## PATH 组装

执行时子进程 PATH = `工具链 bin` → `usr\bin` → `bin` → `usr\local\bin` → `extraPath` → **宿主 PATH**。

顺序是有意的：MSYS2 的 `git`/`ls`/`grep` 必须赢过 Windows 上的同名同源工具，而宿主 PATH 必须保留，否则 `node`/`python` 等原生命令会消失。去重按「小写 + 去尾分隔符 + `/`→`\`」归一化。

---

## 受限沙箱策略（`confinedPolicy`）

Windows 的受限档位（`read-only` / `workspace-write`）把子进程降到 Low 完整性，MSYS2 运行时初始化命名共享内存时被拒，Git Bash 在命令执行前就退出：

```
bash.exe: *** fatal error - NtCreateDirectoryObject(\BaseNamedObjects\msys-2.0S5-…): 0xC0000022
exit -1073741502
```

`confinedPolicy` 决定插件此时怎么走：

| 值 | 行为 | 代价 |
|---|---|---|
| `unconfined`（默认） | 直接以普通权限启动 Git Bash，不调用 `ctx.sandbox.confine()` | 一次调用即成功；模型执行的命令**不受文件沙箱限制** |
| `escalate` | 先按官方方式进入沙箱；MSYS 启动失败被标为 `denied`，模型收到官方升级提示后带 `sandbox_permissions: danger-full-access` 重试，由宿主审批 | 首次失败 + 一次审批往返 |
| `fail` | 抛 `SandboxUnavailableError`，错误信息提示把 `confinedPolicy` 改成 `unconfined`，或带 `sandbox_permissions: danger-full-access` 重试 | 明确报错，不自动重试 |

**结果事实**：`unconfined` 直启时结果把 `sandbox.mode` 报成 `danger-full-access`——这是这次调用**实际**的边界，因为没有任何后端包住子进程；`sandbox.enforcement` 不填（官方枚举描述的是"有活动后端时能保证多少"，此时没有后端可描述）。`escalate` 走 `confine()`，`mode` / `enforcement` 保持官方原值。

**工具声明**：`unconfined` 下执行器不再向 `tool-bash` 声明受限档位（`sandboxMode` 返回 `undefined`），所以模型不会被告知"命令在沙箱内运行"，也不会看到用不上的 `sandbox_permissions`。`escalate` / `fail` 与其它平台仍按官方方式声明。

**安全含义**：`unconfined` 是默认值是显式的产品选择——Windows 受限档位下不这样就没有可用的 Git Bash；它意味着模型通过 `bash` 执行的命令不受文件沙箱约束。需要沙箱约束时选 `escalate`（官方审批）或 `fail`（拒绝执行）。设置行在选中 `unconfined` 时会显示同样的提示。

`escalate` 的审批完全由第一方 `dsh-tool-bash` 负责：`approveEscalation` 在 `execute` 之前调用，批准后以 `danger-full-access` 的 `sandboxPolicy` 进入执行器。插件只把 MSYS 启动失败分类成 `denied`，不自己实现审批，也不修改宿主的沙箱实现。判定同时看退出码（`3221225794` / `3221225506`）与 stderr 签名（`ntcreatedirectoryobject(\basenamedobjects\msys-` / `couldn't create signal pipe`），前台与后台一致。

---

## 极简模式（minimal preset）

官方 `minimal` 预设是唯一自带持久 shell 的出厂预设：它的 `persistent-shell` 组挂的是一行持久 PTY（Windows 上是持久 **pwsh**，POSIX 上是持久 bash），`bash` / `pwsh` 工具由这一组提供。因此它和其它预设不同——插件不能只替换一个执行器，那组持久终端会继续把 pwsh 送到模型面前；而默认行为（`oneshot`）是用一次性 Git Bash 工具盖掉它，持久性随之丢失。

`minimalMode` 只对 agent preset 是 `minimal`（或变体 `minimal-gitbash`）的会话生效，对其它预设没有影响。默认 `oneshot`，即升级到 0.5.0 不改变任何现有行为。

| 值 | `minimal` 会话里发生什么 | 预设选择器里出现什么 |
|---|---|---|
| `leave` | 插件不介入，保留官方持久终端（Windows 上仍是持久 pwsh） | 不变 |
| `oneshot`（默认） | 旧行为：`bash` 换成插件的一次性 Git Bash 工具，`pwsh` 隐藏 | 不变 |
| `variant` | 同样不介入官方 `minimal`；另外注册 `minimal-gitbash`（order `3.1`），它是 `minimal` 的克隆，`persistent-shell` 组改接插件的持久 Git Bash 后端 | 多一项「极简模式 · Git Bash」 |

`variant` 的实质是**新增预设**，不是改写官方 `minimal`：官方定义一个字节都不动，克隆出来的定义 id 为 `minimal-gitbash`，只在该选项为 `variant` 时注册。变体行里嵌入的是**注册那一刻**解析出的 Git Bash 绝对路径；之后改 `bashPath`（或 `confinedPolicy` / `loginShell` / `pythonUtf8`）会让定义按新输入重建，已在运行的变体会话仍跑旧的那一版，不受影响。

### 变体的生命周期

- `variant` 只负责把变体放进预设名册，不改默认预设、也不替用户选会话。
- 选项为 `variant` 且能解析到 Git Bash 时注册，状态 `registered`；注册成功后校验一次预设名册，缺失或损坏则报 `failed` 并给出原因（校验放在注册之后、且必须等插件激活返回再执行——激活期间调 `agentPresets.list()` 会与 Host Loader 互等死锁）。
- 选项关掉后**不一定**立刻注销。若还有会话引用 `minimal-gitbash`（活跃会话的 preset，或已持久化的会话头），定义保留，状态变为 `retained` 并显示引用数。原因是官方恢复路径按 id 解析预设且没有回退：删掉定义，这些会话会永远打不开，用户只会看到一个笼统的 `gateway/internal`。
- 只有当没有任何会话引用时，定义才真正注销，状态回到 `absent`。
- 变体不可用（找不到 Git Bash、构造失败）时**不会**静默回落到 `oneshot`：`minimal` 会话按 `leave` 处理，设置行显示 `failed` 与原因。静默回落等于「设了却没生效」，这里宁可明说。

### 怎么用

新建会话时打开预设选择器，选「极简模式 · Git Bash」（`minimal-gitbash`）。名册是界面挂载时拉的，如果选择器是注册前就打开的，重开一次即可看到。已开的会话不会被重新组装：替换发生在会话创建时，改选项或改预设都只影响之后新建的会话。

持久后端没有 `sandbox_permissions` 升级通道，所以 `escalate` 在这条路上无法完成升级：`unconfined`（默认）直接启动 Git Bash；`escalate` 仍会走官方受限路径并撞上 MSYS 启动失败，但没有可用的重试入口；`fail` 直接抛 `SandboxUnavailableError`。另外，官方 `ensureSandboxModeFence` 禁止在持久终端打开期间切换沙箱档位，这算一条限制，见「已知限制」。

设计依据、三个选项的取舍与风险分析见 [`docs/PLAN-minimal-mode.md`](docs/PLAN-minimal-mode.md)。

---

## 排障

诊断日志（每次会话一行）：

```
%TEMP%\dsh-terminal-tool.log
```

用 `DSH_TERMINAL_TOOL_DIAG_FILE` 覆盖路径。典型行：

```
[2026-10-18T02:10:00.000Z] ok session=... bash=C:\Program Files\Git\bin\bash.exe source=registry path=4 entries
[2026-10-18T02:10:00.000Z] skip session=... reason=bash-not-found: C:\Program Files\Git\bin\bash.exe: file does not exist
[2026-10-18T02:10:00.000Z] skip session=... reason=already-replaced
```

`reason` 取值：`not-win32` / `dialect-pwsh` / `no-agent-context` / `already-replaced` / `bash-not-found` / `missing-service` / `minimal-left` / `mount-failed`。`minimal-left` 表示会话用的是 `minimal` 预设且 `minimalMode` 为 `leave` 或 `variant`，插件按设计让开官方实现。

排查思路：

1. **工具目录还是 pwsh** → 先看日志有没有 `ok session=`。没有 `ok` 就按 `reason` 走。
2. **`bash-not-found`** → 把 `bashPath` 显式指到 `C:\Program Files\Git\bin\bash.exe` 试试。
3. **`mount-failed`** → `detail` 里是 cordis 的原始错误（常见是配置校验或服务缺失）。
4. **bash 能出现但命令报错** → 见「已知限制」第 3、4、5 条。

插件永不因自身问题让会话创建失败：`agent/created` 是串行派发的，监听器抛错会让 agent 注册失败，所以整个监听体是防御式的，任何异常只落日志。

---

## 与其他插件共存

本插件的占用面（都带 `terminal-tool` / `dsh-terminal-tool` 前缀，冲突时以先加载者为准）：

| 面 | 名字 |
|---|---|
| 设置行 slot | `settings.general.item`，id `terminal-tool`，order `60` |
| locale 命名空间 | `terminal-tool` |
| bundle 行 id | `terminal-tool`（`cordis.patch.yml`） |
| Host 路由 | `/api/dsh-terminal-tool/state`、`/api/dsh-terminal-tool/discover` |
| 会话内工具 | 替换 `bash`、隐藏 `pwsh`（仅被替换的会话） |

- **不写全局**：不改 `ctx.shell`、不改任何已加载的 preset、不写宿主安装目录。效果只落在 `agent/created` 时替换的那个会话上。
- **与另一个 Git Bash 插件（如 `dsh-gitbash-shell`）同时安装**：两者都想替换会话的 `bash` 工具。本插件在发现同 scope 已有 `bash` 工具时跳过替换（`already-replaced`），但**不区分**那个 `bash` 是否来自本插件；此时设置行仍显示当前选择，实际会话可能用的是另一份执行器。只装一个即可。
- **与持久终端 bundle（`@deepseek-ai/dsh-experimental-terminal-bundle` 等）**：该 bundle 提供全局的 `terminal_*` 工具，并自带一个隔离的 `terminals` 注册表；本插件的 `pty` 入口只在某个预设的持久终端组里注册后端，两者不共享注册表，互不读写对方状态。官方 bundle 已安装时，变体预设自己的组里仍先装官方 `pty` 行，再装本插件的 `gitbash-pty` 行，`terminal_*` 工具照常工作。详见下文。
- **与 UI 插件（如侧边栏 / 快捷键）**：只在设置页占用一行、一个 locale 命名空间，无其它 DOM 或全局状态。
- **热禁用**：禁用插件后，已按 Git Bash 装配的会话不会切回 `pwsh`（工具与 prompt 段在会话创建时定稿）；新会话恢复官方终端工具。变体预设随插件一起注销（插件不在了，定义也留不住）。

### 与 `@deepseek-ai/dsh-experimental-terminal-bundle` 的分工

官方 bundle 是**全局**的：它在宿主平面注册 `terminal_*` 工具，并拥有一个独立的 `terminals` 服务与注册表（默认 `pty` 后端）。本插件不接管、不注册也不读取那个注册表。

本插件新增的 `dsh-terminal-tool/pty` 入口是另一种粒度：它把自己注册为 `gitbash` 类型的后端，而调用的位置在 `minimal` 克隆体自己的持久终端组（`isolate: { terminals: true }`）里。每个预设的 terminals 组是隔离的，所以两边的后端各归各的。

若官方 bundle 已安装，变体预设的组里依然是官方 `pty` 行在前、本插件的 `gitbash-pty` 行在后，`terminal_*` 工具由前者的后端提供，本插件只是让组内的 `bash` 走持久 Git Bash。两者同时存在不会争抢同一注册表。

---

## 已知限制

1. **仅 Windows**。非 Windows 上 patch 行的 `disabled` 为真，插件根本不加载。
2. **只对新会话生效**。工具与 prompt 段是会话创建时装配的，运行中无法替换。
3. **受限沙箱下 Git Bash 无法直接进入沙箱**。`read-only` / `workspace-write` 用受限令牌执行，MSYS2 无法创建 `BaseNamedObjects`：
   ```
   bash.exe: *** fatal error - NtCreateDirectoryObject(\BaseNamedObjects\msys-2.0S5-…): 0xC0000022
   exit -1073741502
   ```
   **这是宿主沙箱行为，与插件无关**，插件不修改它。默认 `confinedPolicy: unconfined` 会直接启动 Git Bash，代价是模型命令不受文件沙箱限制；改选 `escalate` 则走官方审批，改选 `fail` 则直接报错。详见「受限沙箱策略」。
4. **原生 Windows 程序输出可能乱码**。`cmd`/`tasklist`/`powershell` 按 ANSI 代码页（中文系统为 936）写管道，DSH 按 UTF-8 解码 → 中文乱码；`chcp 65001` 无效。仅 Python 可用 `PYTHONIOENCODING` 缓解（默认已开）。
5. **`cmd /c` 会被 MSYS 参数改写**，需写 `cmd //c` 或设 `MSYS2_ARG_CONV_EXCL='*'`。
6. **首次安装必须重启 DSH**（理由见「安装」）。
7. **极简模式的变体不是自动生效的**：
   - (a) 变体必须**每个新会话手选一次**（预设选择器里选「极简模式 · Git Bash」）。已存在的 `minimal` 会话不会被重新组装，改选项只影响之后新建的会话。另外，预设名册只在界面重新挂载时重拉，注册后要**重开新建会话界面**才看得到变体。
   - (b) 关掉选项**不一定能移除变体**。仍有会话引用 `minimal-gitbash` 时定义会保留（`retained`），否则那些会话会永久打不开；没有会话删除 API，这些引用不会自行过期。
   - (c) 持久终端没有沙箱升级通道：`escalate` 在变体里仍走受限路径并失败，但没有重试入口，实际表现等同「受限档位下拒绝执行」。
   - (d) 持久终端打开期间不能切换沙箱档位（官方 `ensureSandboxModeFence` 的约束）。
8. **宿主版本范围 `>=0.2.1-rc.2 <0.3.0`**。设置行依赖 Web shell 自带的官方 UI atoms 模块表；宿主大版本变更后需重新验证。

---

## 工程结构

```
src/index.ts      插件入口：apply / Config / agent 事件
src/config.ts     schemastery Config（全 volatile）+ 会话级快照
src/discover.ts   Git Bash 自动发现（含 WSL 排除）
src/paths.ts      路径算术：安装根、PATH 条目、校验、PATH 合成
src/executor.ts   GitBashExecutor（继承 LocalBashExecutor，含沙箱分支）
src/confined.ts   受限沙箱启动决策（planLaunch）与 MSYS 启动失败签名
src/preset.ts     预设变体管理：克隆官方 minimal 行、注册 / 注销、引用计数
src/pty.ts        dsh-terminal-tool/pty 入口：注册 gitbash 类型的持久终端后端
src/replace.ts    每会话替换 + 逆序回滚
src/diag.ts       诊断日志
src/types.ts      共享类型
src/shared/protocol.ts  Host/客户端共享的线路协议（路由路径、常量、视图类型）
src/routes.ts      两条 /api 路由：/state 与 /discover（都不写配置）
src/client/        客户端半区：设置 → 通用 的「终端工具」行
                  index.ts 注册 settings.general.item；row.tsx 是行组件（官方 UI atoms）；
                  store.ts 是状态机（自动发现、写回、错误）；api.ts 取数；styles.ts 只放版式
src/testing.ts     仅测试用的第二入口（不发布）
```

```powershell
npm run typecheck     # tsc --noEmit（devDeps 钉 0.2.1-rc.2 真 .d.ts，含官方 UI atoms 类型）
npm run build         # esbuild → lib/index.js（Host ESM）+ lib/client.js（客户端半区）+ lib/pty.js（持久终端入口）；react、官方 UI atoms 与 dsh-terminal-bash 均保持 external
npm run contractcheck # Config 全 volatile / patch 行 / 导出面 / 客户端半区装载形状 / bundle 未内联第一方 / atom specifier 保持 external（17 项）
npm run clientsmoke   # 真实执行 lib/client.js：模块装载形状、react 与 atom external、apply 注册行、无 configForms 时降级、迟到服务替换、HMR 幂等（8 项）
npm run rowselftest   # 行状态机 15 项：/state 读取、乐观写入、自动发现持久化、各类失败提示
npm run rendertest    # 在 jsdom 里真实渲染并点击：按 role/aria 断言下拉触发器、菜单项与路径 Input（14 项；官方 atoms 由 scripts/primitives-double.mjs 顶替）
npm run selftest      # 路径、发现、快照、受限启动决策、/api 路由注册、预设行克隆与变体生命周期 51 项
npm run integration   # 在真实第一方服务上跑完整替换流程（13 项）
npm run check         # typecheck → build → contractcheck → clientsmoke → selftest → rowselftest → rendertest → integration
```

设计文档见 [`docs/DESIGN.md`](docs/DESIGN.md)：能力清单、模块划分、决策理由、偏离项与待验证项。

---

## 许可

MIT，见 [LICENSE](LICENSE)。
