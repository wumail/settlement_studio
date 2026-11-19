# Settlement Studio V4.0 — AI 语义制图引擎、CLI 与 MCP 技术规格书

| 文档属性 | 规范内容 |
| :--- | :--- |
| **文档版本** | `V4.0`（AI Agent 赋能层） |
| **适用范围** | `/Users/wumail/code/TERRAX/settlement_studio/` |
| **核心定位** | 面向大模型 + Agent 的无头语义制图引擎、视觉自检闭环、CLI 与轻量 MCP 服务 |
| **架构铁律** | **与外部世界观/宿主仓库彻底解耦**：`src/ai/`、`src/cli/`、`src/mcp/` 严禁出现任何特定世界观路径、专有名词、星球参数或私有 `.bin/.npz` 读取逻辑；外部地理数据仅通过通用 `GeoBootstrapPayload` JSON 接入 |

---

## 0. 架构总览与设计目标

现有 `settlement_studio`（V3.2）已经具备无头地形/水系/聚落编译内核（`src/core/`）、零穿模审计（`verifyZeroCollisions`）以及 Canvas/SVG 同源无头渲染器（`src/renderer/SvgStringBackend.ts`）。V4.0 在**不改动现有前端交互与核心算法行为**的前提下，新增面向多模态大模型的无头 AI 赋能层：

```text
External Agent (Antigravity / Claude Code / Codex / Cursor / MCP Client)
        │
        ├── 入口 A（主力·高上限）：src/cli/studioCli.ts   (npm run studio -- <cmd>)
        └── 入口 B（协议·常驻态）：src/mcp/studioMcp.ts   (npm run mcp，6 工具 + 2 资源)
                    │
                    ▼
        ┌──────────────────────────────────────────────────────┐
        │          src/ai/ 无头语义制图引擎（零 DOM 依赖）       │
        ├──────────────────┬──────────────────┬────────────────┤
        │ spatialBrief.ts  │ semanticOps.ts   │ previewRaster  │
        │ 选址雷达 + 诊断   │ + geometrySnap   │ Svg→resvg PNG  │
        │ 空间点查询        │ 水工吸附/相对选区 │ 全图网格/局部裁切│
        └──────────────────┴──────────────────┴────────────────┘
                    │
                    ▼
        既有核心：src/schema/ · src/core/ · src/renderer/SvgStringBackend.ts
```

### 0.1 允许新增的依赖（严格限定以下 3 个包）

1. `@resvg/resvg-js`（`dependencies`）：跨平台 Rust 原生 SVG → PNG 栅格化，用于生成多模态模型可视觉检视的全图与局部特写 PNG（禁止引入 Puppeteer / Playwright / Sharp / Canvas native）。
2. `@modelcontextprotocol/sdk`（`dependencies`）：标准 MCP Server SDK（`StdioServerTransport`）。
3. `tsx`（`devDependencies`）：支持 `npm run studio` 与 `npm run mcp` 直接运行 TypeScript，免额外构建步骤。

### 0.2 硬性工程护栏（与 V3 一致，违者不通过）

1. `src/` 下每一个 `.ts` / `.tsx` 文件物理行数严格 `<= 320` 行（超限必须拆分）。
2. 零 `any`、零 `as any`、零 `@ts-ignore`、零 `TODO` / `FIXME`；`src/core/` 与 `src/ai/` 严禁 `Math.random()`（确定性派生一律复用 `src/core/math/rng.ts` 的 `createRng` / `hashSeed`）。
3. **解耦红线**：`src/ai/`、`src/cli/`、`src/mcp/` 内严禁硬编码任何外部仓库目录（如 `设定/`、`地图/`、`worldbuilding/`、`server.py`）或特定世界观专有名词（如 `TERRAX`、`Losrumura`、`Lōsrūmūra`、`R1966`、`长湖`、`帕隆`）。
4. 工程落盘必须采用同目录临时文件 + 原子 `rename` 替换，并默认保护 3 套基准工程文件（`起点城_Losrumura.worldtown.json`、`长湖_复市镇.worldtown.json`、`帕隆_峡谷铁寨.worldtown.json`），除非显式传 `allowOverwriteProtected: true`。

---

## 1. 模块一：选址雷达与编译诊断（`src/ai/spatialBrief.ts`）

大模型不应吞吐几十 KB 的原始建筑多边形数组，而应读取高信噪比、结构化的空间摘要。

### 1.1 `SpatialBrief` 输出契约

```ts
export interface TerrainGridCell {
  readonly col: number;            // 0..7
  readonly row: number;            // 0..7
  readonly center: readonly [number, number]; // 世界坐标 [x, y] (m)
  readonly meanElevM: number;
  readonly maxSlopeDeg: number;
  readonly waterFraction: number;  // 0..1，采样点落入河/湖占比
  readonly buildability: 'prime' | 'marginal' | 'steep' | 'water';
}

export interface RiverSampleAnchor {
  readonly t: number;              // 0, 0.25, 0.5, 0.75, 1 (长度 > 1800m 时增至 9 点)
  readonly point: readonly [number, number];
  readonly widthM: number;
  readonly tangentDeg: number;
  readonly leftNormal: readonly [number, number];
  readonly rightNormal: readonly [number, number];
}

export interface ZoneDiagnostic {
  readonly id: string;
  readonly name: string;
  readonly contentType: string;
  readonly areaHa: number;
  readonly centroid: readonly [number, number];
  readonly bbox: readonly [number, number, number, number];
  readonly buildingCount: number;
  readonly treeCount: number;
  readonly plotCount: number;      // farmlandPlots + saltpanCells
  readonly meanSlopeDeg: number;
  readonly maxSlopeDeg: number;
  readonly status: 'ok' | 'empty_warning';
  readonly emptyReason?: 'steep_slope' | 'water_overlap' | 'too_small' | 'blocked_by_obstacles';
}

export interface SpatialBrief {
  readonly meta: {
    readonly id: string;
    readonly name: string;
    readonly subtitle: string;
    readonly worldSizeM: number;
  };
  readonly terrain: {
    readonly minElevM: number;
    readonly maxElevM: number;
    readonly contourStepM: number;
    readonly grid8x8: ReadonlyArray<TerrainGridCell>;
  };
  readonly rivers: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly lengthM: number;
    readonly anchors: ReadonlyArray<RiverSampleAnchor>;
  }>;
  readonly waterBodies: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly kind: 'lake' | 'sea';
    readonly centroid: readonly [number, number];
    readonly bbox: readonly [number, number, number, number];
  }>;
  readonly canals: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly style: string;
    readonly widthM: number;
    readonly start: readonly [number, number];
    readonly mid: readonly [number, number];
    readonly end: readonly [number, number];
  }>;
  readonly zones: ReadonlyArray<ZoneDiagnostic>;
  readonly structures: ReadonlyArray<{ id: string; name: string; kind: string; x: number; y: number }>;
  readonly hydraulic: {
    readonly weirs: ReadonlyArray<{ id: string; name: string; mid: readonly [number, number] }>;
    readonly docks: ReadonlyArray<{ id: string; name: string; x: number; y: number; angleDeg: number }>;
    readonly watermills: ReadonlyArray<{ id: string; name: string; x: number; y: number; angleDeg: number }>;
  };
  readonly bridges: ReadonlyArray<{ id: string; x: number; y: number; style: string }>;
  readonly landmarks: ReadonlyArray<{ id: string; label: string; x: number; y: number; badgeNum?: number }>;
  readonly stats: {
    readonly buildingCount: number;
    readonly treeCount: number;
    readonly wallCount: number;
    readonly bridgeCount: number;
    readonly collisionPassed: boolean;
    readonly collisionHits: number;
  };
  readonly warnings: ReadonlyArray<string>;
}
```

### 1.2 核心算法规则

1. **8×8 选址雷达分类**：
   - `waterFraction >= 0.45` → `'water'`
   - 否则 `maxSlopeDeg > 24` → `'steep'`
   - 否则 `maxSlopeDeg <= 14 && waterFraction < 0.1` → `'prime'`
   - 其余 → `'marginal'`
2. **空区归因**：对期望产出内容的选区（非 `exclusion`；`citadel` 若内部已有重叠 `structures` 也算正常），当 `buildingCount + treeCount + plotCount === 0` 时置 `status = 'empty_warning'` 并按主因判断 `emptyReason`（面积 `< 0.08 ha` → `'too_small'`；选区采样点超 50% 落水 → `'water_overlap'`；选区平均坡度 > `zone.maxSlopeDeg` → `'steep_slope'`；其余 → `'blocked_by_obstacles'`），同时写入 `warnings`。
3. **额外告警检测**：
   - 两非嵌套选区（不含 `citadel`/`market`/`exclusion` 内嵌于 `walled_city`/`town_blocks` 的合法情形）质心互落对方多边形内 → `warnings` 提示选区重叠；
   - 任意两地标距离 `< 65m` 且均 `showLabel: true` → `warnings` 提示标注拥挤风险；
   - `collisionReport.passed === false` → `warnings` 列出冲突分类计数。
4. **`querySpatialPoint(project, scene, x, y)`**：返回精确海拔 `elevM`、坡度 `slopeDeg`、是否落入河/湖/禁建圈、最近河道投影（`riverId`, `t`, `distM`, `bank: 'left' | 'right'`, `centerPoint`, `bankPoint`, `tangentDeg`）以及最近水渠投影，供精细微调使用。

---

## 2. 模块二：几何吸附与高层语义操作（`src/ai/geometrySnap.ts` + `src/ai/semanticOps.ts`）

### 2.1 通用外部地理导入契约（`GeoBootstrapPayloadSchema`）

与 `server.py` 的 `/api/geo/bootstrap` 返回结构 100% 兼容，但不依赖 `server.py`：

```ts
export const GeoBootstrapPayloadSchema = z.object({
  elevM: z.number(),
  slopeDirDeg: z.number().default(0),
  slopeMagM: z.number().min(0).default(12),
  query: z.object({
    lon: z.number().optional(),
    lat: z.number().optional(),
    spanM: z.number().min(600).max(8000).optional(),
  }).optional(),
  regionNote: z.string().optional(),
  suggestedRivers: z.array(z.object({
    id: z.string(),
    label: z.string().default(''),
    widthStartM: z.number().min(6).max(600).optional(),
    widthEndM: z.number().min(6).max(600).optional(),
    localPoints: z.array(z.tuple([z.number(), z.number()])).min(2),
  })).default([]),
});
```

### 2.2 几何吸附算子（`src/ai/geometrySnap.ts`）

1. **`samplePolylineAtT(points, t)`**：按累计弧长归一化参数 `t ∈ [0, 1]` 线性插值采样，返回 `{ point, tangent: [tx, ty], leftNormal: [-ty, tx], rightNormal: [ty, -tx], angleDeg, totalLengthM }`。
2. **`sampleRiverWidthAtT(river, t)`**：若 `river.widthsM.length === river.points.length` 按段线性插值实测河宽，否则按 `widthStartM` → `widthEndM` 线性插值。
3. **`computeSnappedWeir(river, t, overhangM = 8)`**：在 `t` 处沿河道法向左右各延伸 `0.5 * widthM + overhangM`，输出 `{ pStart, pEnd }`，确保分水堰严丝合缝横跨两岸。
4. **`computeSnappedDock(project, scene, params)`**：
   - `targetKind === 'river'`：在 `river` 的 `t` 处向 `bank`（`'left' | 'right'`）偏移 `0.5 * widthM - insetM`（默认 `insetM = 2`），朝向角 `angleDeg` 严格指向**河心方向**（即 `-bankNormal`），确保滑道与栈桥伸入水面而非反向插入陆地！
   - `targetKind === 'waterBody'`：沿 `waterBody.points` 闭合环弧长 `t` 采样岸线切向与内法向（用 `pointInPolygon` 判定指向水体内部的方向），返回岸边点与指向湖心的 `angleDeg`。
5. **`computeSnappedWatermill(project, params)`**：在 `river` 或 `canal` 的 `t` 处向 `bank` 偏移 `0.5 * widthM + 0.5 * depthM + bankOffsetM`（默认 `bankOffsetM = 2`），`angleDeg` 平行于水流切向，并自动推导面向水体的 `wheelSide`（除非用户显式指定）。
6. **`buildRelativePolygon(anchorCenter, shape, areaHa, aspectRatio, rotationDeg, seed)`**：
   - 支持 `'rect'`（矩形）、`'octagonal'`（正八边形）、`'polygon_13'`（13 边轻微有机扰动城垣轮廓）、`'organic'`（12 边柔和自然轮廓）；
   - 按精确面积公式归一化缩放，确保生成多边形实际面积与 `areaHa` 误差 `< 2%`，且全部顶点自动夹紧至 `[20, worldSizeM - 20]` 内部。
7. **`resolveAnchorPoint(project, scene, anchor)`**：统一解析以下锚点：
   - 直接坐标 `[x, y]`；
   - 河道岸侧：`{ riverId, t, bank: 'left' | 'right' | 'center', offsetM?: number }`；
   - 选区位置：`{ zoneId, side?: 'center' | 'north' | 'south' | 'east' | 'west', offsetM?: number }`；
   - 水工/地标/建筑：`{ entityId }`；
   - 地图边界：`{ edge: 'north' | 'south' | 'east' | 'west', ratio: number }`（`ratio ∈ [0.05, 0.95]`，用于出城驿道直达图幅边界）。

### 2.3 `AiOp` 语义操作全集（Zod 校验，`src/ai/semanticOps.ts`）

所有操作均具备**幂等 upsert 语义**（同 `id` 覆盖更新，无则新增）：

| `op` 类型 | 核心字段 | 作用 |
| :--- | :--- | :--- |
| `set_meta` | `name?, subtitle?, worldSizeM?, geoAnchor?` | 更新工程标题、副标题、图幅边长与地理锚点（`geoAnchor` 写入现有 `meta.terraxAnchor` 字段） |
| `set_terrain` | `TerrainConfig` 任意子集（不含 `shapes`） | 调整基准高程、坡降、坡向、等高距、不透明度、淡彩/晕滃/噪声开关 |
| `upsert_terrain_shape` | 完整 `TerrainShape`（`hill`/`basin`/`ridge`/`valley`/`scarp`） | 新增或更新地形塑形体 |
| `apply_geo_bootstrap` | `payload: GeoBootstrapPayload, importRivers?: boolean, clearExistingRivers?: boolean` | 注入外部 DEM/坡面与建议河网（解耦接口） |
| `upsert_river` | `id, name?, points, widthStartM?, widthEndM?, widthsM?, carveDepthM?, rippleLines?, zIndex?` | 新增或更新河道 |
| `upsert_water_body` | `id, name?, kind, points, rippleLines?, zIndex?` | 新增或更新湖泊/海湾 |
| `upsert_canal` | `id, name?, style?, points, widthM?, zIndex?` | 新增或更新明渠/暗渠/坎儿井 |
| `snap_weir` | `id, name?, riverId, t, sluices?, widthM?, overhangM?, zIndex?` | 沿河道正交吸附放置分水堰 |
| `snap_dock` | `id, name?, targetId, targetKind?, t, bank?, kind?, slips?, spacingM?, lengthM?, widthM?, insetM?, zIndex?` | 沿河/湖岸吸附放置滑道坞或木栈桥（自动朝向水面） |
| `snap_watermill` | `id, name?, targetId, targetKind?, t, bank?, wheelSide?, widthM?, depthM?, bankOffsetM?, zIndex?` | 沿河/渠岸吸附放置水力工坊（自动贴岸平行水流） |
| `place_zone` | `id, name?, contentType, points?, relative?, seed?, density?, maxSlopeDeg?, streetWidthM?, wallThicknessM?, towerIntervalM?, frayOuter?, marketMode?, exclusionStyle?, zIndex?` | 按显式多边形或相对锚点/面积/形状放置选区 |
| `connect_road` | `id, name?, tier?, widthM?, from: Anchor, to: Anchor, via?: Anchor[], curveOffsetM?, zIndex?` | 连接任意两个锚点（支持选区四向边、水工、边界），自动生成平滑折线道路 |
| `upsert_road` | `id, name?, tier?, widthM?, points, zIndex?` | 显式坐标新增或更新道路 |
| `upsert_structure` | `id, name?, x?, y?, anchor?, angleDeg?, widthM?, depthM?, kind?, roofKind?, zoneId?, zIndex?` | 新增或更新核心建筑/礼制单体（支持 `anchor` 相对定位） |
| `upsert_bridge_override` | `id, x?, y?, bridgeId?, style, widthM?, fortSizeM?, zIndex?` | 按坐标或自动 `bridgeId` 覆写桥型（石拱/木桥/双桥头堡/渡口） |
| `upsert_landmark` | `id, label, x?, y?, anchor?, glyphType?, showLabel?, sizePx?, badgeNum?, subtitle?, zIndex?` | 新增或更新地标与导览编号条目 |
| `scatter_trees` | `anchor, radiusM, count, minR?, maxR?, kind?, seed?` | 在指定区域确定性撒入 `paintedTrees`（用于补足疏林与山坡绿意） |
| `remove_entity` | `collection, id` | 删除指定集合内某实体（支持全部 14 类实体及 `terrain.shapes`） |
| `reroll_zone` | `zoneId, seed?` | 指定或推进单区随机种子（增量重抽） |
| `set_palette` | `themeId?, overrides?` | 切换配色主题或局部覆写色槽 |
| `set_legend` | `visible?, title?, position?, columns?, displayMode?, furnitureOpacity?, labelOpacity?` | 调整图例模式（`standard`/`guided`/`pure`）与半透明度 |

`applySemanticOps(project, ops)` 执行流程：
1. 用 Zod 校验全部 `ops`（任意字段非法即返回明确路径报错，不静默吞错）；
2. 按序应用到工程克隆体（其中 `snap_*`、`connect_road`、依赖既有 `bridgeId` 的操作可按需读取当前几何/编译桥位）；
3. 末尾统一执行 `normalizeProject(next)` + `compileSettlementScene(normalized)`；
4. 返回 `{ project, scene, applied, warnings, brief }`。

---

## 3. 模块三：多模态视觉自检渲染器（`src/ai/previewRaster.ts`）

### 3.1 `renderPreviewPng(project, scene, options)` 契约

```ts
export interface PreviewRenderOptions {
  readonly mode?: 'standard' | 'guided' | 'clean'; // 默认 'standard'
  readonly widthPx?: number;                       // 默认 1400（范围 400..2400）
  readonly gridOverlay?: boolean;                  // 默认 false；AI 审图时传 true 叠加坐标标尺网
  readonly gridStepM?: number;                     // 默认按 worldSizeM 自动选 200m 或 400m
  readonly crop?:
    | { readonly zoneId: string; readonly padM?: number }
    | { readonly entityId: string; readonly radiusM?: number }
    | { readonly bbox: readonly [number, number, number, number] };
}

export interface PreviewRenderResult {
  readonly pngBuffer: Uint8Array;
  readonly svg: string;
  readonly widthPx: number;
  readonly heightPx: number;
  readonly worldBounds: readonly [number, number, number, number]; // [minX, minY, maxX, maxY]
}
```

### 3.2 实现要点

1. **视口构造**：
   - 全图模式：与 `renderSceneToSvgString` 等价，`worldBounds = [0, 0, worldSizeM, worldSizeM]`，图饰（标题牌/指北针/比例尺/图例/导览目录）完整绘入（`mode === 'clean'` 时隐去图饰）。
   - 局部放大模式（`crop`）：解析 `zoneId`（取选区 bbox 外扩 `padM`，默认 `80m`）、`entityId`（取水工/建筑/地标/桥中心外扩 `radiusM`，默认 `220m`）或显式 `bbox`，将其归一化为正方形或匹配画布比例的视口 `ViewportState`（`zoom = widthPx / spanX`，`offsetX = -minX * zoom`，`offsetY = -minY * zoom`），`isExport: true, includeCartouche: false`（特写图不叠大图例，画面 100% 给细节）。
2. **AI 坐标标尺网叠加（仅当 `gridOverlay === true`）**：
   - 在 `paintScene` 之后，于 `SvgStringBackend` 上追加 `<g id="layer-ai-grid">`：
     - 细虚线坐标网（`stroke="#1f4e5f"`, `opacity="0.28"`, `dash=[4, 4]`）；
     - 顶部与左侧半透明数字刻度（如 `400`, `800`, `1200`），让多模态模型可直接读出偏移坐标；
     - 正式出版导出（`export` 命令）严格强制 `gridOverlay: false`。
3. **SVG → PNG 栅格化**：
   - 使用 `@resvg/resvg-js` 的 `new Resvg(svg, { fitTo: { mode: 'width', value: widthPx }, font: { loadSystemFonts: true } }).render().asPng()`。
   - 必须在单元测试中验证 PNG 文件头魔数（`89 50 4E 47 0D 0A 1A 0A`）与非空字节数（`> 5000` bytes）。

---

## 4. 模块四：共享会话层、CLI 与 6 工具轻量 MCP

### 4.1 共享会话管理（`src/ai/session.ts`）

- `StudioSession` 维护内存中当前 `project: TownProject`、`scene: CompiledScene`、`sourcePath: string | null` 与最多 20 步 `history: TownProject[]`（支持撤销）。
- `saveProjectAtomic(filePath, project, options?: { allowOverwriteProtected?: boolean })`：
  - 校验受保护基准文件名集合（`PROTECTED_FILENAMES`），默认拒绝误覆盖；
  - 同目录写 `.tmp` 后 `fs.renameSync` 原子替换。

### 4.2 终端 CLI（`src/cli/studioCli.ts` + `package.json` `"studio": "tsx src/cli/studioCli.ts"`）

所有子命令统一输出单行或多行**合法 JSON 到 stdout**（错误信息输出 `{ "ok": false, "error": "..." }` 并以退出码 `1` 退出），严禁向 stdout 混打调试日志：

1. `npm run studio -- init --out <path> [--preset blank|losrumura|changhu|palong] [--world-size 2400] [--name "..."] [--subtitle "..."] [--geo-file <geo.json>]`
2. `npm run studio -- inspect <path>`
3. `npm run studio -- query <path> --x <num> --y <num>`
4. `npm run studio -- apply <path> --ops <ops.json|-> [--out <path>] [--allow-overwrite-protected]`（支持 `--ops -` 从 stdin 读 JSON；ops 文件支持数组 `[...]` 或 `{ "ops": [...] }` 两种写法）
5. `npm run studio -- render <path> --out <preview.png> [--svg-out <preview.svg>] [--mode standard|guided|clean] [--width 1400] [--grid] [--crop-zone <id>] [--crop-entity <id>] [--crop-bbox x0,y0,x1,y1]`
6. `npm run studio -- export <path> --out-svg <out.svg> [--out-png <out.png>] [--mode standard|guided|clean] [--width 2000]`（强制无 AI 网格）

### 4.3 轻量 MCP Server（`src/mcp/studioMcp.ts` + `package.json` `"mcp": "tsx src/mcp/studioMcp.ts"`）

使用 `@modelcontextprotocol/sdk` 的 `McpServer` + `StdioServerTransport`，保持单一会话实例，只暴露 **6 个高内聚工具** + **2 个只读资源**：

| 工具名 | 参数 | 返回 |
| :--- | :--- | :--- |
| `studio_open` | `{ path?, preset?, worldSizeM?, name?, subtitle?, geoBootstrap? }` | JSON `SpatialBrief` |
| `studio_inspect` | `{}` | JSON `SpatialBrief` |
| `studio_query_point` | `{ x, y }` | JSON `SpatialPointQuery` |
| `studio_apply_ops` | `{ ops: AiOp[] }` | JSON `{ applied, warnings, brief }` |
| `studio_render_preview` | `{ mode?, widthPx?, gridOverlay?, crop? }` | `text`（视口元数据与摘要）+ **`image`（`image/png` base64）** |
| `studio_save` | `{ path?, allowOverwriteProtected?, exportSvgPath?, exportPngPath?, exportMode? }` | JSON `{ savedPath, bytes, exported? }` |

只读 MCP Resources：
- `studio://schema/ops`：精简版 `AiOp` 语法说明与示例 JSON；
- `studio://examples/presets`：内置预设的尺度、选区与密度指标摘要（供模型参考构图尺度）。

---

## 5. 验收测试矩阵（`tests/ai-engine-and-mcp.test.ts`）

必须全部通过且纳入 `npm run check`：

1. **选址雷达与诊断**：
   - `losrumura` 产出 64 格 `grid8x8`（含 `prime` / `steep` / `water` 分类）、河道采样点与 21 区诊断；
   - 故意在 `35°` 陡坡上建 `town_blocks` 选区时，`buildSpatialRadar` 必须给出 `status: 'empty_warning'` 且 `emptyReason: 'steep_slope'`。
2. **几何吸附精度**：
   - `snap_weir` 两端点分别落在河道左右岸外侧，中点距河心 `< 2m`，连线与河道切向夹角在 `85°–95°`；
   - `snap_dock` 位于岸边且法向严格指向河心 / 湖心（前移 10m 必落入水体多边形内）；
   - `snap_watermill` 贴岸平行水流且不压入水体；
   - `place_zone` 相对定位生成 `polygon_13` / `organic` / `rect` 的实际面积与目标 `areaHa` 误差 `< 5%`；
   - `connect_road` 正确连通选区边与图幅边界。
3. **通用地理导入**：`apply_geo_bootstrap` 导入标准 `GeoBootstrapPayload` 后正确更新 `baseElev`/`slopeDirDeg`/`slopeMagM`/`worldSizeM` 与建议河道。
4. **视觉栅格化（全图 + AI 网格 + 局部放大）**：
   - `renderPreviewPng` 输出有效 PNG（魔数正确且 `> 5000` bytes）；
   - `gridOverlay: true` 时 SVG 包含 `layer-ai-grid`，`gridOverlay: false` 时不含；
   - `crop: { zoneId }` 产出的 `worldBounds` 严格收缩至目标选区附近，且不含 `图例`。
5. **CLI 端到端闭环**：用子进程依次执行 `init → apply → inspect → render → export`，零报错退出且产物文件合法；尝试覆写受保护基准工程默认返回非 0 退出码。
6. **MCP 工具与资源注册**：实例化 MCP Server（或通过内存传输）验证 6 工具 + 2 资源完整注册，且 `studio_render_preview` 返回 `image/png` content block。
7. **解耦静态守卫**：扫描 `src/ai/`、`src/cli/`、`src/mcp/` 全部源码，断言**零出现** `设定/`、`地图/`、`worldbuilding`、`Losrumura`、`Lōsrūmūra`、`长湖`、`帕隆`、`server.py`、`Math.random(`（注意：已有 `MetaSchema` 的兼容字段 `terraxAnchor` 仅在映射 `geoAnchor` 处可读取，业务词与外部路径零耦合）。
