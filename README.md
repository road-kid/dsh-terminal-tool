# dsh-terminal-tool

在 Windows 上把模型的终端工具从 **pwsh** 换成 **本机 Git Bash** 的 DSH 插件。

设计取向：**一个开关、所有 preset 跟随、不动 preset 文件、不接管全局 `ctx.shell`**。默认 `dialect: pwsh`，装上去什么都不变；改成 `bash` 后，**新会话**拿到 `bash` 工具、`pwsh` 从该会话的工具目录里消失，已开的会话保持原状。

> **临时替代方案**：DSH 目前没有内置的「终端 / Git Bash 选择」能力。**在官方能力落地前，本插件是它的临时替代方案**——用官方已发布的执行器与工具，把 Windows 上新会话的终端换成 Git Bash；Windows 受限沙箱档位下的 `confinedPolicy` 同属这段临时接线。**官方提供等价设置后即可停用本插件**：从 profile 依赖里移除本行并重启，新会话即回到官方终端工具。插件不改 DSH 安装目录、不改任何 preset、不接管全局 `ctx.shell`，配置只写进当前 profile 的 patch 层；卸载不需要清理任何全局状态。

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

插件本身不实现终端。它做四件事，全部复用第一方组件：

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
- **不编辑 preset**：`preset-standard` 在 profile 里是完整快照，改它等于接管用户的组合文件，且升级会被覆盖。
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

`reason` 取值：`not-win32` / `dialect-pwsh` / `no-agent-context` / `already-replaced` / `bash-not-found` / `missing-service` / `mount-failed`。

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
- **与持久终端插件（`@deepseek-ai/dsh-experimental-terminal-bundle` 等）**：互不干扰。持久终端是独立的 `terminals` 服务与 `terminal_*` 工具，本插件不注册后端、不读它的状态；`terminal-*` 工具里的 shell 仍由该 bundle 自己的后端决定。
- **与 UI 插件（如侧边栏 / 快捷键）**：只在设置页占用一行、一个 locale 命名空间，无其它 DOM 或全局状态。
- **热禁用**：禁用插件后，已按 Git Bash 装配的会话不会切回 `pwsh`（工具与 prompt 段在会话创建时定稿）；新会话恢复官方终端工具。

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
7. **`minimal` preset 的持久 shell 会退化为一次性 shell**。持久终端由 `dsh-terminal-bash` 后端提供，本插件只替换一次性 `bash` 工具。
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
npm run build         # esbuild → lib/index.js（Host ESM）+ lib/client.js（客户端半区；react 与官方 UI atoms 均保持 external）
npm run contractcheck # Config 全 volatile / patch 行 / 导出面 / 客户端半区装载形状 / bundle 未内联第一方 / atom specifier 保持 external（15 项）
npm run clientsmoke   # 真实执行 lib/client.js：模块装载形状、react 与 atom external、apply 注册行、无 configForms 时降级、迟到服务替换、HMR 幂等（8 项）
npm run rowselftest   # 行状态机 15 项：/state 读取、乐观写入、自动发现持久化、各类失败提示
npm run rendertest    # 在 jsdom 里真实渲染并点击：按 role/aria 断言下拉触发器、菜单项与路径 Input（12 项；官方 atoms 由 scripts/primitives-double.mjs 顶替）
npm run selftest      # 路径、发现、快照、受限启动决策、/api 路由注册 35 项
npm run integration   # 在真实第一方服务上跑完整替换流程（8 项）
npm run check         # typecheck → build → contractcheck → clientsmoke → selftest → rowselftest → rendertest → integration
```

设计文档见 [`docs/DESIGN.md`](docs/DESIGN.md)：能力清单、模块划分、决策理由、偏离项与待验证项。

---

## 许可

MIT，见 [LICENSE](LICENSE)。
