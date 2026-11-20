# ChemViz3D 重构执行计划

> 本文件是唯一执行计划。历史阶段记录见 `progress.md` 与 `findings.md`。
> 规则：任何阶段不通过验收，不进入下一阶段。

## 0. 已确认的决策

| 决策 | 结论 |
|---|---|
| 3D 构象后端 | 新增 `openchemlib`（BSD-3，锁 9.26.0）；RDKit / RDKit.js 完全移除 |
| IUPAC 命名 | TypeScript 自研；**不做回退**，失败必须明确报错 |
| 大结构 | 不做硬上限，走分级降级 + Worker + 相机自适应 |
| 跨平台 | 一份源码，Android / Windows / Linux 共用；平台差异只在 `platform/` 适配器、`if` 与 `data-*` 标签 |
| Android 加载 | 升级 `WebViewAssetLoader`（`https://appassets.androidplatform.net`） |
| 平台标记 | 单一 `platform.json`，打包时各平台放自己那一份 |
| Android 图片解析 | 合并进共享代码（相机/相册 → 图像模型） |
| 视觉 | 允许统一，需要重采截图基线 |
| 代码风格 | 面向对象 + 继承/多态；禁止上帝对象；单方法 ≤ 60 行；单文件 ≤ 400 行（engine）/ 250 行（组件） |

## 1. 目标架构

```
src/
  domain/                纯数据与化学规则（不依赖 React / three）
    chemvz/              schema、严格校验、kekulize
    graph/               邻接、环感知、可旋转键、碎片划分（唯一实现）
    naming/              IUPAC 命名（类层次：ParentSelector / SubstituentNamer / NameAssembler）
    presets/             本地预设索引
  engine/                几何管线（仅用 three 的数学）
    placement/           环模板、BFS 摆放、局部坐标系、H 放置
    conformer/
      ConformerBackend.ts       抽象基类
      OpenChemLibBackend.ts     首选实现
      RigidTreeBackend.ts       零依赖实现
      ConformerService.ts       选择/降级/缓存
    relax/               约束优化器（解析梯度 + SHAKE 投影）
    analysis/            共面、构象搜索、测量、性质
  ai/                    prompt / 重试 / 缓存 / 解析（传输走 platform）
  platform/
    PlatformAdapter.ts   接口 + 能力描述
    WebPlatform.ts / DesktopPlatform.ts / AndroidPlatform.ts
    detect.ts            平台探测（构建标志 → 注入 → platform.json → web）
  state/                 store 切片 + 版本化持久化
  ui/                    components / hooks / styles
  i18n/                  类型化 key + 缺失检查
shared/                  settings.schema.json（TS / Vite / Python 共用）
tests/                   node:test + rolldown 打包运行
scripts/                 打包、同步、检查脚本
```

依赖方向固定：`ui → state → ai/platform/engine → domain`；`domain` 不反向依赖。

## 2. 阶段与验收

### P0 安全网（完成）
- [x] 依赖切换：移除 `@rdkit/rdkit`，新增 `openchemlib@9.26.0`
- [x] 删除 `public/RDKit_minimal.*`、`initRDKitInternal`、`rdkitReady`、徽标与相关 i18n
- [x] 测试骨架：`node --test` + rolldown 打包 TS（`npm test` / `npm run check`）
- [x] 几何不变量测试：22 预设 + C3…C40 直链（键长、重叠、NaN、跨度、耗时）
- [x] OCL spike：裁剪 resources、ConformerGenerator + MMFF94 质量与性能
- [x] 命名 golden 骨架（待 P2 填充）
- **验收结果**：47/47 通过；`npm run check` 可用

### P1 几何止血（完成）
- [x] 统一图算法（`domain/graph/MolecularGraph`）：rotation / coplanarity / conformerSearch / vseprBuilder 全部改为调用它
- [x] 放置层：保留确定性 VSEPR 作为后备后端，不再走数值梯度 UFF
- [x] 约束优化器：解析梯度 + Armijo + 每步信任域 + SHAKE 键长投影
- [x] 结构守卫 + 失败回退（`GeometryValidator` / `ConformerService` / UI 明确报错）
- [x] 移除 `optimizeConformation` 调用并删除该模块
- [x] 相机包围球 + 投影自适应 fit、增量场景更新
- **验收结果**：C3/C6/C10/C16/C24/C40 键长 1.09–1.53 Å、无 NaN、无 <0.65 Å 碰撞；C40 跨度 51.4 Å 完整入镜

### P2 后端接入 + IUPAC 命名（完成）
- [x] `ConformerBackend` 抽象 + `OpenChemLibBackend` + `HeuristicBackend`
- [x] 裁剪并内联 OCL resources（COD + MMFF94，去掉 druglikeness/tox）
- [x] `domain/naming`：父体选择、取代基、位次、字母序、装配（类层次：`HeavyMolecule` / `FunctionalGroups` / `ParentSelector` / `Substituents` / `NameAssembler` / `IupacNamer`）
- [x] UI：IUPAC 名称独立成行；失败显示 `NamingError` 文案（不回退分子式/SMILES）
- **验收结果**：19 个有机预设 golden 全部通过；水/氨/CO₂ 返回 `no-carbon-parent`；73/73 测试通过

### P3 平台统一（完成）
- [x] `platform/` 适配器 + 探测（构建标志 → 运行期注入 → `platform.json` → web）
- [x] 单一 IIFE 产物（`format: 'iife'`、`inlineDynamicImports`、无 `import.meta`、相对路径）
- [x] 统一 `index.html`：产物改写为普通 `<script defer>`
- [x] `scripts/package.mjs` 生成三端产物 + 每端 `platform.json`，并校验单文件/无 `import.meta`
- [x] `data-platform` / `data-touch` 由适配器写入 `<html>`
- [x] Android 升级 `WebViewAssetLoader`（`https://appassets.androidplatform.net`），关闭文件访问与页面缩放
- [x] Android 桥脚本并入共享代码（`platform/android/bridge.ts`）
- [x] 图片解析合并进主源码（`ai/image.ts` + `platform/imageInput.ts` + `processImageData`）
- [x] Android 仓库删除 `src/`、`vite.config.ts`、`package.json`、根 `index.html`、`_archive/`、1839 行未使用 Kotlin
- **验收结果**：`./build-apk.sh` 成功（7.8 MB APK），APK 内 `assets/webapp/assets/main.js` 与 `release/android` 字节一致，`platform.json` 为 `android`

### P4 分层拆分与死代码清理（部分完成）
- [x] 拆 `MoleculeViewer`：`CoplanarityOverlay` + `useViewerPointer`，组件 248 行
- [x] 删除 `builder.ts`、`validation.ts`、`smilesGenerator.ts`、`bonds.ts`、`conformer.ts`、`moleculeDataToChemVZ`
- [x] 测试入口 `npm run check`（tsc + 73 项）
- [ ] 拆 `vseprBuilder`（1177 行）、`ai/config`（570 行）、`conformerSearch`（400 行）
- [ ] 设置 schema 单一源（TS / Vite / Python 共用）
- **验收**：tsc 0 error；组件行数达标；engine 侧仍有超限文件

### P5 性能与大结构（部分完成）
- [x] 几何资源复用：`MeshResources` 按元素缓存球体/材质/标签纹理，C40 由 122 份球体与纹理降为约 10 份；缓存统一释放
- [x] 增量场景更新：拓扑不变时只更新坐标与键（`MoleculeScene.sync`）
- [x] 大结构档位：>80 原子自动减少 MMFF94 迭代次数
- [ ] 构建/松弛进 Worker：IIFE 单文件会把 worker 再内联一份（约 +2.9 MB base64），暂缓；需要时改为双产物
- [ ] 实例化渲染（>400 原子）
- **验收结果**：连续切换 5 个分子无报错、无残留；C40 生成约 1.2 s（主线程）

### P6 UI 统一视觉（部分完成）
- [x] 组件内联样式清理（`MoleculeViewer` 全部改为 `.viewer-*` 类）
- [x] `data-platform` / `data-touch` 写入 `<html>`，供样式与脚本共用
- [x] i18n 一致性测试：三语言 key 集合完全一致、无空值、插值可用
- [ ] tokens 与分层 CSS、单一 orientation 判定、截图基线
- **验收结果**：i18n 76 项测试通过；视觉重构留待截图基线

### P7 发布验证（v1.1.0 已发布）
- [x] `scripts/package.mjs`：三端静态包 + `platform.json` + `build-info.json`（含 `version`）
- [x] 产物自动校验：单一 `assets/main.js`、普通 script 标签、无 `import.meta`
- [x] Android APK：`ChemViz3D-Android-v1.1.0.apk`（8.1 MB，versionCode 2 / versionName 1.1.0）
- [x] 真机验证（Android 14 / 1080×2412）：启动、预设切换、IUPAC 名称、触控布局、控制台桥接
- [x] GitHub Release：`v1.1.0`（web 包）与 `v1.1.0-Android`（APK）
- [ ] Windows/Linux 桌面包：本机无 PySide6/PyInstaller，`desktop/build_executable.py` 仍引用已删除的 `README.txt`，留待下阶段
- **验收结果**：`npm run check` 89/89；web 包在浏览器实测（复位视角、环庚烷可旋转键 = 0）；APK 与 `release/android` 字节一致

## 3. 备份

- 仓库与工作树备份：`backup/`（bundle + tar.gz，含 Android 子仓库；已在 `.gitignore` 中）
- 迁移前 Android 快照：`backup/chemviz3d-android-pre-migration-20261119-173301.bundle`
- 被删除的旧源码：`backup/android-removed/`，说明见 `backup/README.md`

## 4. 历史阶段（已完成，保留摘要）

1–18 阶段（Linux 依赖恢复、AI 解析链路、chemvz 校验、本地预设、设置持久化、桌面桥接、构象搜索、共面检测等）已完成，详见 `progress.md` / `findings.md`。
