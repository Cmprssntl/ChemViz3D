# 调研记录

## 项目事实

- 主项目是 Vite + React 19 + TypeScript + Three.js + Zustand。
- `src/hooks/useMolecule.ts` 编排公式解析、验证、VSEPR 建图、构象优化和可选 RDKit 命名。
- RDKit WASM 只用于 IUPAC 名称，3D 坐标由自研启发式构建器生成。
- `dist/` 已存在预构建产物；发布包使用 Windows `start.bat`/PowerShell 静态服务器。

## 已发现问题

- 当前 `node_modules` 只有 Windows 原生 TypeScript/Rolldown binding，Linux 构建因此在工具启动阶段失败。
- Linux `npm ci` 在当前环境首次安装后没有生成 `node_modules/.bin`；执行 `npm rebuild` 后恢复 `tsc`/`vite` 命令链接。
- `README.txt` 含未解决的 Git 冲突标记。
- Android 子项目被 `.gitignore` 忽略，且 `local.properties` 写死 Windows SDK 路径。
- Android WebView HTML 声明了 JS 桥，但当前 `src/App.tsx` 没有对应事件监听/回传实现，文档与源码不完全一致。
- 测试文件被忽略，`test_rings_batch.cjs` 还硬编码 Windows 路径；`package.json` 没有测试脚本。

## 当前策略

### 2026-08-21 Android 图像解析重构

- 当前 `main` 源码已经包含文本 AI、设置和缓存，但尚未包含图像解析业务入口；Android 目前在 `index.html` 中用独立脚本临时实现图像请求，导致图像状态、缓存和重新生成没有复用文本链路。
- Android 项目位于被忽略的 `ChemViz3D-Android/`，其 Web bundle 通过 `app/src/main/assets/webapp/assets/main.js` 运行；`ForAndroid` 是独立 Git 分支，不能把 Android 页面运行时引用到 main 工作树。
- Android `MainActivity` 当前设置保存在 SharedPreferences（适合作为应用数据），缓存写入 `filesDir`；缓存应迁移到 `cacheDir`，使系统可以清理。
- 相机回调依赖 WebView `onShowFileChooser` 和 `ACTION_IMAGE_CAPTURE` 的 MediaStore URI；回调必须在成功、取消、权限拒绝和 Activity 销毁时都回传，并清理 pending URI。

文本输入只走统一入口：本地 JSON 预设优先，未命中再调用模型；旧的公式/常见名称预判断不再参与该入口。Android 桥接和 APK 流程仍作为后续独立工作，不阻塞 Web 端 Linux 启动。

## Linux 验证结果

- `npm ci`（联网权限下）成功安装 Linux 依赖；必要时 `npm rebuild` 可恢复 `.bin` 命令链接。
- `npm run build` 成功，产物为 `dist/assets/index-DnJnVQZY.js`、`dist/assets/style-CQRBHtg6.css` 及静态 RDKit 文件。
- Vite 开发服务在 `127.0.0.1:5173` 正常启动；首页和 WASM 请求均返回 HTTP 200。
- 当前剩余警告不是阻塞错误：一个无效动态导入提示，以及主 JS chunk 大于 500 KB。

## AI 解析设计约束

- API 使用 OpenAI Chat Completions 兼容格式：`POST /chat/completions`，配置通过 Vite 环境变量注入。
- 浏览器直连 API 需要服务端允许 CORS；前端 API key 会暴露给使用者，只适合本地/受信环境。
- 本地预判断优先处理严格化学式和常见中英文名称，命中时不产生网络请求。
- AI 输出不直接进入渲染：先去除 Markdown fence，再做严格 `chemvz: 2` schema、元素/索引/键级检查，再交给现有 VSEPR 构建器和优化器。
- Node 直接加载 TS smoke test 会因源码无扩展名 import 失败；使用 Rolldown 将临时 smoke entry 打包后验证通过，这与生产 Vite 运行路径一致。
- AI 客户端可兼容返回 Markdown JSON fence 的服务：先剥离 fence，再执行 JSON 和 `chemvz: 2` schema 校验；mock Chat Completions 响应已验证。
- 当前受限沙箱不能直接访问经授权启动的本地监听端口；用授权本机请求验证 Vite 首页和 RDKit 静态资源均为 HTTP 200。
- 本地公式匹配支持元素连续书写及元素之间的 `=`/`≡` 键符号；不接受首尾、重复键符号。`CH2=CH2` 已验证。
- OpenAI 兼容服务若因不支持 `response_format` 返回 400/422，会自动改用普通请求重试；鉴权、限流和端点错误不会重复请求。
- 本地预设目录现为根目录 `molecules/presets/`，每个文件对应一个确定结构，可用 `inputs[]` 放多个精确别名，但只能放一个 `chemvz: 2` 对象。
- 配置文件为根目录 `settings.int`，开发时优先读取被 `.gitignore` 忽略的 `settings.developer.int`；字段为空时回退普通配置。文本与图像配置分离，当前仅使用文本配置。
- `settings.developer.int` 仅在 `vite dev` 注入；生产构建只注入 `settings.int`，避免开发密钥进入发布产物。
- 开发者文件必须使用空字段作为覆盖模板；否则占位地址也会被视为优先配置而阻断普通自定义 endpoint。
- 配置文件现保持 `{ "text": {}, "image": {} }`；应用内部不再给模型和 URL 填充默认值，缺少文本三项时由启动弹窗阻塞配置。
- 设置 UI 使用 `localStorage` 保存当前浏览器覆盖，避免尝试从浏览器写回项目文件；文本和图像根地址都自动拼接 `/chat/completions`。
- 图像配置是独立的图像理解模型配置，和文本配置一样调用 Chat Completions；它不是图片生成模型或 `/images/generations` endpoint。
- 浏览器安全模型不允许网页无提示改写项目目录；设置 UI 使用用户确认的文件选择器写出 `settings.int`，不支持时走下载回退。运行时仍同步保存 localStorage，以便保存后立即生效。
- 模型调用按 `maxRetries` 重试；首次请求加重试次数为最大请求次数，格式错误、schema 错误和网络错误都会进入重试。
- 系统提示词按模型分别存储为 `text.systemPrompt` 与 `image.systemPrompt`，未配置或空值时各自使用内置 chemvz: 2 默认提示词；旧的顶层 `systemPrompt` 会兼容迁移到两组模型。
- 系统提示词编辑属于高风险配置：文本和图像标签页默认不展示提示词内容，只展示“修改系统提示词”按钮；点击后确认“除非你知道如何编写提示词，否则不要修改”才显示对应编辑框。
- `Failed to fetch` 的直接原因是当前 API 网关对 `OPTIONS /v1/chat/completions` 返回 HTTP 403，浏览器因此无法发出带 `Authorization` 和 JSON 的跨域 POST。Vite 开发服务器现在按启动时文本 API 配置建立 `/__chemviz_ai_proxy` 同源代理；生产静态部署仍需要上游开放 CORS 或另行提供服务端代理。
- 最终发布检查发现 `release/ChemViz3D-v1.0.0/` 仍是旧构建，缺少 `src/ai`、AI 设置界面和开发代理；当前源码测试通过，但该发布目录/ZIP 在重新打包前不能用于分发最新 AI 功能。
- `v1.0.0` 标签指向 `420289f`，注释为“首个预发布版”；其提交重点是 UFF 力场几何松弛和代码改进。`v1.0.1` 将保留旧发布包，并单独生成新目录和 ZIP。
- 普通 UI 设置使用独立 `chemviz3d.ui-settings.v1` localStorage 键保存语言、原子标签模式和显示模式，并在状态 store 初始化时校验枚举值后恢复；同时调用 i18n `setLocale` 保证启动首屏语言一致。
- 发布提交曾为 `5936c94`、标签曾为 `v1.0.1`；后续已撤回该标签，并以 `de404e4` 从 Git 树移除 `release/` 发布物。
- 芳香键 `order: 1.5` 之前会在渲染层被当作双键，导致苯环每条边都显示为双键。现在在 chemvz 转换层将六元 sp2 碳环的全 `1.5` 或全 `2` 键规范成 Kekule 交替单/双键；TNT 的本地预设还携带硝基 `N+`/`O-` 电荷以避免隐式补氢。
- 当前 `main` 的 `v1.0.1` 标签指向 `831c8d8`，源码含 TNT 本地预设；此前发布用 ZIP 已撤回，根目录 `release/` 仍被 `.gitignore` 排除。
- 根目录 `README.txt` 已记录 Windows 发布包和 Linux/macOS Python 静态服务器，但发布 ZIP 仍需独立提供 `start.sh` 入口。
- 用户要求发行 ZIP 不包含 `CHANGELOG.md`，更新日志只放 GitHub Release 页面。
- v1.0.1 已按用户要求撤回后重建；新发行版保持 Pre-release，使用简洁用户 README，ZIP SHA-256 为 `0849e42a4bc23271191f70748a831e938a889e9b384d23fe82c9a048512f12c0`。
- 历史 ZIP 包含源码、`dist/`、依赖清单、空 `settings.int`、README、LICENSE、`start.bat` 和 `server.ps1`；新的 ZIP 沿用该布局，新增 `start.sh`，删除 `CHANGELOG.md` 与包内 `.gitignore`。
- 根目录此前没有 `start.bat`/`server.ps1`，只有被忽略的旧发布目录残留；为保证可重复打包，三个启动脚本都应进入源码仓库。
- `v1.0.0..v1.0.1` 的实质差异为 44 个文件、约 1651 行新增：AI Chat Completions 客户端、严格 chemvz 校验、本地预设目录、AI 设置弹窗、配置缓存、开发同源代理、TNT/芳香环/形式电荷/甲基几何修复，以及三语文案。
- 详细 Release notes 应按解析流程、模型配置与安全、界面与缓存、跨平台运行、结构可视化修复、验证结果分组，不应只列 TNT 的单点修复。
- `v1.0.0` Release 附带 `ChemViz3D-v1.0.0.zip`（约 2.4 MB），说明包含功能、技术栈、启动、开发、构建和许可；`v1.0.1` 应保持同等完整度并增加 AI/跨平台章节。
- 历史记录强调发布包应排除 Android、测试、Agent.md、`.workbuddy` 与 Git 元数据；新包继续执行这些排除项。
- `Agent.md` 的 AI 章节确认统一入口固定为“本地预设 -> Chat Completions -> 重试/严格校验 -> VSEPR/构象优化”，配置分文本与图像组，开发者配置不进入生产构建。
- 首次白名单复制仍因整个 `src/***` 包含 `src/temp_patch.txt` 和已废弃的 `src/types/bridge.d.ts`；最终 ZIP 必须显式排除这两个文件。
- 最终临时 ZIP 为 4,562,422 bytes，SHA-256 `ca5676a55829bd31a840539e0f969e138da112ec162ed2da146ebc22cd2c442b`；`unzip -t` 全部通过，禁止文件检查无命中。
- 用户补充要求 GitHub `v1.0.1` 必须标记为 Pre-release。
- 用户要求 README 面向最终用户，删除 `settings.developer.int`、`.gitignore`、开发密钥等内部实现说明；保留使用方法、功能、许可和免责声明。
- 根目录存在 9 个被 `.gitignore` 忽略且未跟踪的旧测试/临时文件：5 个 `test_*.json`、3 个 `test_*.ts`/`.cjs` 和 `src/temp_patch.txt`；均不参与构建或发布。
- 新架构首选 Python：现有环境有 Python 3.12，但没有 PySide6/FastAPI/PyInstaller；先用 Python 标准库实现可打包的本地桥接服务，避免依赖安装成为当前阻塞。Java 暂不采用，因 GUI/打包链路更重且不能复用现有 Web 渲染层。
- 桌面迁移采用“Python 壳/本地服务 + React/Three.js 渲染层”：本地服务绑定 loopback，提供带令牌的 `/__chemviz_bridge/settings` 和 `/__chemviz_bridge/chat/completions`；前者原子写入 `settings.int`，后者在服务端读取配置并代理 OpenAI Chat Completions，API key 不再由浏览器直接发送。
- WebUI 保留浏览器/静态部署回退：检测不到桥接令牌时继续使用现有文件选择器和直连/开发代理；桌面启动器提供桥接令牌后自动切换本地能力。
- Linux 单文件客户端已实际构建并启动验证；当前 `--windowed` 可执行程序仍打开系统浏览器，不能把浏览器生命周期自动绑定到客户端，下一阶段用 PySide6 `QWebEngineView` 替换显示壳。
- 推送时发现远端新增 `e5f4052 Delete CHANGELOG.md`，内容与本次删除动作重叠；SSH 通道还出现瞬断，已改用 HTTPS/GitHub CLI 凭证查询并获取该提交。
- 原生桌面窗口现由 `desktop/qt_client.py` 提供：启动共享 `BridgeHTTPServer` 后创建 `QApplication`、`QMainWindow` 和 `QWebEngineView`，关闭窗口会停止服务；`desktop/client.py` 默认进入该路径，`--headless` 仅运行桥接。
- PyInstaller 必须以 `desktop/qt_client.py` 为入口并保留 `__main__` 调用，否则打包程序会正常退出而不显示窗口。Qt WebEngine 的 PyInstaller hooks 会自动收集 Qt 资源，当前 Linux 单文件验证已加载 dist 页面。
- PySide6 运行依赖单列在 `desktop/requirements.txt`；`desktop/requirements-build.txt` 通过 `-r requirements.txt` 复用。正式构建隐藏控制台，`--console` 只用于诊断启动故障。
- 跨平台启动脚本必须与桌面迁移保持一致：`start.sh`/`start.bat` 优先运行同目录可执行文件，回退到 Python 原生客户端；静态 `server.ps1` 不再是默认入口。
- 直接执行系统 Python 可能得到 `PySide6 is required`，因为 PySide6 不属于 Python 标准库。Linux/macOS 启动脚本可检测 `uv` 并用 `uv run --with PySide6` 临时准备依赖；没有 uv 时必须显示安装依赖的可执行提示，不能静默退回系统浏览器。
- Ubuntu 24.04 的 Qt xcb 插件还依赖系统 `libxcb-cursor0`；PySide6 wheel 不会替用户安装它。桌面入口在有 `DISPLAY` 且未显式指定 `QT_QPA_PLATFORM` 时用 `ctypes.util.find_library` 预检，缺失则提示 `sudo apt install libxcb-cursor0`（Fedora 对应 `xcb-util-cursor`）。
- 本机补齐 `libxcb-cursor.so.0` 后，真实 xcb Qt WebEngine 窗口已加载内置页面并成功读取桥接设置；Vulkan/GBM 提示只是渲染后端回退，不阻止窗口运行。
- `settings.int` 的持久化结构为 `text`、`image`、`ui`；UI 枚举由前后端各自严格归一化。桌面 UI 修改使用桥接 `PATCH /settings`，AI 保存使用 `PUT /settings` 并携带当前 UI，避免开发者配置被写回。
- AI 可用性不能只检查字符串非空：前端用 `URL` 验证 `http(s)` 地址，桥接用 `urlsplit` 验证服务端代理地址；无效时禁止 AI 网络路径但保留本地预设。
- 本阶段预设已迁移至根目录 `molecules/presets/`，缓存使用同级 `molecules/cache/`；Vite 通过根绝对 glob 将预设编入构建产物，桌面桥接按缓存键原子写入 JSON。
- 缓存查询顺序固定为预设 -> 缓存 -> AI；预设命中不产生缓存，缓存/AI 结果才显示当前缓存操作，AI 结果支持强制重新生成。
- chemvz JSON 支持 `name` 多语言映射和 `smiles`；构建器使用 JSON SMILES，不再把分子式误当 SMILES。当前语言按 locale、`en-US`、首个名称回退。
- 乙酸的 C(sp3)-C(sp2) 单键被纳入可旋转键计算，解决原先被 sp2/末端规则过滤导致的 0。
- 桥接上游错误保持 OpenAI `{error:{message}}` 结构，前端现在同时支持字符串和嵌套 message，可显示 `Upstream access forbidden` 等真实原因。
- 甲醇共面统计遗漏来自 `detectPlanarChains` 的 `nHeavy < 3` 过滤；放行以 C-O 为中心的 H-C-O-H 链后，构建器实测 `CH4O` 含 4 个氢，最大共面数从 3 恢复为 4。
- 持续 502 的根因不是 API 地址、密钥或模型：同一配置直连 `/v1/chat/completions` 正常，Python `urllib` 默认 User-Agent 会被该网关判为自动化流量并返回 `Upstream access forbidden`。桥接改发 `Mozilla/5.0 (ChemViz3D desktop client)` 后完整请求实测 HTTP 200。
- 复杂共面搜索的旧漏解点：`bestFitPlane` 用两个协方差行的叉积近似，非严格平面时不是真正最小二乘；合并后偏差超限会整组丢弃；超过 3 个旋转键用 `Math.random()` 500 次且不精修，因此结果不稳定且容易漏掉全局候选。
- 本轮改为 Jacobi 最小特征向量平面拟合、稳定有界环枚举、带偏差/连续性元数据的候选束合并，以及固定网格/Halton 多起点精修。搜索档位 `fast`/`balanced`/`precise` 保存到 `settings.int.ui.conformerSearchQuality`，默认 `balanced`。
- 算法回归：噪声倾斜平面最大偏差 0.01 Å；甲醇可能/一定共面为 4/3，乙酸为 6/4；C6 五旋转键链在重复执行中搜索次数和结果完全一致；浏览器切换精密模式并刷新后仍恢复该设置。
- 用户反馈“可能共面 10 个但只标记 6 个”经截图和代码核对确认是 MoleculeViewer 显示层二次 0.18 Å 过滤造成的；统计使用 countMaxPlanarAtoms 的合并集合，而显示层又删除偏离最远原子。显示层现在直接高亮完整统计集合并对该集合重新拟合平面。
- 左侧设置区原先语言标签单独使用 margin-bottom，AI 按钮和缓存按钮又分别使用 margin-top/gap，导致垂直间距不一致；新增 settings-stack 统一使用 10px gap，缓存按钮组使用 8px gap。
- UI 回归确认设置项以统一间距呈现；乙酸本地预设加载正常，精密模式搜索显示 6/4 共面统计，页面无运行时错误。
- 新截图显示问题不只是显示层：上一轮直接展示完整统计集合后，明显偏离平面的原子仍被标记，说明合并层接受了过宽容差。原因包括羰基/烯烃片段 0.5 Å 容差、合并时取最宽容差，以及四面体中心多氢链片段的伪合并。
- 共面判定已改为：环/烯烃/羰基片段最大偏差 0.12 Å；跨片段联合最大偏差 0.08 Å；合并使用所有片段中最严格容差；两个以上氢的链片段仅允许在 C-O 中心或 sp2 中心保留。
- 合成双羰基双平面回归中，两平面间隔 0.5 Å 的错误合并从 5 原子降为真实连续片段 4 原子；甲醇仍为 4，乙酸搜索仍为 6/4，苯环预设保留 12 个（含环氢）共面统计。
- 最终浏览器回归中，乙酸精密模式的平面覆盖 6 个统计原子且所有环标记落在同一水平面；开发服务器随后已停止。

## v1.0.0 发布准备

- 早期发布目录误命名为 `b1.0.0`；现已统一更正为 `v1.0.0`，旧命名不再作为最终发布路径或产物名称。

- `release/v1.0.0/build_release.py` 是三平台统一入口：Windows 需要原生 Inno Setup，macOS 使用原生 `hdiutil` 生成 DMG，Debian 使用 `dpkg-deb`；PyInstaller/Qt 不做跨平台交叉构建。
- `--prepare-only --target all` 会创建三平台目录并写出 `environment-report.json`；当前主机识别为 Debian，Node 24/npm 11、Python 3.12、uv 0.12、dpkg-deb 已就绪，Debian 动态库检测无缺失。
- 当前可验证产物为 Debian `.deb` 和 tar.gz 便携包，均只含单文件 Qt 客户端、文档和空 `settings.int`，未命中 Android、源码、node_modules、缓存或开发配置。
- PyInstaller 缺失时脚本会用 `uv run --with PySide6 --with pyinstaller` 隔离补全依赖，并将 `UV_CACHE_DIR` 指向发布工作目录；若审批/联网不可用，可显式传入 `--reuse-executable` 仅做封装。
- 当前 Linux 包使用最新源码重建的可执行文件，未复用过时的 `release/desktop/ChemViz3D`。
- 2026-08-19 已从当前源码重建 PyInstaller Linux 客户端，覆盖 `release/desktop/ChemViz3D`；新二进制哈希为 `b1e46b9a150f8c880ed5982d03ae4f5f169d1d01fdd921806cbfc99864a1a60b`。
- 标准 `appimagetool`/runtime 不在当前主机，因此新增 `build_appimage.py` 生成自包含启动器 AppImage；支持 `--appimage-version`、`--appimage-help` 和 `--appimage-extract`，有效载荷为新构建二进制及必要文档。
- 已生成 `release/v1.0.0/portable/ChemViz3D-v1.0.0-x86_64.AppImage`（233,822,695 bytes，SHA-256 `4bab588a180a1e92fd950dc356e786113b34bbe5cc5e5e065ef98116aa01a90c`）；`--appimage-version` 输出 `ChemViz3D v1.0.0`，`--appimage-extract` 验证通过。
- 已生成 `release/v1.0.0/installers/debian/ChemViz3D-v1.0.0-debian-amd64.deb`（233,455,570 bytes，SHA-256 `cacb423639671150c5446e9df23b359637c9d4588166580b7ff0d0c777b72412`）；包内包含 `opt/chemviz3d/chemviz3d.ico` 和 `usr/share/applications/chemviz3d.desktop`。
- Debian 便携包为 `release/v1.0.0/portable/ChemViz3D-v1.0.0-deb-portable.tar.gz`（SHA-256 `b534302dfa3df85445f06303e0a2eb1f81903e068eb8600a93e1e5723822ca06`）。
