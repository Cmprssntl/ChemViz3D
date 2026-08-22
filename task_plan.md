# ChemViz3D Linux 修复计划

## 目标

在现有 ChemViz3D 输入链路中加入统一解析：点击“可视化”后先查本地 JSON 预设，未命中再调用用户配置的 OpenAI 兼容文本模型；模型失败或输出格式错误按配置次数重试，最终要求通过 `chemvz: 2` 严格校验后再构建分子。配置分离文本/图像模型，并提供被忽略的开发者配置覆盖。

## 阶段

- [in_progress] 55. 复制 main Web 源码到 Android 独立工程并统一图像解析链路
- [pending] 56. 修复 Android 图像设置、相机回调和移动存储策略
- [pending] 57. 构建并校验 Android APK，确认两分支互不引用

- [complete] 1. 记录现状并恢复 Linux 依赖
- [complete] 2. 修复阻塞运行的文档/脚本问题
- [complete] 3. 完成类型检查、生产构建和静态产物检查
- [complete] 4. 更新项目记录并汇总剩余风险
- [complete] 5. 设计并实现本地预判断、AI 客户端和 chemvz 校验
- [complete] 6. 接入 UI、配置说明和多语言文案
- [complete] 7. 类型检查、构建和本地规则测试
- [complete] 8. 统一可视化入口、本地 JSON 预设和配置分层
- [complete] 9. 模型自动重试、预设/配置冒烟测试和文档同步
- [complete] 10. 空配置启动检测、设置弹窗和完整 endpoint 预览
- [complete] 11. 配置持久化、构建与 Linux UI 验证
- [complete] 12. 修正图像理解模型使用 Chat Completions endpoint
- [complete] 13. 设置文件导出与 API 请求地址本地化
- [complete] 14. 将 AI 设置入口统一到左侧设置区域并缓存普通界面设置
- [complete] 15. 增加可确认修改的系统提示词配置并完成 UI 验证
- [complete] 16. 将系统提示词改为确认后解锁，并统一 AI 设置按钮样式
- [complete] 17. 为图像模型增加独立系统提示词并优化设置按钮间距
- [complete] 18. 诊断 Failed to fetch 并增加 Linux 开发同源 API 代理
- [complete] 19. 最终回归测试并记录发布包同步遗漏
- [complete] 20. 编写 1.0.1 更新日志、构建发布包并提交 Git
- [complete] 21. 修复 TNT 芳香环键序与硝基隐式氢问题
- [complete] 22. 重建不含 CHANGELOG 的 v1.0.1 发布 ZIP，并增加 Linux 启动脚本
- [complete] 23. 更新 GitHub Release 详细说明并验证附件
- [complete] 24. 面向最终用户重写 README，移除开发者内部说明
- [complete] 25. 删除旧 v1.0.1 发行版并重建发布 ZIP
- [complete] 26. 提交 README/发布相关修改并推送 main
- [complete] 27. 重新发布 v1.0.1 预发行版并验证附件与说明
- [complete] 28. 清理已忽略的旧测试夹具和临时补丁
- [complete] 29. 将用户文档、发行说明和临时文件规则写入 Agent.md
- [complete] 30. 设计桌面客户端、本地桥接服务和 WebUI 兼容边界
- [complete] 31. 实现 Python 本地桥接服务与启动客户端
- [complete] 32. 将设置保存和 AI 请求接入本地桥接
- [complete] 33. 验证桥接服务、构建和迁移文档
- [complete] 34. 用 PySide6 原生窗口替换系统浏览器
- [complete] 35. 验证原生窗口导入、桥接生命周期和可执行文件构建
- [complete] 36. 将跨平台启动脚本切换到原生客户端
- [complete] 37. 处理无 PySide6 环境的启动提示与自动依赖回退
- [complete] 38. 修复 Linux Qt xcb 系统依赖并完成真实窗口验证
- [complete] 39. 统一 settings.int 的 AI/UI 读写和取消交互
- [complete] 40. 校验无效 API 配置并安全禁用 AI 回退
- [complete] 41. 迁移本地预设并加入 AI 缓存查询/清除流程
- [complete] 42. 修复 SMILES、多语言名称、乙酸旋转键和上游错误透传
- [complete] 43. 完成构建、桥接和回归验证
- [complete] 44. 修复甲醇含氢共面统计遗漏并回归验证
- [complete] 45. 修复桌面桥接被上游 User-Agent 拦截导致的 502
- [complete] 46. 统一共面统计与 3D 标记集合
- [complete] 47. 统一左侧设置面板控件间距并完成构建回归
- [complete] 48. 收紧共面片段和合并几何判定，修复非共面原子误标记
- [complete] 49. 按 Android 初始实现恢复触屏侧栏折叠、竖屏 flex 布局和点击标签提示
- [complete] 50. 合并 Android bridge 并完成设备前 APK 静态校验
- [complete] 51. 将 main 最新 Web 产物同步到 ForAndroid，并补充双指平移触控提示
- [complete] 52. 构建并校验 Android APK，确认 main 分支无新增改动
- [complete] 53. 重新构建 ForAndroid APK并验收输出
- [complete] 54. 同步 main 国际化修复到 ForAndroid（按要求不构建 APK）

## Errors Encountered

| Error | Attempt | Resolution |
|---|---|---|
| `@typescript/typescript-linux-x64` 缺失 | 现有 `npm run build` | Linux 依赖重装后解决 |
| `@rolldown/binding-linux-x64-gnu` 缺失 | 现有 `npm exec vite build` | Linux 依赖重装后解决 |
| `tsc: not found` | `npm ci` 后首次 `npm run build` | `npm rebuild` 恢复 `.bin` 命令链接 |
| 沙箱禁止本地监听端口 | Python 静态服务器验证 | 记录为环境限制；改用构建和文件检查验证 |
| Node 直接导入 TS 失败 | Vite 源码使用无扩展名 import，不符合 Node ESM 解析 | 使用 Rolldown 临时打包 smoke test，应用本身仍由 Vite 运行 |
| AI API 冒烟测试首次 JSON 解析失败 | 临时 mock 响应把换行和引号写成字面量转义符 | 修正测试夹具为真实 fenced JSON 后通过 |
| 沙箱内 curl 无法访问授权 Vite 进程 | 进程运行在授权执行环境的网络命名空间 | 使用同权限本机 curl 验证 HTTP 200 |
| 本地键符号正则初版未匹配 `CH2=CH2` | 连续元素和键符号被错误设计为互斥分支 | 改为元素间可选键符号，并加入 Rolldown 回归测试 |
| SSR 预设冒烟产物扩展名与预期不同 | Vite SSR 默认输出 `.js` 而不是 `.mjs` | 按实际输出运行测试并清理临时目录 |
| HMR 在修改 hook 数量时提示 hook 顺序变化 | 热更新保留了旧组件状态，属于开发态刷新问题 | 重新加载/重启开发服务后以全量模块验证，生产构建无此状态 |
| README 发布段补丁上下文未匹配 | 标题下划线长度与预期不同 | 改用精确标题和正文行替换 |
| `python3 -m venv` 无法创建环境 | 系统未安装 `ensurepip/python3.12-venv` | 改用 `uv run` 临时安装 PyInstaller，不修改系统 Python |
| `uv` 无法在默认缓存目录创建临时文件 | 沙箱将用户缓存目录设为只读 | 使用 `/tmp/chemviz-uv-cache` 临时缓存，并在需要下载依赖时申请联网权限 |
| PyInstaller 入口启动后立即退出 | 入口改为 `qt_client.py` 但缺少 `__main__` 调用 | 增加入口并复测 Qt WebEngine 页面请求 |
| 沙箱禁止 Python 回环监听 | 本地网络命名空间限制 | 用授权环境验证桥接；属于测试环境限制，不影响客户端设计 |
| Linux Qt 缺少 Vulkan/XCB 可选库 | 当前机器图形栈不完整 | Qt WebEngine 自动退回软件渲染；目标发行版需按系统依赖打包/安装 |
| Qt xcb 插件缺少 `libxcb-cursor0` | Ubuntu 24.04 系统库未就绪 | 补齐系统包后真实 xcb 启动并成功请求桥接设置 |
| 缓存桥接 smoke test 在默认沙箱中无法监听回环端口 | 环境禁止本地 socket | 使用授权环境完成同一测试，接口通过 |
| 桌面桥接请求持续返回 `502 Upstream access forbidden` | 上游拦截 Python 默认 `Python-urllib/3.12` User-Agent | 使用兼容浏览器的客户端 User-Agent；完整桥接请求恢复 HTTP 200 |
| 本轮默认沙箱启动 Vite 返回 `listen EPERM` | 沙箱禁止本地监听端口 | 申请授权启动后完成浏览器回归，验证后停止服务 |
| `git worktree add` 无法写入 `.git/worktrees` | 沙箱将仓库元数据目录设为只读 | 改用 `/tmp` 独立 clone 操作 ForAndroid，避免触碰 main 工作树 |
| 首次 Android bundle 字符串补丁使用了旧压缩变量名 | 当前 Vite 产物使用 `U.jsx` 而非旧的 `H.jsx` | 未写入不完整结果，按当前产物上下文重新定位并成功补丁 |
| Gradle 默认用户目录不可写，native platform 锁创建失败 | 在 `/tmp` Android clone 直接调用 Gradle 9.3 | 将 Gradle 用户目录切到 `/tmp` 并复制已缓存 native/dependency 数据后重试 |
| Gradle 离线构建缺少 Android Gradle Plugin 8.1.4 marker artifact | `/tmp` 用户目录只有部分缓存 | 下一次在授权网络环境允许 Gradle 使用已配置 Maven 仓库下载依赖 |
| Gradle 9.3 与 Android Gradle Plugin 8.1.4 不兼容 | 临时尝试使用现有 Gradle 9.3 | 下载并使用项目要求的 Gradle 8.4，构建成功 |
| Gradle 8.4 离线缓存初次缺少插件 metadata | 临时 Gradle 用户目录未包含授权下载后的最新缓存 | 增量同步缓存后使用兼容 Gradle 8.4 构建成功 |
| 临时 Gradle/JDK/Android SDK 路径被环境清理 | APK 构建找不到工具 | Android SDK 已固定安装到 `~/Android/Sdk`；等待用户安装 JDK 17 后重跑 Gradle |
| Java 21 执行 AGP JdkImageTransform 失败 | 当前环境只有 Java 21 | 已确认项目需要 Java 17；使用现有旧 APK 资源重封装并用 `apksigner` 验证，正式 Gradle 构建待 JDK 17 |

## Next Step
本轮已按 `ee8b2b5` 原始 Android bundle 对照合并：保留原有 flex 竖屏布局、按钮顺序、桥接入口和触控控制，仅加入共享源码已有功能与点击标签兼容。APK 资源已同步并通过签名/包内容校验；Java 17 已安装，但当前执行环境的 Gradle 原生库加载仍受沙箱限制，测试包已用官方 zipalign/apksigner 生成。

## 本轮 Android 同步结果

- 从当前 `main` 完成 `npm run build`，将 Web bundle、RDKit 资源、相册保存 bridge、缓存/设置 bridge 和图标同步到独立 `ForAndroid` clone。
- 在 Android bundle 中加入三语触控文案：双指拖动平移视角；没有修改 Android 专用 `index.html` 或 Three.js 触控控制。
- 提交 `93beada` 已变基到远端最新 `ForAndroid` 并推送；远端 `main` 仍为 `442de0b`。
- Gradle 因授权环境网络/Maven 插件下载未完成，本轮没有生成新的 APK；工作区已有旧 APK 未覆盖，避免交付缺少新 Java bridge 的包。

## APK 构建结果

- 使用 Gradle 8.4 + Java 17 构建成功，输出 debug APK SHA-256：`ad9fa3b37b9a0129d34d49b2a7414b85ba09c17b3d931f7d133811e7963ed9b8`。
- APK 已复制到 `ChemViz3D-Android/.分发/app-debug.apk`，zipalign、APK v2 签名和资源清单校验通过。
- 分发目录中旧的、不匹配的 `.idsig` 已移出；保留 Gradle 原始 v2 debug APK，避免额外签名元数据改变包内容。
- 构建只使用独立 `ForAndroid` clone；当前 `main` 在本轮期间出现外部提交 `e50d931`，本轮没有对其执行提交或回退。
- 本轮按用户要求不重新构建 APK；仅同步 Web bundle 并推送 Android 分支。

## 发布准备 v1.0.0

- [complete] 49. 设计 release/v1.0.0 目录、平台产物命名和排除规则
- [complete] 50. 实现统一环境检测、依赖自动准备和 WebUI 构建入口
- [complete] 51. 实现 Windows/macOS 原生便携包与安装包构建脚本
- [complete] 52. 实现 Debian 系 `.deb` 安装包与 Linux 便携包
- [complete] 53. 生成当前环境可验证产物并检查包内容、启动脚本和 Android 排除
- [complete] 54. 将误写的 b1.0.0 目录和产物统一更正为 v1.0.0，并完成 Debian 图标与 AppImage 复核

## 发布准备错误

| Error | Attempt | Resolution |
|---|---|---|
| Windows/macOS 原生 Qt 二进制不能在 Linux 上交叉构建 | 当前主机准备发布 | 发布脚本要求在目标平台执行，当前主机只生成 Linux 产物 |
| uv 默认缓存目录只读 | 第一次 Linux PyInstaller 构建 | 脚本为 uv 子进程设置 `UV_CACHE_DIR` 到发布工作目录；本次因审批服务 503 未下载，使用 `--reuse-executable` 完成封装 |
