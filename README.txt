ChemViz3D v1.0.0 —— 桌面版使用说明
=================================

ChemViz3D 是一个面向化学学习的本地桌面程序。它不再依赖浏览器：启动后会打开原生窗口，设置、缓存和截图都保存在工作目录。

一、选择安装方式
----------------

Debian/Ubuntu 安装包：

```bash
sudo apt install ./ChemViz3D-v1.0.0-debian-amd64.deb
chemviz3d
```

Debian/Ubuntu 便携版：解压 `ChemViz3D-v1.0.0-deb-portable.tar.gz`，进入解压目录并运行：

```bash
./ChemViz3D
```

Linux AppImage 组合包：解压 `ChemViz3D-v1.0.0-linux-appimage-bundle.tar.gz`，进入组合包目录并运行 AppImage：

```bash
cd ChemViz3D-v1.0.0-linux-appimage
./ChemViz3D-v1.0.0-x86_64.AppImage
```

组合包同时包含 AppImage、`README.txt`、`LICENSE`、`settings.int`、`molecules/presets/` 和空的 `molecules/cache/`，请保持这些文件在同一个解压目录。

二、首次启动和 AI 设置
----------------------

程序启动后即可使用本地分子预设。输入化学式、常用名称或结构描述，点击“可视化”。

需要 AI 解析时，在左侧设置中填写文本模型的 API Key、模型名和 OpenAI 格式兼容的请求地址（通常填写到 `/v1`）。保存后配置会立即载入内存。空值或无效配置会在请求前被拦截，并自动打开 AI 设置，不会卡住可视化。

开发者文件 `settings.developer.int` 不属于发行包，也不会被自动创建。发行版使用工作目录中的 `settings.int` 作为默认模板。

三、工作目录文件
----------------

- `settings.int`：AI 和界面默认配置；可在程序中修改。
- `molecules/presets/`：本地分子预设，只读使用。
- `molecules/cache/`：运行时 AI/分子缓存。
- `screenshots/`：截图自动保存目录；截图同时会复制到系统剪贴板。

程序会优先写入当前工作目录。若目录只读，则回退到当前用户的配置目录。请从可写目录启动便携版，以便设置和缓存随包保存。

四、常用操作
------------

- 鼠标拖动旋转，滚轮缩放，点击原子或化学键查看属性。
- 左侧工具可切换球棍/空间填充显示、测量、构象搜索和截图。
- 顶部截图旁的复位按钮恢复视角；顶部 X 清空当前渲染区。
- 快捷键仅保留：`R` 复位视角，`Ctrl+S`（macOS 为 `Cmd+S`）截图。

五、运行环境
------------

发行包已包含 Python、PySide6、Qt WebEngine 和前端运行所需文件。Debian/Ubuntu 若启动时报 Qt xcb 依赖缺失，请执行：

```bash
sudo apt install libxcb-cursor0
```

Windows 和 macOS 的安装包必须在对应系统原生构建；Linux 环境不会伪造跨平台二进制。源码开发需要 Node.js 18+、Python 3 和 PySide6，可运行 `npm install`、`npm run build` 后使用 `python3 -m desktop`。

六、许可和安全提示
------------------

本项目基于 GNU GPL v3.0 或更高版本发布，详见 `LICENSE`。AI 解析、结构生成、构象、命名和属性仅供学习参考，不应替代专业数据库、实验验证或安全评估。
