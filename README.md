# dsh-terminal-tool

在 Windows 上把模型的终端工具从 **pwsh** 换成 **本机 Git Bash** 的 DSH 插件。

设计取向：**一个开关、所有 preset 跟随、不动 preset 文件、不接管全局 `ctx.shell`**。默认 `dialect: pwsh`，装上去什么都不变；改成 `bash` 后，**新会话**拿到 `bash` 工具、`pwsh` 从该会话的工具目录里消失，已开的会话保持原状。

> **临时替代方案**：DSH 目前没有内置的「终端 / Git Bash 选择」能力。**在官方能力落地前，本插件是它的临时替代方案**——用官方已发布的执行器与工具，把 Windows 上新会话的终端换成 Git Bash。**官方提供等价设置后即可停用本插件**：从 profile 依赖里移除本行并重启，新会话即回到官方终端工具。插件不改 DSH 安装目录、不改任何 preset、不接管全局 `ctx.shell`，配置只写进当前 profile 的 patch 层；卸载不需要清理任何全局状态。

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

1. **执行器**：`GitBashExecutor extends LocalBashExecutor`，只改两处——
   - `execute()` 用配置的 `bash.exe` 绝对路径组 `[bash, -c, command]`（基类硬编码 `"bash"`，在 Windows 上会命中 `System32\bash.exe`，那是 WSL 启动器）；
   - `resolve()` 注入 `PATH`（`spawnSpec` 里 `spec.env` 是唯一能塞 PATH 的位置）。

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
- **不绕过沙箱**：受限模式下仍走 `ctx.sandbox.confine()`，起不来就如实把官方错误交给模型。

---

## 安装

### 前置条件

- Windows + DSH Desktop `>=0.2.1-rc.2 <0.3.0`（`package.json` 的 `engines.dsh` 范围；本插件在此范围内开发与验证）
- **Web shell 自带 `@deepseek-ai/dsh-client-ui-primitives`**：0.2.1-rc.2 起该包由 Web shell 的冻结模块表（`PLATFORM_MODULES`）播种，插件设置行的 bundle 像 `require('react')` 一样 `require()` 它，不会内联第二份 atoms。宿主升级到范围外时设置行可能加载失败，但 Host 半区的替换逻辑不依赖这张模块表
- 本机已装 Git for Windows（或 MSYS2 / Cygwin）
- 想用受限沙箱的话，见下面「已知限制」第 3 条

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
- **挂载时不扫描、不写配置**：扫描只在点「自动发现」时发生，并把选中的 `bashPath` 与可用列表 `bashCandidates` 原子写回；`/state` 只读配置，所以打开设置是瞬时的。运行中的会话保持启动时的终端类型——这是 DSH 的装配语义。
- 能力或设置服务不可用时行内会说明原因（例如「当前 DSH 版本不支持自动切换：{reason}」）；配置只读时所有控件禁用。非 Windows 上整行不渲染。

设置行通过两条 `/api` 路由（都不写配置；写入仍走 `configForms`，落 profile patch 层）：

| 路由 | 作用 |
|---|---|
| `POST /api/dsh-terminal-tool/state` | 平台、设置可用性、当前值、能力探测。**不扫描**，所以打开设置是瞬时的 |
| `POST /api/dsh-terminal-tool/discover` | 用户点「自动发现」时才调用，返回全部可用候选 |

Config 字段（设置行直接编辑 `dialect` 与 `bashPath`；点「自动发现」会原子写回 `bashPath` + `bashCandidates`；其余字段仍可直接写 profile patch）：

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

## 已知限制

1. **仅 Windows**。非 Windows 上 patch 行的 `disabled` 为真，插件根本不加载。
2. **只对新会话生效**。工具与 prompt 段是会话创建时装配的，运行中无法替换。
3. **受限沙箱下 Git Bash 起不来**。`read-only` / `workspace-write` 用受限令牌执行，MSYS2 无法创建 `BaseNamedObjects`：
   ```
   bash.exe: *** fatal error - NtCreateDirectoryObject(\BaseNamedObjects\msys-2.0S5-…): 0xC0000022
   exit -1073741502
   ```
   需要 `danger-full-access`。**这是宿主沙箱行为，与插件无关**，插件不会绕过它。
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
npm run rowselftest   # 行状态机 13 项：/state 读取、乐观写入、自动发现持久化、各类失败提示
npm run rendertest    # 在 jsdom 里真实渲染并点击：按 role/aria 断言下拉触发器、菜单项与路径 Input（9 项；官方 atoms 由 scripts/primitives-double.mjs 顶替）
npm run selftest      # 路径、发现、快照、/api 路由注册 28 项
npm run integration   # 在真实第一方服务上跑完整替换流程（5 项）
npm run check         # typecheck → build → contractcheck → clientsmoke → selftest → rowselftest → rendertest → integration
```

设计文档见 [`docs/DESIGN.md`](docs/DESIGN.md)：能力清单、模块划分、决策理由、偏离项与待验证项。

---

## 许可

MIT，见 [LICENSE](LICENSE)。
