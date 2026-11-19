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

### P2 后端接入 + IUPAC 命名
- [ ] `ConformerBackend` 抽象 + `OpenChemLibBackend` + `RigidTreeBackend`
- [ ] 裁剪并内联 OCL resources（COD + MMFF94，去掉 druglikeness/tox）
- [ ] `domain/naming`：父体选择、取代基、位次、字母序、装配
- [ ] UI：IUPAC 名称独立展示；失败显示明确错误（不得显示分子式冒充名称）
- **验收**：22 预设命名 golden 通过；不支持结构返回具体错误码

### P3 平台统一
- [ ] `platform/` 适配器 + 探测（`VITE_PLATFORM` → 注入 → `platform.json` → web）
- [ ] 单一 IIFE 产物（`inlineDynamicImports`，worker inline）
- [ ] 统一 `index.html`；Android 桥脚本移入 `platform/android/`
- [ ] Android 升级 `WebViewAssetLoader`
- [ ] 合并 Android 图片解析到共享代码
- [ ] Android 仓库删除 `src/`、`vite.config.ts`、`package.json`、根 `index.html`、`_archive/`
- [ ] `scripts/package.mjs` 生成三端产物 + `platform.json`
- **验收**：同一份 `assets/main.js` 在 Web / 桌面 / Android 启动；三端设置、缓存、AI、截图、文件读写全部走适配器

### P4 分层拆分与死代码清理
- [ ] 拆 `vseprBuilder` / `MoleculeViewer` / `ai/config` / `aiParser` / store
- [ ] 删除 `builder.ts`、`validation.ts`、`smilesGenerator.ts`、`moleculeDataToChemVZ` 等死代码
- [ ] 设置 schema 单一源（TS / Vite / Python 共用）
- **验收**：无循环依赖；行数达标；tsc 0 error

### P5 性能与大结构
- [ ] 构建/松弛/构象搜索进 Worker，带进度与取消
- [ ] 共享几何体/材质、增量渲染、dispose 审计
- [ ] 平面分析按 revision memo
- [ ] 大结构档位：>150 原子降级，>400 原子实例化渲染
- **验收**：C40 不阻塞主线程；旋转 60 fps；连续切换无内存增长

### P6 UI 统一视觉
- [ ] tokens + 分层 CSS，去内联样式
- [ ] 单一 orientation 判定（CSS 或 JS 二选一）
- [ ] `data-platform` / `data-touch` 标签样式
- [ ] i18n 类型化 + 缺失 key 检查
- **验收**：三语言 × 桌面/竖屏/横屏截图基线一致

### P7 发布验证
- [ ] Web 静态包、Windows/Linux 桌面包、Android APK
- [ ] `platform.json` 与注入校验
- **验收**：三端冒烟通过；两仓库无交叉引用

## 3. 备份

- 仓库与工作树备份：`/tmp/opencode/backups/`（bundle + tar.gz，含 Android 子仓库）
- 时间戳：`20261119-131958`

## 4. 历史阶段（已完成，保留摘要）

1–18 阶段（Linux 依赖恢复、AI 解析链路、chemvz 校验、本地预设、设置持久化、桌面桥接、构象搜索、共面检测等）已完成，详见 `progress.md` / `findings.md`。
