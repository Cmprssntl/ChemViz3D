ChemViz3D —— 化学结构可视化
============================

ChemViz3D 是一个面向化学学习的交互式 3D 分子结构可视化工具。输入化学式后，程序会生成启发式分子结构，并在 3D 场景中展示球棍模型或空间填充模型。

功能
----

- 化学式 → 结构：支持常见烃、醇、醛、羧酸、胺、环结构和无机分子
- 双模式显示：球棍模型 / 空间填充模型
- 可选 RDKit IUPAC 命名（RDKit WASM 不可用时自动降级）
- Three.js 3D 旋转、平移、缩放和原子/键拾取
- 单键旋转、共面性提示和构象搜索
- 距离、角度、二面角测量
- PNG 截图导出
- 分子属性：分子量、logP、氢键供体/受体、TPSA、可旋转键等
- `chemvz.json` 导入/导出

技术栈
------

- TypeScript + React 19
- Three.js
- Zustand
- Vite
- `@rdkit/rdkit` WebAssembly（仅作为可选命名辅助）

Linux / macOS / Windows 开发
----------------------------

环境要求：Node.js >= 18。

```bash
# 在目标操作系统上重新安装依赖，不要复用其他系统的 node_modules
npm ci

# 如果 npm ci 后提示 `tsc: not found` 或 `vite: not found`
npm rebuild

# 启动开发服务器
npm run dev

# 生产构建
npm run build

# 预览生产构建
npm run preview
```

开发服务器默认地址为 `http://localhost:5173`。应用应通过 HTTP 访问，不建议直接用 `file://` 打开 HTML；RDKit WASM 在 `file://` 下会自动关闭并使用启发式命名。

AI 解析
-------

输入框只有一个“可视化”入口。程序先按精确输入查询 `src/ai/presets/*.json`；本地未命中时调用 OpenAI Chat Completions 兼容接口。请求失败、返回内容无效或不是 `chemvz: 2` 时会按配置自动重试，超过次数后在界面报告错误。

普通配置写在项目根目录的 `settings.int`。仓库中的配置保持为空，首次启动会要求在界面填写：

```json
{
  "text": {},
  "image": {}
}
```

设置界面的 `API 请求地址` 只需填写到 `/v1`，文本和图像标签页都会显示自动补全后的完整 `/chat/completions` 地址。`text` 用于当前结构解析；`image` 为可能不具备多模态能力的独立图像理解模型预留，两者各自拥有 `systemPrompt`。`maxRetries` 表示首次失败后最多重试次数，范围为 0 到 10。系统提示词默认只显示修改按钮；除非你知道如何编写提示词，否则不要修改，必须点击按钮并确认警告后才能编辑。

本地开发密钥写入已加入 `.gitignore` 的 `settings.developer.int`，或直接在设置界面填写。开发服务器中非空字段优先于普通配置，缺失或空字段回退到 `settings.int`；生产构建只读取普通配置，避免开发密钥进入发布产物。点击“保存 settings.int”时，浏览器会打开文件保存选择器；不支持时会下载同名文件。配置也会写入当前浏览器本地存储，并可通过左侧底部“设置”区域的“AI 设置”按钮再次修改。语言、原子标签和显示模式等界面选项也会缓存到当前浏览器，重新进入后自动恢复。修改文件配置后需要重启 Vite。

OpenAI 兼容服务必须允许浏览器 CORS 请求。配置会被 Vite 注入前端，API key 对浏览器使用者可见，只适合本地或受信环境；公开部署应使用服务端代理。

`npm run dev` 会为启动时读取到的文本 API 自动建立同源代理，开发环境下可绕过上游不允许浏览器预检的 CORS 网关；修改文件配置后需要重启 Vite。生产静态部署没有该代理，仍需让 API 开放 CORS 或配置正式服务端代理。

本地预设采用“一种确定结构一个文件”：每个 JSON 可配置多个精确输入别名/缩写公式，但只能包含一个经过校验的 `chemvz: 2` 对象。分子式存在同分异构体时，不应把有歧义的分子式同时映射到多个文件。

已有 `dist/` 时，也可以使用任意静态 HTTP 服务器，例如：

```bash
python3 -m http.server 8080 --directory dist
```

发布包与启动方式
-------------

预构建的 `dist/` 和压缩发布包不纳入版本控制。发布 ZIP 包含预构建 `dist/`、源码、`settings.int` 空配置模板、许可证、README 以及跨平台启动脚本，不包含开发者配置、依赖目录或 `CHANGELOG.md`。

- Windows：双击 `start.bat`，使用 PowerShell 静态服务器。
- Linux/macOS：先确认已安装 Python 3，在包目录运行 `./start.sh`；可用 `PORT=8081 ./start.sh` 修改端口。
- 也可以直接运行 `python3 -m http.server 8080 --directory dist`。

Android
-------

`ChemViz3D-Android/` 是独立的 WebView 容器工程，目前按 Android Studio/Windows 环境维护，不属于主 Web 项目的 Linux 启动路径。其 SDK 路径和 Gradle 启动说明见 `ChemViz3D-Android/BUILD.md`。

快捷键
------

- `R`：复位视角
- `M`：切换测量模式
- `F`：切换全屏
- `Ctrl+S`：保存截图
- `Esc`：尝试关闭窗口

许可
----

本项目基于 GNU GPL v3.0 或更高版本发布，详见 `LICENSE`。
