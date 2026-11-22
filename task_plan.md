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
| 命名 AI | 顺序：预设 `iupac` → 命名缓存 → 文本模型 → 本地 `IupacNamer`；本地名称先显示，AI 成功后升级，失败静默回退 |
| 命名缓存 | 以规范 SMILES（无 SMILES 时结构签名）为键，独立 `naming` 命名空间，复用桌面/Android/localStorage 传输 |
| 大分子几何 | 自动分级：coarse 先渲染 → fine 后台精修；>200 重原子不做全量 MMFF94；粗/细结果都必须过 `GeometryValidator` |
| 晶体 / 离子键 | 独立计划 `task_plan_crystal_ionic.md`；`chemvz: 3`，不破坏 `chemvz: 2` |

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

### P7 发布验证（v1.1.0 统一版已发布）
- [x] 单一仓库：Android 外壳并入 `android/`，删除 `ForAndroid` 分支与独立仓库
- [x] 桌面打包：`desktop/build_release.py`（deb / 便携 tar.xz / Windows zip / Inno Setup 安装包）
- [x] CI：`.github/workflows/desktop-release.yml` 在 Linux 与 Windows 原生构建
- [x] 产物：Windows setup.exe / portable.zip、Linux deb / portable.tar.xz、Android APK
- [x] GitHub Release：`v1.1.0`（唯一发布，五个附件，非技术化更新说明）
- **验收结果**：`npm run check` 112/112；deb `--help` 与 headless 服务实测；APK 与 `release/android` 字节一致

### P8 历史遗留清理（已完成）
- [x] 删除 UFF 死路径：`engine/uff.ts`、`vseprBuilder` 的 `uffRelax` 块与 `BuildOptions.relax`；启发式后端继续用 `ConstrainedMinimizer`（112/112 通过）
- [x] 设置 schema 单一源：`shared/settings.defaults.json`（字段、枚举、默认值），TS / Vite / Python 共用
- [x] 拆 `ai/config.ts`（589 行）→ `ai/settings/` 下的类型、默认值、归一化、存储、桥接模块
- [x] 拆 `vseprBuilder.ts`（606 行）→ `placement/knownSpecs.ts` + `placement/postPlacement.ts` + 门面（391 行）
- [x] 拆 `conformerSearch.ts`（400 行）→ `conformer/search/{types,planarity,explore}.ts` + 18 行门面
- [x] 组件瘦身：`RightPanel`（279→123）拆面板；`MoleculeViewer`（258→150）抽 `useViewerScene`
- [x] 统一 orientation / touch 检测：`hooks/useResponsiveLayout.ts`，移除三处重复 resize 监听
- [x] 更新 `Agent.md` 到当前架构（移除 RDKit、已删模块、旧文件表）；`findings.md` 追加当前事实
- [x] 清理 `src/types/bridge.d.ts` 与 Android 桥中未使用的字段（删除 `window.__chemviz` 死桥）
- **验收**：tsc 0；117/117 测试全过；engine 文件 ≤400 行、组件 ≤250 行；无 `uffRelax` / `rdkit` 生产引用；三端打包脚本待发布前复验

### P9 AI 命名（缓存 / 预设 + 本地回退）
- [ ] `MoleculeData.iupacSource?: "preset" | "cache" | "ai" | "local"`，保留 `iupacName` / `iupacError`
- [ ] 22 个预设 JSON 增加 `iupac`（标准英文名）；`localParser` 读出并透传
- [ ] `src/naming/cache.ts`：键 = 规范 SMILES（无 SMILES 时结构签名）；`naming` 命名空间；桌面桥 / Android / localStorage 三路复用
- [ ] `src/naming/aiNamer.ts`：专用 prompt，严格 JSON `{ name, comment? }`，校验非空/单行/长度/无前缀；复用文本模型配置与重试
- [ ] `src/naming/NamingService.ts`：本地名称立即返回；预设/缓存/AI 异步解析成功后升级；请求令牌防止旧结果覆盖新分子；失败静默回退本地
- [ ] UI：名称来源徽标；命名缓存清除 / 重新生成入口
- [ ] 测试：预设 golden、缓存键稳定、AI mock 成功/失败回退、旧请求不覆盖、无 AI 配置时行为不变
- **验收**：无 AI 配置时与现状一致；有 AI 时名称来自 AI 且命中缓存；本地失败仍显示 `NamingError`；`npm run check` 全过

### P10 大分子分级处理（先粗后细）
- [ ] 基准：记录 C40 / C80 / C120 / C200 的 OCL 生成与 MMFF94 时间（当前 C40 122 原子约 1.4–1.8 s）
- [ ] `ConformerPlan`：按重原子数 / 环数选择 `coarse` / `balanced` / `fine`；初定阈值 ≤60 / 61–200 / >200
- [ ] 两阶段 API：`ConformerService.build` 返回粗几何 + `refine()`；`useMolecule` 先渲染粗几何，再后台精修，仅在分子未变时替换
- [ ] 精修预算：MMFF94 `maxIts` 按档位；>200 重原子跳过全量 MMFF94，改用受限 `ConstrainedMinimizer` 或仅柔性键
- [ ] 渲染降级：>400 原子关闭标签、降低球体分段；>800 原子评估实例化渲染
- [ ] 构象搜索联动：大分子自动降档并提示
- [ ] 测试：C40/C120 键长、重叠、NaN 不变量；首帧时间预算；精修后不回退
- **验收**：C120 粗几何首帧 < 1.5 s；精修完成后无跳变/无错误；C40 结果不劣于当前

### P11 晶体与离子键（独立计划）
- [ ] 按 `task_plan_crystal_ionic.md` 执行 C0–C7
- **验收**：见独立计划

## 3. 备份

- 仓库与工作树备份：`backup/`（bundle + tar.gz，含 Android 子仓库；已在 `.gitignore` 中）
- 迁移前 Android 快照：`backup/chemviz3d-android-pre-migration-20261119-173301.bundle`
- 被删除的旧源码：`backup/android-removed/`，说明见 `backup/README.md`

## 4. 历史阶段（已完成，保留摘要）

1–18 阶段（Linux 依赖恢复、AI 解析链路、chemvz 校验、本地预设、设置持久化、桌面桥接、构象搜索、共面检测等）已完成，详见 `progress.md` / `findings.md`。

## 5. 当前状态

- P8 已完成：低风险清理（UFF 死路径、设置 schema、文件拆分、组件瘦身、orientation、桥接清理、文档）。
- P9 / P10 在 P8 验收后开始；P11 独立推进。
- 旧 P4 / P5 / P6 的未完成项已并入 P8，不再单独维护。

## Next Step

P9.1：给 `MoleculeData` 增加 `iupacSource`，并让 22 个预设 JSON 带上标准英文 `iupac` 字段。
