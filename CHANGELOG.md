# 更新日志

## v1.0.0 - 2026-08-20

首个正式桌面版发布。此前的两个预发行标签已保留为 `beta0.1` 和 `beta0.2`。

### 新增

- Windows、macOS、Debian/Ubuntu 桌面客户端启动和打包入口。
- Linux Debian 安装包、Debian 便携版和 AppImage 便携版。
- 工作目录中的 `settings.int`、分子预设、运行缓存和截图目录管理。
- 本地预设优先的 AI/文本结构解析，支持 OpenAI 格式兼容服务。
- 独立的文本模型和图像模型设置，以及设置保存后的内存配置快照。
- 3D 分子可视化、分子属性、测量、单键旋转、共面性提示和构象搜索。
- 截图复制到剪贴板并自动保存到工作目录 `screenshots/`。

### 修复与改进

- 无效或空的 AI 凭据会在调用前拦截，显示提示并打开 AI 设置，不再导致可视化卡死。
- 桌面发行版不包含开发者凭据文件 `settings.developer.int`。
- 桌面配置、预设和缓存优先使用程序工作目录，避免发行版读写到错误位置。
- 顶部清除按钮会清空当前渲染区；仅保留 `R` 复位视角和 `Ctrl/Cmd+S` 截图快捷键。
- 改进 VSEPR 建模、几何优化、共面检测、构象搜索、SMILES 和分子验证。
- Android 工程不包含在本次桌面正式版变更中。

### 发布文件

- `ChemViz3D-v1.0.0-debian-amd64.deb`
- `ChemViz3D-v1.0.0-deb-portable.tar.gz`
- `ChemViz3D-v1.0.0-x86_64.AppImage`

Windows 和 macOS 目录已准备好原生打包入口；对应安装包需要在目标平台运行发布脚本生成。
