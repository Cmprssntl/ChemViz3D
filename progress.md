# 工作进度

## 2026-08-21 Android 图像解析重构

- 开始独立 Android Web 源码副本与图像 AI 统一解析改造。
- 发现 Android 当前图像解析完全写在专用 `index.html`，未复用 main 的 `useMolecule`、缓存、重试和 loading；发现 Android 缓存仍写入 `filesDir`。

## 2026-08-16

- 完成项目结构、构建配置、运行入口和 Android 子项目审阅。
- 确认 `npm run build` 因缺少 Linux TypeScript 原生 binding 失败。
- 确认 `npm exec vite build` 因缺少 Linux Rolldown binding 失败。
- 确认当前工作区有用户未提交修改，后续不回退、不清理。
- 已建立本计划，下一步重新安装 Linux 依赖。
- 第一次沙箱内 `npm ci` 只清空了旧依赖，未能下载；联网安装权限下第二次 `npm ci` 成功，Linux TypeScript/Rolldown binding 已恢复。
- `npm ci` 后发现 `.bin` 入口缺失；执行 `npm rebuild`，`tsc --version` 与 `vite --version` 均通过。
- 清理 `README.txt` 未解决的 Git 冲突标记，并补充跨平台安装、开发、静态服务器说明。
- `npm run build` 通过：TypeScript 0 errors，Vite 生成 `dist/`；仅有动态导入和 chunk 大小警告。
- Linux Vite 开发服务器验证通过：`GET /` 返回 200，`GET /RDKit_minimal.wasm` 返回 200，响应大小 6,914,823 字节。
- 验证后已停止开发服务器；没有留下运行中的后台进程。
- 新任务：加入 AI 解析，要求先本地预判断、再调用 OpenAI 兼容 API，并返回 `chemvz: 2` 存储格式。
- 新增 `src/ai/config.ts`、`localParser.ts`、`aiParser.ts`；AI 输出经过元素、键级、索引、杂化和连通性校验。
- 左侧输入新增“AI 解析”按钮；本地命中公式/常见名称时复用原有公式流程，不调用网络。
- 新增 `.env.example` 与 README/Agent.md 配置和安全说明。
- `npm run build` 通过：56 modules transformed；仅保留原有动态导入和 chunk 大小警告。
- Rolldown smoke test：本地预判断 `乙醇`/`benzene`/`C6H6` 成功，描述性输入进入 AI 路径；合法/非法 chemvz schema 分别通过/拒绝。
- OpenAI 兼容客户端冒烟测试通过：mock `fetch` 返回 Markdown fenced JSON，`parseWithAI()` 成功清理、解析并校验，输出 `2 water O`。
- 冒烟测试首次失败由临时夹具错误导致（使用了字面量转义符），修正响应字符串后通过；临时文件已清理。
- Linux Vite 开发服务器已启动于 `http://127.0.0.1:5173/`；从本机请求首页返回 HTTP 200（640 字节），`RDKit_minimal.js` 返回 HTTP 200。
- 修正本地公式预判断的键符号正则；`CH2=CH2` Rolldown 回归测试成功命中本地路径，随后 `npm run build` 再次通过。
- 将 `response_format` 兼容重试限定为 HTTP 400/422，避免 401/403/429 等鉴权或限流错误重复调用；最终构建通过。
- 按新要求改为单一“可视化”入口：本地 JSON 预设优先，未命中才调用模型；删除旧公式/常见名称预判断在该入口中的逻辑和独立 AI 按钮。
- 新增 21 个 `src/ai/presets/*.json`，覆盖当前示例及常见基础分子；每个文件包含多个输入别名和单个 `chemvz: 2` 结构。
- 配置改为 `settings.int` 的 `text`/`image` 分组；`settings.developer.int` 已创建并被 `.gitignore` 忽略，开发配置非空字段优先、空字段回退普通配置。
- 收紧配置注入范围：开发者文件只用于 `vite dev`，`npm run build` 只使用普通配置，避免开发密钥进入发布 bundle。
- 将开发者配置模板改为空覆盖项，避免默认占位模型/地址意外覆盖 `settings.int`；用户填写的非空字段才会生效。
- 按新要求清空 `settings.int` 和开发者覆盖文件的默认值；默认模型、地址不再写入配置文件。
- 新增 `AISettingsDialog`：检测文本 API/模型/根地址为空时启动即弹窗；文本/图像配置分栏，根地址会预览完整请求地址；保存写入浏览器本地存储，可从左侧设置区域再次打开。
- 全新本地 origin UI 验证通过：空配置弹窗显示，`https://mock.local/v1` 在文本和图像标签页都预览为 `https://mock.local/v1/chat/completions`。
- 最终 `npm run build` 通过（75 modules transformed）；Linux Vite 5174 页面 HTTP 200，当前可从 `http://127.0.0.1:5174/` 访问。
- 修正图像模型说明和 endpoint：图像组用于独立图像理解模型，预览地址与文本组一样自动补全为 `/chat/completions`，不再使用图片生成路径。
- 修正设置保存：主保存按钮不再只写 `localStorage`，会通过 File System Access API 写出用户选择的 `settings.int`；不支持文件选择器时自动下载同名文件，同时保留本地存储供当前运行时使用。
- 将本地化字段从 `apiRoot`/“API 根地址”改为 `requestUrl`/“API 请求地址”。
- 将 AI 设置入口从顶栏移到左侧面板底部“设置”区域，顶栏不再显示独立 AI 齿轮按钮。
- 新增 UI 设置缓存：语言、原子标签显示方式和分子显示模式写入 `chemviz3d.ui-settings.v1`，启动时校验并恢复，修改后立即更新。
- 新增可配置 `text.systemPrompt`/`image.systemPrompt`：两个模型各自带有内置 chemvz: 2 默认提示词，普通/开发者 settings 的非空值按优先级覆盖；文本 AI 请求使用文本模型提示词。
- AI 设置的文本和图像标签页默认只显示“修改系统提示词”按钮；点击后会弹出“除非你知道如何编写提示词，否则不要修改”的确认警告，取消不会显示内容，确认后才显示对应文本框并可随 settings 文件和浏览器缓存保存。旧的顶层 `systemPrompt` 配置仍兼容迁移到两组模型。
- 浏览器验证通过：左侧 AI 设置入口、三项界面设置刷新恢复、系统提示词默认显示及取消/确认修改流程均正常。
- 按反馈调整系统提示词为只读预览，新增长条“修改系统提示词”按钮；点击后才弹出警告并在确认后解锁编辑。左侧 AI 设置入口改为与设置区同宽的长条按钮。
- 诊断 `Failed to fetch`：确认配置地址为 `https://ai.sectl.cn/v1/chat/completions`，本机直接访问可达，但浏览器 `OPTIONS` 预检返回 HTTP 403。新增 Vite 开发同源代理 `/__chemviz_ai_proxy`，并让网络错误包含请求地址和 CORS 提示；临时 Vite 端口验证代理确实收到上游 404 响应，说明转发链路正常。
- 最终回归检查通过：生产构建、21 个本地预设 JSON、settings JSON、浏览器 UI、缓存恢复、提示词确认流程和代理路由均正常；发现现有 `release/ChemViz3D-v1.0.0`/ZIP 未同步 AI 功能，已记录为发布前待处理项。
- 增加 `maxRetries` 自动重试：mock 测试验证首次失败后第二次恢复，连续失败时 `maxRetries: 2` 实际调用 3 次并报告错误。
- Vite SSR 预设测试通过：`乙醇` 命中本地 preset，描述性输入未命中；临时产物已清理。

## 2026-08-17

- 开始准备 `v1.0.1` 发布：查阅 `Agent.md`、`.workbuddy/memory/` 和现有 `v1.0.0` 标签，确认上一版本重点为 UFF 几何松弛和结构可视化改进。
- 新增根目录 `CHANGELOG.md`，记录本次 AI 解析、配置、缓存、Linux/Vite CORS 代理和历史版本摘要。
- 将 `package.json`、`package-lock.json` 版本更新为 `1.0.1`，更新 README 的发布包路径，并规范空 `settings.int` 模板。
- `npm run build` 通过；生成 `release/ChemViz3D-v1.0.1/` 和 `release/ChemViz3D-v1.0.1.zip`，ZIP 完整性、产物一致性、21 个预设和空配置 JSON 均验证通过。
- 仅暂存实际功能/文档/发布内容，排除开发者配置、`.workbuddy/`、`Agent.md`、依赖、缓存、旧 `v1.0.0` 发布物和本地规划记录。
- 创建提交 `5936c94`（`feat: add AI parsing and v1.0.1 release`）及注释标签 `v1.0.1`；随后因发行问题撤回标签，并以 `de404e4` 从 Git 树移除 `release/` 发布物。
- 修复 `2,4,6-三硝基甲苯`：新增 TNT 本地预设，采用交替单/双键的 Kekule 苯环和显式 `N+`/`O-` 硝基表示。
- `chemVZToBondSpec()` 现在规范化六元 sp2 碳环中的全 `1.5` 或全 `2` 键为交替单/双键；杂化推断改按总 π 键数判断，避免一个双键加一个单键的碳被误判为 sp。
- 回归验证：TNT 命中本地预设、分子式 `C7H5O6N3`、5 个隐式 H、苯环键序 `1,2,1,2,1,2`、3 组硝基电荷且无错误 N-H/O-H；`npm run build` 通过。

## 2026-08-17 (发布包修订)

- 用户反馈 `v1.0.1` 缺少发布 ZIP、Linux 启动方式和详细发行说明，并要求不将 `CHANGELOG.md` 上传到 Git。
- 已确认源码中的 TNT 修复和预设已经在 `831c8d8`；本阶段重点是重建发布附件和更新 Release 页面。
- 新增 Linux/macOS `start.sh`；README 改为说明跨平台发布包内容与启动方式。
- 从工作树删除已跟踪的 `CHANGELOG.md`，后续只使用 GitHub Release notes。
- `npm run build` 再次通过，生成最新 `dist/`；仅保留原有动态导入与 chunk 大小警告。
- 将历史 Windows `start.bat`/`server.ps1` 提升为根目录可维护脚本，便于和 `start.sh` 一起重复打包。
- 首次临时打包检查确认 22 个预设、空 settings、最新 dist 和启动脚本齐全，同时发现并标记需排除 `src/temp_patch.txt` 与 `src/types/bridge.d.ts`。
- 已生成新的 `/tmp/ChemViz3D-v1.0.1.zip`，排除 CHANGELOG、开发配置、本地规划、Agent/.workbuddy、临时补丁、Android 桥类型、依赖与 Git 元数据；ZIP 完整性验证通过。
- 实际执行包内 `PORT=18081 ./start.sh`，首页返回 HTTP 200/483 bytes，`RDKit_minimal.wasm` 返回 HTTP 200/6,914,823 bytes；验证后已停止服务器。
- 创建提交 `a0353ba`：删除已跟踪 CHANGELOG，新增 Windows PowerShell/batch 与 Linux/macOS shell 启动入口，更新 README 发布说明。
- SSH 推送瞬断；HTTPS 首次推送因远端 `e5f4052` 超前被拒绝。已确认该远端提交仅删除 CHANGELOG，准备安全重放本地发布脚本提交。
- 已将 `493b34d` 推送到 main，并用条件强制更新 `v1.0.1` 标签；GitHub Release 上传 4,562,422 bytes ZIP、写入详细 notes，并设置 `isPrerelease=true`。
- Release 远端资产 digest 与本地 SHA-256 均为 `ca5676a55829bd31a840539e0f969e138da112ec162ed2da146ebc22cd2c442b`；验证完成。

## 2026-08-18

- 开始新增根目录 `molecules/`，将 22 个本地预设迁移到 `molecules/presets/`，并创建被忽略运行缓存目录 `molecules/cache/`。
- 新增 `src/ai/cache.ts`：桌面模式通过桥接读写/删除缓存，浏览器模式用 localStorage 兜底；缓存键使用规范化输入的稳定文件安全哈希。
- `useMolecule` 已改为预设 -> 缓存 -> AI，AI 成功后写缓存，并暴露当前缓存清除、全部清空和重新生成操作；左侧设置区新增对应按钮。
- chemvz JSON 新增多语言 `name` 与 `smiles` 字段支持，乙酸、苯、乙醇和 TNT 预设已补齐字段；乙酸旋转键规则已修复。
- 其余 18 个预设也补齐规范 SMILES 和简繁中文/英文名称，启动语言切换时所有预设名称均按 locale 回退选择。
- 用户反馈甲醇共面统计漏氢；修正 C-O 中心的 H-C-O-H 链过滤。SSR 回归结果为 `CH4O`、4 个氢、possible=4、definite=3；生产构建和 Python 编译再次通过。
- 用户反馈桌面启动后 AI 仍连续 502。通过同配置直连、模型列表和 HTTP/1.1/User-Agent 对比，定位为上游拦截 `Python-urllib/3.12`；桥接新增浏览器兼容 User-Agent，授权实测桥接 POST 已返回 200。构建与 Python 编译通过。
- 桥接新增缓存 REST 接口；前端上游错误解析支持嵌套 message。`npm run build`、`python3 -m compileall -q desktop` 和授权缓存桥接 smoke test 均通过。

## 2026-08-19

- 重构 `coplanarity.ts`：平面改用确定性的 3x3 协方差矩阵 Jacobi 特征向量求解，支持倾斜/带噪声平面；环枚举统一使用稳定的有界简单环搜索，保留稠合环路径。
- 共面片段现在记录最大偏差、容差和内部键连续性；候选束逐步验证片段联合平面，单个冲突片段不会使其他有效片段整体丢失。
- 重构 `conformerSearch.ts`：移除 `Math.random()` 蒙特卡洛，改用固定角度网格、Halton 低差异序列、多个候选和多级局部精修；同一分子重复搜索结果完全一致。
- 可旋转键扩展为非环重原子单键，并排除酰胺 C-N 部分双键；新增 `fast`/`balanced`/`precise` 三档固定搜索预算，默认平衡模式。
- 左侧设置新增共面搜索质量选择，保存至 `settings.int.ui.conformerSearchQuality`；右侧构象查找显示当前模式并按模式缓存搜索结果。
- 回归通过：`npm run build`、桌面 Python 编译、浏览器设置持久化、甲醇 `4/3` 共面统计、乙酸 `6/4` 统计、C6 多旋转键确定性搜索及倾斜带噪声平面拟合。

- 用户要求撤回并重新发布 v1.0.1，同时将 README 改为面向用户的简洁说明，删除开发者配置和发布内部细节。
- 已确认 GitHub 当前 v1.0.1 为预发行版，旧 ZIP 仍存在，等待 README 重写和重发布。
- 根目录 README 已精简为用户启动、AI 设置、主要功能、操作提示、许可和免责声明；删除开发密钥、`.gitignore`、CORS、构建与发布内部说明。
- `npm run build` 通过；新 ZIP 通过 `unzip -t`，排除项检查无命中，Linux `start.sh` 解压实测首页和 RDKit WASM 均返回 HTTP 200。
- README 已以提交 `442de0b`（`docs: simplify user README`）推送到 `main`，仅包含该文件。
- 删除旧 v1.0.1 发行版及远程标签后，将注释标签 `v1.0.1` 重新指向 `442de0b`；GitHub `main` 和标签均已核对为该提交。
- 新 v1.0.1 预发行版已发布，ZIP 大小 4,560,943 bytes，SHA-256 为 `0849e42a4bc23271191f70748a831e938a889e9b384d23fe82c9a048512f12c0`；发行说明保持精简版。
- 新任务：清理根目录已忽略的旧测试夹具和临时补丁，并在 `Agent.md` 中固化用户 README、发行说明和临时测试文件规范。
- 已删除 5 个旧结构 JSON、3 个批量测试脚本和 `src/temp_patch.txt`；这些文件均未被 Git 跟踪，不会产生提交删除记录。
- 已在本地忽略的 `Agent.md` 追加 README、GitHub Release notes、临时测试和发布清理规范；没有上传开发指南。
- 新架构任务开始：选择 Python 标准库作为第一阶段客户端/本地服务实现，保留 WebUI 作为 3D 渲染层；后续可在同一服务上接入 PySide6 原生窗口和 PyInstaller 打包。
- 新增 `desktop/` Python 包：loopback 服务同源托管 `dist/`，向首页注入一次性令牌，提供鉴权的配置读写和 Chat Completions 代理；启动器可自动打开本地客户端页面。
- 前端桌面模式会从桥接同步配置、静默保存 `settings.int`，并把 AI 请求交给 Python 服务；检测不到桥接时继续使用原有浏览器文件选择器和请求路径。
- 桥接 smoke test 通过：健康检查、未授权 401、配置原子写入权限 0600、配置回读、模型/API key 服务端覆盖和 mock AI 上游转发均正常。
- 新增 PyInstaller 构建脚本和构建依赖清单；可执行模式将静态资源打包为只读数据，并把用户配置写入系统用户配置目录。
- `uv run --with 'pyinstaller>=6,<7' python desktop/build_executable.py` 成功生成 Linux `release/desktop/ChemViz3D`，实际启动后健康接口返回正常；Windows/macOS 需在对应系统分别构建。
- README 增加 Python 桌面启动方式；`.gitignore` 增加 Python 缓存规则。第一阶段仍使用系统浏览器作为显示壳，PySide6 原生窗口列为下一阶段。
- 完成 PySide6 原生窗口迁移：`desktop/qt_client.py` 使用 `QMainWindow + QWebEngineView` 加载本地桥接 URL，`python -m desktop` 默认进入窗口，不再调用系统浏览器；`--headless`/`--no-window` 保留无图形服务模式。
- 原生窗口关闭时停止并回收 `BridgeHTTPServer`，异常退出后的清理也保持幂等；PyInstaller 入口补齐 `__main__` 调用，避免打包程序立即返回。
- 新增 `desktop/requirements.txt`（PySide6 运行依赖），构建依赖清单改为复用该文件并包含 PyInstaller；构建脚本增加 `--console` 诊断选项，正式构建默认隐藏控制台。
- 使用授权联网环境导入 PySide6 Qt WebEngine 通过；源码 Qt 窗口实际加载 `/__chemviz_bridge/settings`；Linux 单文件重新构建成功（约 236 MB），运行时保持窗口事件循环并请求桥接设置，8 秒 timeout 后退出符合测试预期。
- Qt 在当前 Linux 环境提示 Vulkan/XCB 可选库缺失并自动退回软件渲染；Windows/macOS/Linux 发布包需在目标平台分别构建并按平台准备 Qt 系统库。
- `start.sh` 和 `start.bat` 已改为优先启动同目录平台可执行文件，否则运行 `python -m desktop`；不再默认启动静态服务器或系统浏览器，`server.ps1` 仅保留为显式 Web 回退脚本。
- 针对系统 Python 未安装 PySide6 的实际启动错误，`start.sh`/`start.bat` 现在会优先检测 PySide6；Linux/macOS 若存在 `uv`，自动用临时依赖环境启动，否则给出安装 `desktop/requirements.txt` 的明确提示。启动脚本回归测试已通过。
- 用户实际启动发现 Ubuntu 24.04 缺少 `libxcb-cursor0`；客户端新增 Linux 图形依赖预检，提前给出 `apt`/`dnf` 安装命令，避免 Qt 输出难以理解的 xcb 崩溃日志。系统包安装受当前执行环境授权限制，未强行修改用户系统。
- `libxcb-cursor.so.0` 现已可见，使用真实 `xcb` 平台启动 `uv run --with PySide6 python -m desktop` 验证通过，页面请求 `/__chemviz_bridge/settings` 返回 200；不再需要 `QT_QPA_PLATFORM=offscreen`。
- `settings.int` 现包含带默认值的 `ui` 节；桌面启动会应用语言、显示模式和标签模式，修改时通过桥接写回，AI 保存同时保留 UI 设置。异常枚举值会回退默认值，开发者配置不会接收 UI 字段。
- AI 设置弹窗新增始终可用的取消按钮，系统提示词编辑新增取消并恢复原值，保存按钮改为“保存”。开发者文本配置就绪时普通 API 字段可为空，空开发字段不会覆盖普通配置。
- 新增 API 有效性检查：要求非空 API/模型和有效 `http(s)` 地址；无效时左侧显示 AI 禁用警告，本地预设仍可用，未命中时直接返回配置错误，不发送网络请求。构建和 URL/桥接回归测试通过。
- 修复共面标记数量不一致：移除 MoleculeViewer 显示层对统计集合的二次剔除，10 个可能共面原子现在全部显示标记；设置区加入统一纵向布局和缓存按钮间距。
- `npm run build` 通过；Rolldown smoke test 验证甲醇 `possible=4`、标记集合 `4`、构象搜索 `4/3`；浏览器回归确认设置间距及乙酸精密搜索 `6/4`，随后停止开发服务器。
- 用户新截图暴露非共面原子误标记；已收紧 coplanarity 片段容差、联合合并容差和多氢链规则。合成双平面、甲醇、乙酸、苯环检查通过，`npm run build` 再次通过。
- 最终 UI 回归确认乙酸精密模式显示平面与 6 个统计原子一致，未见明显离平面标记；本地 Vite 服务已停止。

## 2026-08-19 (v1.0.0 multi-platform release prep)

- 初始目录误写为 `release/b1.0.0/`，现已迁移并统一更正为 `release/v1.0.0/`；最终发布路径和文件名均使用 `v1.0.0`。
- 创建被忽略的 `release/v1.0.0/` 发布目录，包含 `installers/{windows,macos,debian}`、`portable/{win,mac,deb}`、构建说明和 manifest 入口。
- 新增 `release/v1.0.0/build_release.py`：统一检测 Node/npm、Python、uv、PyInstaller、PySide6 和目标平台工具；目标平台必须原生构建，缺 PyInstaller 时自动使用 uv 临时环境；可选 `--auto-install-system-deps` 补齐 Debian 系系统库。
- 发布脚本只把 PyInstaller 可执行文件、内置 Vite `dist`、Qt/PySide6 运行库、README、LICENSE 和空设置模板带入包；明确排除 Android、源码、node_modules、AI 缓存、开发配置和 Git 元数据。
- 当前 Linux 主机使用最新源码重建的可执行文件生成并验收 `ChemViz3D-v1.0.0-debian-amd64.deb`（233,455,570 bytes）和 `ChemViz3D-v1.0.0-deb-portable.tar.gz`；`dpkg-deb --info`、内容检查、tar 清单和 `--help` 启动通过。
- Windows/macOS 未伪造交叉编译产物；对应 Inno Setup `.iss`/macOS DMG 构建逻辑会在原生宿主执行时生成安装包，目录与命名已准备。
- 联网依赖补全尝试因审批服务返回 503 未执行；本次改用显式 `--reuse-executable` 完成当前 Linux 封装，后续正式发布应在最新源码上原生重建可执行文件。
- 用户要求重新构建 Linux AppImage；确认旧 `release/desktop/ChemViz3D` 与当前 `desktop/*.py` 不一致后，使用缓存中的 PySide6 6.11.2/PyInstaller 6.22.2 组合从当前源码重新构建。
- 最新构建产物 SHA-256 为 `b1e46b9a150f8c880ed5982d03ae4f5f169d1d01fdd921806cbfc99864a1a60b`；已同步覆盖 `release/desktop/ChemViz3D`，旧 desktop 二进制不再使用。
- 新增并生成 `release/v1.0.0/portable/ChemViz3D-v1.0.0-x86_64.AppImage`（233,822,695 bytes，SHA-256 `4bab588a180a1e92fd950dc356e786113b34bbe5cc5e5e065ef98116aa01a90c`）；`--appimage-version` 输出 `ChemViz3D v1.0.0`，`--appimage-extract` 验证通过。
- Debian 图标采用用户提供的 `ChatGPT Image 2026年8月19日 21_56_31.ico`，已写入包内 `/opt/chemviz3d/chemviz3d.ico`，desktop 文件引用该绝对路径。
- 旧 `b1.0.0` 二进制归档已移入 `release/v1.0.0/.legacy/` 并改用中性文件名，最终发布目录只保留 `v1.0.0` 产物。

## 2026-08-19 AI / 桌面截图修复

- 无效文本 API 配置现在在解析入口立即被拦截，保留本地预设和缓存路径，并确保 loading 状态在错误后结束；AI 不可用横幅在桌面配置加载前默认显示。
- 移除 TopBar 的 chemvz JSON 下载按钮；仍保留 `.chemvz.json` 导入能力。
- 截图改为复制 PNG 到剪贴板，并通过桌面 bridge 自动保存到运行目录 `screenshots/`，文件名带时间戳；操作结果显示在界面提示区。
- 基于最新 WebUI 和 PyInstaller 可执行文件重新生成 Debian 安装包、Debian 便携包与 AppImage；最终 SHA-256 分别为 `1383c86ebdf141991a9f97af4298093bd01ffe9cf5b02577ceba267037dade16`、`adc9eb5d83a4d4abaff3a623333069fc17a5d7520a1f9d2b5982984a268f5ced`、`24db7a5bb30d955c193305c827549d5e8f3a8cbdeefc97bff488d458c2a74b4c`。
- 按开发配置规则重新打包：源码运行可使用有效 `settings.developer.int`，发行包不包含该文件；最终 SHA-256 为 Debian `1957c3ef18ae012b4f2ca7d2569a820a3faa5b1c002798edf19d561a5b14fe9c`、Debian portable `04c5aaa6f94440a6d45fdbc43fcaeaf72cddf5c93488618b46fd3ebf8955abbc`、AppImage `21cd1b55333936303111c7e2a5b66b9804831053234181bb33df13588f749073`。

## 2026-08-20 AI 配置内存快照与 v1.0.0 重建

- 启动时先建立 AI 配置内存快照，桌面桥接加载或设置保存后同步更新；AI 调用入口只使用该快照进行有效性检查。
- 空配置在读取缓存和发起网络请求前拦截，发送约 4.5 秒自动消失的 Toast，并自动打开 AI 设置；开发运行时仍允许 `settings.developer.int`，发行包不包含该文件。
- 顶部截图按钮旁新增复位视角按钮；快捷键仅保留 `R` 复位和 `Ctrl+S`/`Cmd+S` 截图。截图结果统一使用 Toast 通知。
- 从当前源码和最新 `dist` 重建 PyInstaller 客户端，并重新生成 Debian 安装包、Debian 便携包与 AppImage。SHA-256：Debian `0f26b44da22fa663e212bd3213246c7860d4f6edb033705a5ffac5d0874b279b`、Debian portable `24963edcd53d82d724564e01f9bb3a155512f88964a23a25f37bc8cb63a1d3c2`、AppImage `2b865049dc9d6d1a71769318b4fb24668f22aa54979e46b778052e843a2f3dda`。
- Debian、便携包和 AppImage 清单均只含空 `settings.int`，未包含 `settings.developer.int`；AppImage `--appimage-version` 和提取检查通过，Android 分支未修改。
- 桌面桥接 `/settings` 读取现在返回合并后的有效文本配置，使前端内存快照与实际 AI 请求来源一致；再次重建后的 SHA-256：Debian `30b32e32ca7717c030d6ed229a0535b1119c278d5917e6a4151ae34af6835cd5`、Debian portable `ef8fc3e198a2cac2993ed6d73d7cfa04767010cd0523d0aa55710c4eb8a004c9`、AppImage `cce011540e00cb931435763afe02d6152a6d5d078c20229dfc9070686cf80bbc`。

## 2026-08-20 发行版启动路径与清空按钮修复

- PyInstaller 资源现在包含 `settings.int`；冻结模式首次启动会把它复制到用户可写配置目录，解决源码 `start.sh` 与构建产物配置路径不一致。
- 顶部 X 不再调用无效的 `window.close()`，改为清空当前分子、选择、测量和渲染状态；窗口保持打开。
- 最终重建产物 SHA-256：Debian `8e9d68b1c788f8989b4df81686792d7b23cc04d6b1bedaf8c90af7ae3ef7c712`、Debian portable `1d35bd999fa9d25d9318195315cceeb86ba9a600581a7d858ae72be951baf90a`、AppImage `96d3d5f87b6876b625dd708655e05c071b31ef14f9c4e50157c5083a7cd6b98b`。
- PyInstaller archive 检查确认包含 `dist/index.html` 与 `settings.int`；发行包未包含 `settings.developer.int`，AppImage 版本检查通过。
- 清空按钮同步修正 Three.js 场景清理，`molecule=null` 时移除旧分子组及其材质/几何体；最终重建 SHA-256：Debian `4137d8bb60b3adff73ae7b529b64ce2512fb08a21f52a043fb9a8ddf19c22c01`、Debian portable `cca2f707f947e75a88341a0b6010c56ff823d8cb2383376054c1137e627c9744`、AppImage `ea0fe0067066371a2f3f0d9ca732e56d09009a37b4004ddb20395d2cfd838312`。

## 2026-08-20 配置文件路径修正

- 冻结客户端配置目录现在按 `CHEMVIZ_CONFIG_DIR`、当前工作目录已有 `settings.int`、可写的便携可执行文件目录、平台用户配置目录依次选择。
- AppImage 启动器设置 `CHEMVIZ_CONFIG_DIR` 为 AppImage 所在目录；Debian 安装版的只读 `/opt` 则回退用户配置目录，避免安装权限问题。
- 重新构建后的 SHA-256：Debian `eeb78b6e14097ca6345a601147085e1e0ce64b038110043813aecf0e7f906853`、Debian portable `a400ccb1b6fc5f8e51cb4f44bbf8e96a0acc41b5c0918317baa75b31a9b11d0c`、AppImage `c4acf0dce7e59f0f329b6b5508c50bc14e32c510c7006b05b5929b60b3bfbe2b`。
- 已用临时路径模拟验证：便携可执行文件目录存在 `settings.int` 时被选为配置目录；PyInstaller 归档包含 `settings.int`，发行包不含 `settings.developer.int`。

## 2026-08-20 工作目录数据文件

- 冻结版默认将可写工作目录作为数据目录，`settings.int`、`molecules/cache` 和预设文件保持在同一目录；不可写时才回退到平台用户配置目录。
- Debian、便携版和 AppImage 均包含 `molecules/presets/*.json` 及空 `molecules/cache/.gitkeep`，避免发行包缺少工作目录数据结构。
- 最新 SHA-256：Debian `4ea1da3fe9b0469df7e6f097d1d38f53a751ebc6e59acecac147dfe3d2b12a2a`、Debian portable `6e31148021399a367c518e20f52ad4bfa823ac37c09873c2ee62b641d68a6bc5`、AppImage `7b4eb5b5378d2cb79bd47354c9b40cf1d14f9f08877f4fd20078ccff4808b11e`。
- 最终路径边界修正后 SHA-256：Debian `593471378e5a76fa8abae3d9bf2a229af6196fa2a8ff22682eb316aba48c33de`、Debian portable `eaceeb51de6a01bf22fce3b6d22454ca0fc32962f4654f9403a7f88528e1e8fa`、AppImage `03326ac8f6f1455f28c3df1aec65e2744625dacf3d0886d918ee07272725f131`。
## 2026-08-19 Android 触屏布局恢复

- 在共享 React 布局恢复左右面板折叠状态和触屏上下抽屉，竖屏时 viewer 使用全尺寸绝对定位，避免双面板挤压显示区。
- 增加触屏帮助按钮和点击提示；`labelDisplayMode=hover` 在触屏上改为点击原子显示标签，桌面悬停逻辑保留。
- 同步 Android `main.js/style.css`，保留 Android 专用 `index.html` 及桥接脚本。
- Web `npm run build` 与 Android 资源特征检查通过。
- SDK 已安装到 `/home/cmprssntl/Android/Sdk`，`ChemViz3D-Android/local.properties` 已改用永久路径。
- Java 21 下正式 Gradle 构建在 AGP `JdkImageTransform` 失败；基于已有 APK 更新 Web 资源后用 Android `zipalign`/`apksigner` 生成并验证 `ChemViz3D-Android/.分发/app-debug.apk`，待 JDK 17 安装后重跑正式构建。

## 2026-08-19 原版触屏实现对照修正

- 对照 Android 初始提交 `ee8b2b5` 的 bundle，撤销绝对定位抽屉方案。
- 恢复原版 `app-container orientation-*`、store 中 `leftCollapsed/rightCollapsed`、面板与按钮的原始顺序，以及 portrait 下 `40vh` 面板限制。
- 恢复原版 Android bridge 的 `android-molecule`、分子信息和测量回传；保留现有 AI、缓存和结构算法功能。
- Android 专用 `index.html`、Java bridge、OrbitControls 触控逻辑未改动；仅在触屏上将 hover 标签映射为点击显示。
## 2026-08-20 Android 同步续作

- 当前 `main` 未提交修改保持不动；已完成最新 Web 生产构建，准备在独立 `ForAndroid` 工作树合并。
- 本轮目标是保留 Android 专用 HTML/bridge/触控布局，仅更新共享构建资源，并新增双指拖动平移提示。
- Android-only commit `93beada` 已推送到远端 `ForAndroid`；`main` 远端仍保持 `442de0b`。
- Gradle 离线构建先受 native socket 限制，授权构建又缺少可下载的 Android Gradle Plugin 依赖，未生成新 APK；已保留源码同步结果并未替换旧测试包。

## 2026-08-20 Android APK 重建

- 用户要求重新构建 APK；优先复用授权构建期间产生的 Gradle/Maven 缓存，目标输出为 debug APK。
- 使用项目兼容的 Gradle 8.4（Gradle 9.3 与 AGP 8.1.4 不兼容）和 Java 17 构建成功；APK SHA-256 为 `ad9fa3b37b9a0129d34d49b2a7414b85ba09c17b3d931f7d133811e7963ed9b8`。
- 已通过 zipalign 和 `apksigner verify`，APK 写入 `ChemViz3D-Android/.分发/app-debug.apk`。
- 复核大小差异后确认旧 bundle 存在重复的 `index-*.js/style-*.css`；新 APK 只保留活动资源。旧不匹配 `.idsig` 已移至 `/tmp/chemviz-app-debug-old.idsig`，分发目录保留原始 Gradle v2 APK。
- 构建临时使用 Gradle 8.4 的 buildscript 兼容方式，随后恢复临时 clone 的构建文件；远端 ForAndroid 提交未被改写。
- 检查到当前 main 在本轮期间由外部提交推进至 `e50d931`；没有对该分支执行提交、回退或文件覆盖。

## 2026-08-21 国际化修复同步

- 当前 main 工作树包含未提交的国际化修复；本轮以工作树内容为源，不在 main 上提交或回退。
- 目标是重新生成 Web bundle，同步到 ForAndroid，并重新构建验证 APK。
- 用户随后明确本轮不构建 APK；已停止在资源同步和分支推送阶段。
- `npm run build` 通过；国际化 bundle 同步至 Android，保留三语双指平移提示。提交 `469ddbf` 已推送到本地 `ForAndroid` 分支（其远端跟踪仓库为当前本地 origin）。
