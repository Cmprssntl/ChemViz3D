# ChemViz3D 晶体与离子键支持计划

> 独立计划，不阻塞主计划 `task_plan.md`。主计划完成 P8–P10 后再进入本计划。
> 规则：任何阶段不通过验收，不进入下一阶段。

## 0. 目标

1. **晶体**：能载入晶格参数与分数坐标，显示晶胞（棱、轴、原子），支持周期镜像与晶胞参数面板。
2. **离子键**：能表示、渲染、计算并命名离子键/离子化合物；不与共价键的价键、构象、旋转规则混淆。
3. **输入**：先支持 chemvz 晶体 JSON 与本地预设，再支持 CIF 子集导入，最后接 AI 晶体解析。
4. **不破坏**：现有 `chemvz: 2` 分子、22 个预设、三端打包与测试全部保持通过。

## 1. 已确认的决策

| 决策 | 结论 |
|---|---|
| 格式版本 | 晶体使用 `chemvz: 3`；`chemvz: 2` 语义不变；校验器同时接受 2/3 |
| 坐标 | 晶体原子用 `frac: [x,y,z]`（分数坐标）；渲染时按晶格矩阵转笛卡尔 |
| 晶格 | `lattice: { a,b,c,alpha,beta,gamma }`，单位 Å / 度；不接受负值或退化胞 |
| 离子键 | `bond.kind: "covalent" \| "ionic"`，默认 `covalent`；离子键 `order` 固定为 1，不参与价键/氢推断 |
| 周期镜像 | 默认 1×1×1；可选 2×2×2，仅渲染，不改变原始数据 |
| 键的生成 | 晶体默认不自动成键；离子接触由截断距离生成“接触线”，不写入 `bonds` |
| 命名 | 离子化合物走本地二元离子命名（阳离子 + 阴离子），失败再由 AI 命名；共价晶体走现有命名/AI |
| CIF | 只支持 P1 对称（`_symmetry_equiv_pos_as_xyz` 可展开）与常见 `_atom_site_*` 字段；其余明确报错 |
| 依赖 | 不新增第三方晶体库；晶格数学自研，纯 TypeScript |
| 平台 | 晶体数据同样走 `chemvz` 校验、缓存与预设；Android/桌面共用 |

## 2. 目标数据模型

```ts
// types/molecule.ts
export type BondKind = "covalent" | "ionic";

export interface BondData {
  index: number;
  atom1Idx: number;
  atom2Idx: number;
  order: number;
  kind?: BondKind;          // 缺省 covalent
  length?: number;
}

export interface CrystalLattice {
  a: number; b: number; c: number;
  alpha: number; beta: number; gamma: number; // degrees
}

export interface CrystalData {
  lattice: CrystalLattice;
  /** Fractional coordinates aligned with MoleculeData.atoms. */
  fractional: Array<[number, number, number]>;
  /** Optional space-group symbol, display only. */
  spaceGroup?: string;
}
```

```ts
// types/moleculeFormat.ts
export interface ChemVZCrystal {
  chemvz: 3;
  name?: string | Record<string, string>;
  comment?: string;
  lattice: CrystalLattice;
  spaceGroup?: string;
  atoms: Array<{ el: string; frac: [number, number, number]; charge?: number }>;
  /** Optional explicit bonds; ionic contacts are derived, not stored. */
  bonds?: Array<{ i: [number, number]; kind?: BondKind; order?: number }>;
}
```

`MoleculeData` 增加可选 `crystal?: CrystalData`。渲染、相机、测量仍只读 `atoms[].x/y/z`，晶胞只是额外的场景层。

## 3. 阶段与验收

### C0 格式与类型（基础）
- [ ] `types/molecule.ts` 增加 `BondKind`、`CrystalLattice`、`CrystalData`、`MoleculeData.crystal`
- [ ] `types/moleculeFormat.ts` 增加 `ChemVZCrystal` 与 `isChemVZ`/`isChemVZCrystal`
- [ ] `validateAIChemVZ` 拆分：分子校验（v2）与晶体校验（v3）
- [ ] 严格校验：晶格正数、角度 0–180、分数坐标有限、原子索引有效、离子键只允许 v3/显式
- [ ] 测试：合法/非法晶体 JSON；v2 行为不变
- **验收**：`npm run check` 全过；v2 预设全部仍通过

### C1 晶格数学与晶胞渲染
- [ ] `domain/crystal/Lattice.ts`：`toCartesian(frac)`、`toFractional(xyz)`、`cellEdges()`、`cellCenter()`、`cellVolume()`
- [ ] `domain/crystal/minimumImage.ts`：最小镜像距离/位移
- [ ] `engine/view/CrystalScene.ts`：12 条棱、a/b/c 轴标签、半透明面（可选）
- [ ] `MoleculeViewer` 集成：有 `crystal` 时创建/更新/释放晶胞层
- [ ] `CameraRig` 对晶胞取景（包围盒包含 8 个顶点）
- [ ] 测试：立方/六方/三斜晶格体积与分数↔笛卡尔往返；棱数 12；相机包含晶胞
- **验收**：立方晶胞显示正确；旋转/缩放/复位不丢失晶胞；无内存泄漏

### C2 周期镜像
- [ ] `CrystalScene` 支持 `replicas: 1 | 2`（2×2×2）
- [ ] 镜像原子按平移向量复制，透明度降低，不参与拾取（或可切换）
- [ ] 边界键/接触线跨胞绘制（最小镜像）
- [ ] UI：显示/隐藏晶胞、镜像档位
- [ ] 测试：2×2×2 原子数为 8×；平移向量正确
- **验收**：2×2×2 可切换；镜像不改变原始 `MoleculeData`

### C3 离子键
- [ ] `BondData.kind` 贯通：`chemVZToBondSpec`、`ConformerService`、`MoleculeScene`、`properties`
- [ ] 渲染：离子键用虚线/细管 + 元素色，不画多重键；图例/i18n
- [ ] 图规则：`MolecularGraph` 新增 `covalentBonds`/`ionicBonds`；价键、隐式氢、可旋转键、环感知只读共价键
- [ ] 几何：离子键不进入力场键项、不进入 SHAKE；晶体位置直接使用分数坐标
- [ ] 属性：离子键不计入可旋转键/TPSA 的键级判断；分子量仍按原子计
- [ ] 测试：NaCl 型结构 0 可旋转键、无隐式氢；离子键不参与环
- **验收**：离子键可见且不破坏共价分子行为；v2 测试全过

### C4 离子化合物命名
- [ ] `domain/naming/IonicNamer.ts`：二元离子（NaCl、MgO、CaCl2、FeCl3、NH4Cl 子集）
- [ ] 变价金属用罗马数字（FeCl2/FeCl3）；多原子离子表（OH⁻、NO3⁻、SO4²⁻、CO3²⁻、NH4⁺、PO4³⁻）
- [ ] 命名顺序：预设 `iupac` → 命名缓存 → AI 命名 → 本地离子命名
- [ ] AI 命名复用主计划 P9 的 `NamingService`，晶体/离子走同一缓存
- [ ] 测试：NaCl/MgO/CaCl2/FeCl3/(NH4)2SO4 golden；失败明确报错
- **验收**：常见离子化合物名称正确；不支持的结构返回 `NamingError`

### C5 CIF 导入与预设
- [ ] `domain/crystal/cif.ts`：解析 `_cell_length_*`、`_cell_angle_*`、`_symmetry_equiv_pos_as_xyz`、`_atom_site_label/type_symbol/fract_x/y/z`
- [ ] 对称操作展开（P1 操作；重复坐标去重）
- [ ] 文件入口：`processCrystalFile`，与 `processChemVZFile` 并列
- [ ] 预设：`molecules/presets/` 增加 NaCl、CsCl、金刚石、石墨（按需）
- [ ] 测试：CIF 样例（NaCl/金刚石）原子数、晶格参数、去重
- **验收**：导入 CIF 后晶胞与原子正确；非法 CIF 明确报错

### C6 UI / i18n / 打包
- [ ] 左侧面板：晶体信息（a/b/c/α/β/γ、空间群、原子数）
- [ ] 右侧/顶部：晶胞开关、镜像档位、离子键图例
- [ ] 三语文案；i18n 一致性测试
- [ ] `scripts/package.mjs` 三端产物包含新代码；Android/桌面实测
- **验收**：三端加载晶体预设无错误；触控布局正常

### C7 回归与发布
- [ ] `npm run check` 全过（含新增晶体/离子测试）
- [ ] 几何/命名/属性旧测试不回退
- [ ] 截图基线（晶体 + 离子键）
- [ ] 更新 README 用户说明（晶体输入方式、晶胞开关）
- **验收**：全部测试通过；三端产物可加载晶体预设

## 4. 风险与边界

| 风险 | 处理 |
|---|---|
| `chemvz: 3` 破坏旧校验 | 校验器按版本分支；v2 路径零改动 |
| 周期镜像导致场景爆炸 | 默认 1×1×1；2×2×2 仅按需；>2000 镜像原子警告 |
| 离子键被当作共价键 | 所有图/价键/力场入口显式过滤 `kind !== "ionic"` |
| CIF 对称操作不完整 | 只支持 P1；其余明确报错，不静默猜测 |
| 晶体无构象搜索意义 | 晶体模式禁用键旋转/构象搜索，UI 提示 |
| AI 晶体解析幻觉 | 严格晶格/坐标校验；失败回退预设/本地 |

## 5. 交付顺序

C0 → C1 → C2 → C3 → C4 → C5 → C6 → C7。C0–C1 可先做，C3 与主计划 P9 的命名服务有依赖，C4 需 P9 完成。
