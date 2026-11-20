# Settlement Studio V6.0 — Watabou 级有机街坊、合院尺度与自然林冠升级规格书

| 文档属性 | 规范内容 |
| :--- | :--- |
| **文档版本** | `V6.0`（有机聚落肌理、建筑学真实尺度与植被美学重构） |
| **适用范围** | `/Users/wumail/code/TERRAX/settlement_studio/` |
| **前置基线** | `V5.0.1`（9 个测试文件全绿、全幅水文等高线、自然条田、V4 AI CLI/MCP） |
| **核心目标** | 根治“巨型单体客舍比例失调、民居大小均质且街角缺牙乱撒、次级巷道漏绘、树木呈孤立正圆波点、禁建虚线框穿帮、街区与地标字号混同”六大成图短板，对标 Watabou 原生有机聚落质感 |

---

## 0. 根因诊断与架构原则

对 V5 实战成图与 Watabou 经典成图的逐项几何比对表明，当前视觉差距并非随机种子问题，而是 6 处底层生成与渲染机制缺陷：

1. **沿边摆刚体盒 vs 宅基地递归剖分**：`townBlocks.ts` 沿边塞正交矩形，街角处两矩形相撞即被碰撞守卫剔除，造成街角普遍缺牙；`keepProbability` 逐栋独立掷骰子跳过，导致连续商业街出现“麻子脸豁口”。
2. **次级巷道计算了却未渲染**：`townBlocks.ts` 向 `targetResult.internalStreets` 推入了街坊巷道，但 `src/renderer/` 从未绘制 `scene.internalStreets`，导致屋宇失去可见街巷依托，视觉上像无序散点。
3. **民居尺寸均匀随机，缺乏层级谱系**：`9.5 + rng * 8` 的均匀分布使全城民房体量趋同，缺少“紧凑小铺/附屋 — 标准商宅 — 街口大户”的真实重尾分布。
4. **把“大院占地”画成“单块巨型屋顶”**：`customStructures.ts` 的 `u_court` 按 `0.32 * min(w, d)` 计算翼楼进深，当占地 `80m × 65m` 时生成进深 `21m` 的巨无霸连体屋面（顶 60 栋民房），违背木构/砖木建筑物理进深极限（`<= 13m`），且缺少围墙 + 独立厅厢组合的真实 `courtyard`（合院）原语。
5. **正圆单树 + 稀疏网格森林**：每棵树仅画单个正圆，`woodland` 网格间距 `11–18m` 大于树冠直径，无法融合成云朵状分叶树冠，也缺少林下草甸底色衬托。
6. **`plain` 禁建虚线框穿帮 & 标注无主次**：`exclusionStyle: 'plain'` 在正式导出图上仍画粗灰虚线框；街区名与点状地标同为 `10.5px` 平铺字号，缺乏跨街区大字暗标层级。

### 0.1 硬性护栏（100% 继承既有门禁）

1. `src/` 下所有 `.ts` / `.tsx` 单文件物理行数严格 `<= 320` 行（超限必须拆分子模块）。
2. 零 `any`、零 `as any`、零 `@ts-ignore`、零 `TODO` / `FIXME`；`src/core/` 与 `src/ai/` 严禁 `Math.random()`；**零新增 npm 依赖**。
3. `src/ai/`、`src/cli/`、`src/mcp/` 与 `.agents/skills/` 严禁出现任何外部世界观路径或预设专名（保持 `T7` 静态守卫 100% 通过）。
4. 既有 9 套测试文件（含 `T5` 20ha 边镇 `240–520` 栋、均面积 `80–260 m²`、重抽 `< 250ms`；`T8` 三套预设与 `D203_灰山口` 零穿模零告警）必须保持全绿。

---

## 1. 模块一：Watabou 式街块递归剖分与可见街巷（`lotSubdivision.ts` + `townBlocks.ts` + `paintLand.ts`）

### 1.1 新建 `src/core/generators/lotSubdivision.ts`（宅基地递归二分算子）

替代原有的“沿边硬塞独立矩形（`placeFacadeRow`）”，采用 **封闭街块 → 扭转 OBB 递归二分 → 临街过滤 → 贴边切屋**：

1. **主轴最小包围盒（Principal OBB）**：
   - 遍历凸/近凸街块 `block` 的边方向（最多取前 12 条较长边），求投影矩形面积最小的局部正交轴 `(ux, uy)` 及跨度 `(spanU, spanV)`。
2. **递归二分切宅基地（`subdivideBlockIntoLots`）**：
   - 输入：`block: Polygon`、`targetLotM2: number`（核心临路块 `(105 + rng * 85) * scale²`，普通街块 `(130 + rng * 115) * scale²`）、`minFrontM = 5.6 * scale`、`rng: RngFn`、`depth = 0`。
   - 终止条件：`area <= targetLotM2 * 1.42` 或 `Math.max(spanU, spanV) < minFrontM * 2.05` 或 `depth >= 8`。
   - 切分规则：垂直于较长轴 `longAxis` 取分位 `t = 0.38 + rng() * 0.24`；切线法向施加微小有机扭转角 `twistRad`（当 `area > 420 * scale²` 时 `(rng() - 0.5) * 0.11` 约 `±3.2°`，末级切分 `(rng() - 0.5) * 0.035` 约 `±1°`，保证相邻房屋山墙近似平行又自然顺弯）。
   - 用 `clipPolygonHalfPlane` 切出左右两半，若两半面积均 `>= 42 * scale²` 且最短跨度 `>= minFrontM * 0.85` 则递归，否则当前多边形作为叶节点宅基地返回。
3. **临街边识别与中庭留白**：
   - 对每个叶节点 `lot`，遍历其各边 `(A, B)`：若边长 `>= 5.0 * scale` 且边中点到母街块 `block` 外轮廓的最小距离 `< 1.6m`，则该边为候选临街边（取最长临街边作为正立面 `frontEdge`）。
   - **无任何临街边**的内部叶节点不建正房，自动归入 `courtyardPolys`（供街块中庭成簇植树，自然形成“外圈围合连排、内院留白植树”的 Watabou 肌理）。
4. **由宅基地生成贴边屋面（`buildLotFootprint`）与三档重尾尺寸谱系**：
   - 设临街边 `frontEdge = (A, B)`，内法向为 `inward`。按区位（距主干道距离 `dRoad` 及是否为街块转角 `isCornerLot`）抽取三档建筑进深（均乘 `scale`）：
     - **S 档 · 紧凑小铺/小户（约 55%）**：进深 `d = (6.0 + rng() * 2.6) * scale`；若 `|B - A| > 12.8 * scale`，先将 `lot` 沿临街边中点再对半切为两间窄面宽连排小铺（面宽 `5.8–8.5m`）。
     - **M 档 · 标准商宅/曲尺宅（约 35%）**：进深 `d = (8.2 + rng() * 3.2) * scale`；用半平面 `(x - A)·inward <= setback + d` 与 `(x - A)·inward >= setback`（`setback = (0.35 + rng() * 0.55) * scale`）直接裁剪 `lot`，再沿两侧邻墙向内微缩 `0.38 * scale` 留出山墙滴水缝！
       > **几何关键**：因为直接裁剪 `lot` 多边形而非塞死板矩形，在斜交街角或弯道处，屋顶自动呈**贴合路口的梯形 / 微楔形四~五边形**，相邻山墙平行紧咬（缝宽 `0.7–1.2m`），彻底消灭街角缺牙！
     - **L 档 · 街口大宅/行栈（约 10%，在 `isCornerLot` 或 `dRoad < 26m` 时权重翻倍）**：进深 `d = (10.2 + rng() * 2.8) * scale`（严格 `<= 13.5 * scale`），若后院剩余深度 `> 6.5 * scale`，沿一侧山墙追加一栋窄厢房（宽 `5.2–7.0m * scale`）构成曲尺合院。

### 1.2 升级 `src/core/generators/townBlocks.ts`

1. **消除分离泡泡死白带**：`compileTownBlocksZone` 外边界退界从 `6.0m` 收紧至 `1.8m`（穿区道路仍由 `splitBlockByRoads` 精确留出路廊），使建筑物贴近路缘、相邻街坊选区跨路自然衔接。
2. **整块/外环级平滑衰减（废除逐栋拔牙）**：
   - 移除单栋循环内的随机跳过；
   - 当 `zone.contentType === 'town_blocks' && zone.frayOuter !== false` 时，仅对**远离主干道（`dRoad > 34m`）且位于选区外缘（`radial > 0.66`）**的街块/外圈远端宅基地按连续概率整组留空，而沿出城干道两侧（`dRoad <= 34m`）保持高保留率，自然长出沿路延伸的关厢带（Ribbon Suburb）。
3. **干净的次级巷道提取**：
   - 提取 Voronoi 街块间不与主干道及选区外框重合的内部共享边（或退界前的内街折线），裁剪掉 `holes` 与既有主路走廊后推入 `targetResult.internalStreets`。
4. **验证指标兼容性**：确保 20ha `walled_city`（`buildingScale=1, density=0.88`）稳定产出 `260–500` 栋、均面积 `85–190 m²`，与 `T5` 和 `D2-03` 门禁完全兼容。

### 1.3 补绘 `internalStreets`（`src/renderer/paintLand.ts`）

在 `paintLanes(ctx)` 最前部绘制 `scene.internalStreets`：
- 先画细淡路缘（`stroke: mixHex(pal.roadCasing, pal.paperBg, 0.52)`, `lineWidth: ctx.px(4.8)`, `lineCap: 'round'`, `lineJoin: 'round'`）；
- 再画干净街面（`stroke: pal.roadFill`, `lineWidth: ctx.px(3.6)`, `lineCap: 'round'`, `lineJoin: 'round'`）；
- 原有 `scene.lanes`（村径虚线）与 `gardenFences` 保持其后绘制不变。

### 1.4 村落体量层次微调（`src/core/generators/village.ts`）

- 保留迷你营地（`compact` 模式，`T6` 6–14 栋、`25–90 m²`）逻辑完全不变，确保 `T6` 与 `D2-03` 猎人营地 100% 稳定通过；
- 非 `compact` 普通村落模式下，正房尺寸改为三档错落（小柴棚/附舍 `7.2×4.8m`、普通农舍 `10.5×6.4m`、大户农家 `13.2×7.4m` 乘 `scale`），朝向加 `(rng() - 0.5) * 0.14`（约 `±4°`）随路微摆，消除兵营式呆板感。

---

## 2. 模块二：建筑学真实进深硬约束、合院 `courtyard` 与去虚线框场坪

### 2.1 收紧 `u_court` / `l_hall` 翼楼厚度上限 + 新增 `'courtyard'` 合院类型

1. **Schema 扩展（100% 向下兼容）**：
   - `src/schema/v3.entity.schema.ts`：`STRUCTURE_KINDS` 扩充为 `['rect', 'l_hall', 'u_court', 'round_altar', 'courtyard'] as const`。
   - `src/schema/entity.schema.ts`：`ZoneExclusionStyles` 扩充为 `['plague_stones', 'meadow', 'marsh', 'plain', 'enclosure'] as const`。
2. **限制既有 `l_hall` / `u_court` 单体屋面最大物理进深**（`src/core/generators/customStructures.ts`）：
   - `lHallPoints(w, d)`：主翼进深 `Math.min(13.0, d * 0.42)`，侧翼面宽 `Math.min(12.0, w * 0.34)`；
   - `uCourtPoints(w, d)`：三面翼楼厚度 `t = Math.min(12.0, Math.min(w, d) * 0.30)`。
   - 效果：旧工程中即使写了 `50×38` 的 `u_court`，也会画成翼深 `11.4m`、中庭宽敞的纤秀三合院，彻底告别 `22m` 实心厚砖块！
3. **新增 `'courtyard'` 多屋顶围合大院编译与渲染**：
   - 在 `BuiltStructure` 接口新增可选字段：
     - `readonly extraPolygons?: ReadonlyArray<{ readonly polygon: Polygon; readonly shadow: Polygon; readonly ridge: readonly [Vec2, Vec2] | null }>;`
     - `readonly yardPolygon?: Polygon | null;`
     - `readonly wallPolylines?: ReadonlyArray<Polyline>;`
   - 当 `source.kind === 'courtyard'`（适用于客舍、驿馆、衙署、会馆、大货栈，推荐 `widthM: 28..64, depthM: 24..56`）时：
     - `yardPolygon`：整块占地外框（`orientedRect(x, y, w, d, angleDeg)`）；
     - `wallPolylines`：沿占地四周内缩 `0.6m` 的实线围墙折线，南边（局部 `+y` 侧）正中留出 `Math.min(7, w * 0.2)` 宽的院门豁口；
     - **主建筑 `polygon`（北侧正堂）**：局部中心 `(0, -hd + mainD * 0.5 + 1.6)`，宽 `Math.min(w - 6, Math.max(12, w * 0.68))`，进深 `mainD = Math.min(11.5, Math.max(7.2, d * 0.26))`；
     - **附属屋顶 `extraPolygons`**：
       - 东西两侧独立厢房/马厩（局部 `(±(hw - wingD * 0.5 - 1.4), wingY)`，进深 `wingD = Math.min(8.2, Math.max(5.5, w * 0.19))`，长 `Math.max(8, d * 0.44)`，与正堂脱开 `2.2m` 火巷！）；
       - 若 `w >= 34 && d >= 30`，在南门两侧各加一间门房（宽 `Math.min(10, w * 0.24)`，进深 `Math.min(6.8, d * 0.16)`）。
     - 在 `collectRigidPolys`（`compilePipeline.ts`）中，`courtyard` 将 `yardPolygon` 整院注入 `rigidPolys`，保证民房绝不长进客舍院内；
     - 在 `paintStructures.ts` 中：先画 `yardPolygon` 淡压实土色院坪底（`mixHex(pal.roadFill, pal.farmlandFill, 0.38)`, `fillOpacity: 0.78`）与 `wallPolylines` 实线矮院墙（`stroke: pal.wallStroke`, `lineWidth: ctx.px(1.3)`），再统一绘制正堂与全部 `extraPolygons` 的阴影、屋面与屋脊线！

### 2.2 消除导出态 `plain` 虚线框穿帮 + 实现 `'enclosure'` 真实场坪（`paintContext.ts` + `paintLand.ts`）

1. 在 `PaintContext`（`paintContext.ts`）与 `makeContext` 中透传 `readonly isExport: boolean`（`paintScene.ts` 调用时传入 `Boolean(options.isExport)`）。
2. 在 `paintExclusion`（`paintLand.ts`）中：
   - `style === 'plain'`：**当 `ctx.isExport === true` 时完全不绘制任何线条或色块**（纯无痕空间留白）；仅在交互编辑态（`!ctx.isExport`）画极淡辅助虚线（`opacity: 0.28`）。
   - `style === 'enclosure'`（新增“围栏场坪”，用于车马候装坪、晒场、货栈院）：绘制淡暖土铺地（`fill: mixHex(pal.roadFill, pal.farmlandFill, 0.45)`, `fillOpacity: 0.55`）+ 细实线矮墙边（`stroke: pal.inkDark`, `lineWidth: ctx.px(1.0)`, `opacity: 0.68`，无虚线！）。

### 2.3 超尺度实心单体告警（`src/ai/spatialAnalyze.ts`）

在 `collectWarnings` 中：若存在 `kind !== 'courtyard' && kind !== 'round_altar'` 的 `structure` 满足 `Math.min(item.widthM, item.depthM) > 32`（兼容既有全部预设与 `D203` 最大 `42×30` 零误报，精准拦截 `60×36`、`76×60`、`92×72` 等巨无霸单体），追加告警建议改用 `kind: 'courtyard'` 或拆分为合院建筑群。

---

## 3. 模块三：Watabou 多瓣云朵树冠、林地底衬与成簇植被

### 3.1 多瓣融合云朵树冠（`src/renderer/paintLand.ts` → `paintTrees`）

不改 `TreeRecordBase` 数据结构，不破坏 `tree.r` 净空守卫，在 `paintTrees` 渲染展开阶段将单棵圆树升级为**确定性多瓣树冠（Lobed Canopy）**：

- 对每棵树 `t = (x, y, r)`，用确定性整数哈希 `h = hash2d(Math.round(t.x * 10), Math.round(t.y * 10))`：
  - 若 `t.r < 3.2`：保持 1 主圆 + 2 微瓣（保证小灌木轻巧）；
  - 若 `t.r >= 3.2`：展开为 **1 个中心核（半径 `0.72 * r`）+ 4 个环绕偏心叶瓣**（第 `k` 瓣角度 `baseAng + k * (2π/4) + jitter`，偏心距 `(0.34 + u1 * 0.12) * r`，瓣半径 `(0.48 + u2 * 0.14) * r`）。
  - 注意：`偏心距 + 瓣半径 <= 0.46r + 0.62r = 1.08r`（描边仍在既有安全净空内，不压屋不压路）。
- 将全部展开后的叶瓣圆一并送入现有的三遍 `drawCirclesMergedPass`（阴影 → `pal.treeOutline` 外轮廓 → `pal.treeFill` 绿心）：相邻叶瓣与相邻树自动布尔融合成 **Watabou 标志性的分叶云朵林冠**！

### 3.2 成片林地团簇化与林下草甸底衬（`woodland.ts` + `paintLand.ts`）

1. **林下底色**：在 `paintLand.ts` 新增 `paintWoodlandUnderstory(ctx, zoneId?)`（于土地底纹层绘制）：对每个 `contentType === 'woodland'` 的选区，绘制柔和林下苔草底色（`fill: mixHex(pal.treeFill, pal.paperBg, 0.78)`, `fillOpacity: 0.46`，无描边）。
2. **团簇林冠生成（重写 `compileWoodlandZone`）**：
   - 废除原先圆心距 `11–18m` 的孤立波点网格；
   - 以 `clusterStep = 15 + (1 - zone.density) * 9` 生成林团中心核；每个核内紧密排布 `3–5` 棵交叠大树（核内偏移 `0..6.2m`，半径 `4.0..7.2m`，彼此圆心距 `< 0.85 * (r1 + r2)`，必融合成成片云朵林块！），并在核间空隙按 `0.35` 概率补 `1–2` 棵林缘小树（`r = 2.8..4.0m`），全部经 `guardSafeTree` 守卫。

### 3.3 街坊中庭与农田树篱紧簇化（`townBlocks.ts` + `farmland.ts`）

- `townBlocks.ts`：对递归剖分留出的内院（或面积 `>= 420 m²` 的街块中心），以一处内院锚点紧簇种植 `2–4` 棵相距 `3.2–5.5m` 的院树（融合成一团绿荫而非孤立圆点）。
- `farmland.ts`（`plantHedgerows`）：沿田埂锚点的树距由 `4.5–7.8m` 收紧为 `3.4–5.4m`，树冠半径 `3.6–5.2m`，使相邻树篱自然连成图 2 那样的带状绿篱。

---

## 4. 模块四：分级地图字标排版（`src/renderer/paintAnnotations.ts`）

拉开「街区/地域大名」与「具体建筑/地标小注」的视觉主次（仅影响 `standard` 模式，`guided` 与 `pure` 模式保持不变）：

1. **隐去无痕留白区标签**：`contentType === 'exclusion' && exclusionStyle === 'plain'` 的辅助留白选区在导出态默认不自动绘制选区名（若用户需要标注该场地，用 `enclosure`/`market` 或地标表达）。
2. **大街区主轴宽字距暗标（District Watermark）**：
   - 对 `walled_city`、`citadel`、`town_blocks`、`market` 且面积 `>= 1.8 ha` 的主要街区：
     - 字号提升至 `12–14.5px`（随选区跨度平滑插值并受视口缩放约束）；
     - CJK 字符之间插入窄空格（如 `'东街铺宅'` → `'东 街 铺 宅'`，长度 `<= 6` 字时启用）模拟古图刻本宽字距质感；
     - 颜色采用 `mixHex(pal.inkDark, pal.paperBg, 0.32)`、`opacity: opacity * 0.76`、柔和纸色光晕 `haloWidthPx: 3.0`，不带任何圆点图标，一眼与 `10.5px` 带徽记的具体地标拉开层级！

---

## 5. 验收测试矩阵（新建 `tests/v6-organic-fabric.test.ts`）

必须与既有全部 9 个测试文件一同 100% 通过 `npm run check` 与 `npm run build`：

1. **宅基地递归剖分与街角梯形屋面**：
   - 给定斜交四边形/多边形 `town_blocks`，产出屋宇中包含非纯正交矩形的贴角四/五边形屋面，且存在三档明显面积分化（`maxArea / minArea >= 2.6`，小户 `< 85 m²` 与大宅 `> 145 m²` 同时存在），零碰撞。
2. **可见次级巷道渲染**：
   - 含 `walled_city` 或 `town_blocks` 的工程导出 SVG 中，`internalStreets` 非空且在 `layer-lanes-fences`（或道路层）实际绘出 `<path>`。
3. **合院 `courtyard` 与翼深硬上限**：
   - `upsert_structure` 放置 `60m × 48m` 的 `kind: 'courtyard'`，编译后 `yardPolygon`、`wallPolylines` 与 `extraPolygons`（`>= 2` 栋附属厢房）齐全，单栋屋顶短边进深全部 `<= 13.5m`，且民房零侵入大院内部；
   - 放置 `80m × 64m` 的 `u_court` 时，翼楼厚度 `<= 12.5m`，且 `buildSpatialRadar` 给出超尺度单体改用 `courtyard` 的建议告警。
4. **场坪 `'enclosure'` 与导出态 `'plain'` 隐形**：
   - `exclusionStyle: 'plain'` 在 `isExport: true` 的 SVG 中不输出虚线 `<path>`；`exclusionStyle: 'enclosure'` 输出实线围栏与铺地多边形。
5. **多瓣云朵树冠与林地底衬**：
   - 单棵 `r = 5.5m` 的树在 `paintTrees` 中输出多瓣融合路径（圆弧指令段数 `>= 4`），`woodland` 选区输出林下底色多边形且树冠成簇交叠。
6. **全栈回归与行数门禁**：既有 195+ 项测试、`D203_灰山口` 与三套受保护预设全部零穿模、零回归，全 `src/` 单文件严格 `<= 320` 行。
