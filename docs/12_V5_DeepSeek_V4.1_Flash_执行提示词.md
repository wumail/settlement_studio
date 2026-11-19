# Settlement Studio V5.0 — DeepSeek V4.1 Flash 专用执行提示词

| 文档属性 | 规范内容 |
| :--- | :--- |
| **适配模型** | `deepseek v4.1 flash`（兼容单轮全自动 `/goal` 模式、两棒接力模式与断点续跑返修模式） |
| **工作目录** | `/Users/jrdamocles/code/TERRAX/settlement_studio/` |
| **上游规格与账本** | [10_V5_全幅等高线_自然条田与真实比例尺升级规格书.md](10_V5_全幅等高线_自然条田与真实比例尺升级规格书.md) · [11_V5_执行对照计划表与视觉验收矩阵.md](11_V5_执行对照计划表与视觉验收矩阵.md) |
| **核心铁律** | `src/` 全文件严格 `<= 320` 行（`marchingSquares.ts` 严禁膨胀） · `terrainNoiseAmpM: 0` 保护旧解析单测 · 彻底弃用 Voronoi 条田 · `src/ai` / `src/cli` / `src/mcp` / `.agents/skills` 零世界观解耦 · 3 套受保护预设零改动 |

---

## 第 1 章 投喂策略与六条 V5 专属防呆护栏

### 1.1 三套投喂方案选型对比表

| 评估维度 | 方案一：单轮全自动通关总提示词（第 2 章） | 方案二：分两棒高稳健接力提示词（第 3 章） | 方案三：中断续跑 / 审查返修提示词（第 4 章） |
| :--- | :--- | :--- | :--- |
| **适用场景** | 长程自主编码会话或 `/goal` 全自动模式，一次性无人值守通关 | **首选推荐**：标准对话 Agent 模式，在两棒之间可人工核验测试并直观看图 | 会话因上下文或网络中断，或人工审图/独立审查发现局部问题需定向返修 |
| **覆盖范围** | `V5-M1 -> V5-M2 -> V5-M3`（`T-5.01` — `T-5.16`，全部 `16` 项） | **第一棒**：`V5-M1 + V5-M2`（`T-5.01` — `T-5.11`，引擎/渲染/UI/Skill）<br>**第二棒**：`V5-M3`（`T-5.12` — `T-5.16`，专项测试/重制 `D2-03`/导出审图/收口） | 从 `11_V5` 首个 `[ ] 待执行` 断点续跑，或仅针对问题单做最小化闭环修复 |
| **风险控制** | 每阶段自动执行 `npm run check` 并即时回填 `11_V5` 账本 | 引擎代码改造与实图重制彻底解耦，防止长上下文遗忘约束或混改预设 | 最小改动面 + 补写回归断言 + 全量复检，避免修一处坏一片 |

### 1.2 六条 V5 专属防呆护栏（全部提示词强制内嵌，一票否决）

1. **护栏 ①（`marchingSquares.ts` 已满 `320` 行禁膨胀与全仓微模块红线）**：
   - `src/core/terrain/marchingSquares.ts` 当前恰好 `320 / 320` 行，绝不可再向其塞入间曲线提取逻辑。缓坡间曲线必须新建微模块 `src/core/terrain/supplementaryContours.ts`（`<= 200` 行）并在 `compilePipeline.ts`（新增 `extractSceneContours`）与 `compileScene.ts` 挂载；自然条田切分算法必须新建 `src/core/generators/farmlandStrips.ts`（`<= 240` 行）并保持 `src/core/generators/farmland.ts <= 200` 行；`src/ai/opSchemas.ts` 与 `src/ai/opProjectHandlers.ts` 当前均已 `308` 行，新增字段与透传后必须严控 `<= 320` 行（接近上限前须拆出辅助模块）。
   - `src/` 下全部 `.ts/.tsx` 物理行数严格 `<= 320` 行；零 `any / as any / @ts-ignore / TODO / FIXME`；`src/core/` 与 `src/ai/` 严禁出现 `Math.random()`（统一复用 `src/core/math/rng.ts` 的 `createRng` / `hashSeed`）。
2. **护栏 ②（`terrainNoiseAmpM === 0` 保护旧解析单测与默认零破坏）**：
   - 既有地形测试依赖纯斜坡/纯河床的精确解析高程值。必须在 `terrainNoise.ts` 导出 `resolveMacroReliefAmp(terrain)` 与 `resolveValleyCarveRatio(terrain)`：当新字段未显式传入且 `terrain.terrainNoiseAmpM <= 1e-9` 时自动返回 `0`（仅当微地形噪声开启时分别默认 `12` m 与 `5.5`）；同时 `terrainPrimitives.ts` 的 `createRiverCarver(river, valleyRatio = 0)` 与 `evalRiverCarve` 保持默认 `valleyRatio = 0`，确保既有 `196` 条测试用例 100% 零退化。
3. **护栏 ③（`farmland.ts` 彻底弃用 Voronoi 且必须硬避路水陡坡禁建区）**：
   - 严禁在旧 Voronoi 实现上打补丁。`src/core/generators/farmland.ts` 必须彻底删除 `computeVoronoiCells` 导入与调用，切换至 `farmlandStrips.ts` 的 OBB 递归条带切分（长宽比 `1.6:1 ~ 3.8:1`、单块 `0.28 ~ 0.65 ha`、`±4° ~ 8°` 微斜偏角、`frayOuter` 参差外缘、独立长边耕垄与 4 阶 `toneShift`）。
   - 每块条田必须经 `sampleObstacleClearance`、`polygonTouchesExclusion`、`sampleSlopeDeg <= zone.maxSlopeDeg` 严格校验（对轻微擦边条田做一次安全内缩挽救），绝不允许任何农田绘制到公路、河湖、明渠、城墙或禁建圈上；树木改为沿共享田埂成簇生成 `2—5` 棵树篱簇（经 `guardSafeTree`）。
4. **护栏 ④（`src/ai/`、`src/cli/`、`src/mcp/` 与 `.agents/skills/` 零世界观解耦红线）**：
   - 上述四个目录内严禁出现任何特定世界观专有名词、星球参数、外部仓库路径或私有脚本名（包括 `设定/`、`地图/`、`worldbuilding`、`TERRAX`、`Losrumura`、`Lōsrūmūra`、`R1966`、`长湖`、`帕隆`、`灰山口`、`囚禁魔`、`server.py`）。`spatialAnalyze.ts` 新增的超大农田（`> 35 ha`）与尺度告警以及 Skill 比例尺规范必须 100% 采用通用制图术语。
5. **护栏 ⑤（3 套受保护基准预设与历史归档零改动）**：
   - 严禁修改 `projects/起点城_Losrumura.worldtown.json`、`projects/长湖_复市镇.worldtown.json`、`projects/帕隆_峡谷铁寨.worldtown.json`（受 `PROTECTED_FILENAMES` 保护，严禁使用 `--allow-overwrite-protected` 篡改）；严禁修改 `legacy_v1_js/`、`docs/01_*`—`docs/09_*`、`docs/10_V5*`、`docs/12_V5*` 以及 `/Users/jrdamocles/code/TERRAX/settlement_studio/` 以外的任何路径。`V5-M3` 仅重制 `projects/D203_灰山口与囚禁魔营地.worldtown.json` 并导出至 `exports/`。
6. **护栏 ⑥（逐阶段跑通 `npm run check`、先测后勾与双尺度视觉闭环）**：
   - 每完成一个阶段（`V5-M1`、`V5-M2`、`V5-M3`），必须实跑 `npm run check`（`tsc --noEmit` + `biome lint src tests` 0 错 0 警 + 全量 Vitest）及 `src/` 行数扫描，确认退出码严格为 `0` 后再回填 `docs/11_V5_执行对照计划表与视觉验收矩阵.md` 的 `[x] 已完成` 状态与三要素（路径行数 + 关键实现 + 实测数据）。终验前必须跑通 `npm run build` 并对 `D2-03` 导出的导览版/标准版全图与局部特写逐项视觉自检。

---

## 第 2 章 方案一：【单轮全自动通关总提示词（V5.0 Master Prompt）】

适用场景：开启长程自主 Agent 或 `/goal` 模式时，整段复制下方代码块直接投喂，一次性串行闭环 `V5-M1 -> V5-M2 -> V5-M3` 全部 `16` 项任务与八道硬门禁。

```text
你是负责实施 Settlement Studio V5.0（全幅连续等高线 · Watabou 自然条田 · 真实人类比例尺校准）的首席图形算法与地图学工程师。
工作目录严格限定为：/Users/jrdamocles/code/TERRAX/settlement_studio/

请严格按 V5-M1 -> V5-M2 -> V5-M3 顺序完成全部 16 项原子任务（T-5.01 至 T-5.16），并逐阶段实测回填执行对照计划表，直至八道硬门禁（V5-BG-01 至 V5-BG-08）全部退出码为 0。

【一、开工必读（写任何代码前必须先完整读取）】
1. /Users/jrdamocles/code/TERRAX/settlement_studio/docs/10_V5_全幅等高线_自然条田与真实比例尺升级规格书.md
2. /Users/jrdamocles/code/TERRAX/settlement_studio/docs/11_V5_执行对照计划表与视觉验收矩阵.md
3. 按需查阅涉及修改的既有源码：
   - src/schema/{entity.schema,scene.types}.ts
   - src/core/terrain/{terrainNoise,terrainPrimitives,elevationField,marchingSquares}.ts
   - src/core/{compileScene,compilePipeline,compileSupport}.ts
   - src/core/generators/{farmland,townBlocks,village}.ts
   - src/renderer/{paintScene,paintLand}.ts
   - src/ui/inspector/{TerrainPanel,ZonePanel}.tsx
   - src/ai/{opSchemas,opProjectHandlers,spatialAnalyze}.ts
   - .agents/skills/settlement-studio-mapper/references/{cartography-standards,ops-cheatsheet}.md

【二、六条一票否决硬性防呆护栏（全程生效，门禁 ID 严格对齐 10_V5 第 0.5 节）】
1. 行数与静态安全硬红线（V5-BG-07）：
   - src/ 下全部 .ts/.tsx 文件物理行数严格 <= 320 行；
   - src/core/terrain/marchingSquares.ts 已满 320 行，严禁向其追加间曲线实现逻辑，必须新建 src/core/terrain/supplementaryContours.ts（<= 200 行）；
   - 新建 src/core/generators/farmlandStrips.ts（<= 240 行），重构后的 src/core/generators/farmland.ts 保持 <= 200 行；
   - src/ai/opSchemas.ts 与 src/ai/opProjectHandlers.ts 均已 308 行，新增字段与透传后必须严控 <= 320 行（超限前拆出辅助文件）；
   - 零 any / as any / @ts-ignore / TODO / FIXME；src/core/ 与 src/ai/ 严禁调用 Math.random()，统一用 src/core/math/rng.ts 的 createRng / hashSeed。
2. 纯解析单测零破坏保护（V5-BG-01）：
   - terrainNoise.ts 导出 resolveMacroReliefAmp(terrain) 与 resolveValleyCarveRatio(terrain)：显式字段优先，否则若 terrain.terrainNoiseAmpM <= 1e-9 返回 0（100% 保护既有纯斜坡解析单测与既有 196 条测试用例），否则默认分别返回 12 与 5.5；
   - terrainPrimitives.ts 的 createRiverCarver(river, valleyRatio = 0) 与 evalRiverCarve 保持默认 valleyRatio = 0。
3. 农田彻底弃用 Voronoi 且必须硬避路水（V5-BG-04）：
   - src/core/generators/farmland.ts 严禁保留或调用 computeVoronoiCells；
   - 每块条田必须经 sampleObstacleClearance、polygonTouchesExclusion 与 sampleSlopeDeg <= zone.maxSlopeDeg 硬避让河湖、道路、明渠、城墙、陡坡与禁建圈（擦边允许做一次安全内缩挽救），绝不压路压水。
4. 零世界观解耦红线（V5-BG-07）：
   - src/ai/、src/cli/、src/mcp/ 与 .agents/skills/ 内严禁出现 设定/、地图/、worldbuilding、TERRAX、Losrumura、Lōsrūmūra、R1966、长湖、帕隆、灰山口、囚禁魔、server.py 等任何外部仓库路径或世界观专有名词。
5. 受保护资产零改动（V5-BG-08）：
   - 严禁修改 projects/起点城_Losrumura.worldtown.json、projects/长湖_复市镇.worldtown.json、projects/帕隆_峡谷铁寨.worldtown.json，严禁修改 legacy_v1_js/、docs/01_*~09_*、docs/10_V5*、docs/12_V5* 及工作目录外任何文件。
6. 先测后勾即时回填：
   - 每完成一个里程碑（V5-M1 / V5-M2 / V5-M3），立即运行 npm run check（tsc + biome 0 错 0 警 + 全量 Vitest）及行数扫描，退出码为 0 后立即回填 docs/11_V5_执行对照计划表与视觉验收矩阵.md（三要素 + 顶部进度 + 阶段日志）。

【三、分阶段原子任务清单（T-5.01 ~ T-5.16）】

=== 阶段 V5-M1：全幅连续等高线与缓坡间曲线（T-5.01 ~ T-5.05）===
- T-5.01：在 src/schema/entity.schema.ts 的 TerrainConfigSchema 增量扩展 4 项字段：
  * macroReliefAmpM: z.number().min(0).max(60).optional()
  * valleyCarveRatio: z.number().min(0).max(12).optional()
  * showSupplementaryContours: z.boolean().default(true)
  * supplementaryMaxSlopeDeg: z.number().min(1).max(20).default(6.5)
  在 src/schema/scene.types.ts 与 src/core/terrain/marchingSquares.ts 的 ContourLine 增加 readonly isSupplementary?: boolean;（严守 marchingSquares.ts <= 320 行）。
- T-5.02：在 src/core/terrain/terrainNoise.ts 导出 createMacroReliefEvaluator(ampM, worldSizeM, seed)（波长 0.48 * worldSizeM 权重 1.0 + 0.23 * worldSizeM 权重 0.45，叠加温和 domain warp 消除网格感，平原坡度 < 2°），以及 resolveMacroReliefAmp(terrain) 与 resolveValleyCarveRatio(terrain)。
- T-5.03：在 src/core/terrain/terrainPrimitives.ts 升级 createRiverCarver(river, valleyRatio = 0)，在 2.2 * halfW 窄河床下切外叠加宽 Math.max(carveRadius * 2.5, valleyRatio * 2 * halfW)、深 Math.min(10, 0.55 * carveDepthM) 的平滑宽河谷汇水微坡（evalRiverCarve 维持默认 valleyRatio = 0）；在 src/core/terrain/elevationField.ts 合成宏观起伏与宽河谷下切。
- T-5.04：新建 src/core/terrain/supplementaryContours.ts（<= 200 行），导出 extractSupplementaryContours(field, terrain): ContourLine[]，在 showContours && showSupplementaryContours 为真时对半距层 level = k * step + 0.5 * step 追踪等值线并按 sampleSlopeDeg(field, x, y) <= terrain.supplementaryMaxSlopeDeg 裁切保留 >= 3 点缓坡连续段（isSupplementary: true），陡山自动隐退；在 src/core/compilePipeline.ts 新增导出 extractSceneContours(field, terrain) 返回 { baseContours, contours }，并在 src/core/compileScene.ts（全量与单区重抽路径）中仅将 baseContours 传给 extractScarpTicks 与 buildTerrainShading（防止 3.5°-6.5° 间曲线重复生成晕滃），合并后的 contours 存入 scene.terrain.contours。
- T-5.05：升级 src/renderer/paintScene.ts（paintContours）——contour.isSupplementary 用细淡虚线（lineWidth: 0.55, dash: [5, 4], opacity: opacity * 0.52）、不打高程字、同样裁断河湖水面；并将高程标字阈值改为按主线计数判定（const primaryCount = data.terrain.contours.filter((c) => !c.isSupplementary).length; const showLabels = withLabels && primaryCount <= 90），防止间曲线导致计曲线高程字全部消失；在 src/ui/inspector/TerrainPanel.tsx 补齐 4 项新控件；核验 src/core/compileScene.ts / compileSupport.ts 的 terrainSignature 完整纳入 4 项新字段。
-> 完成 V5-M1 后立刻跑 npm run check + 行数检查，全绿后回填 11_V5 的 T-5.01 ~ T-5.05。

=== 阶段 V5-M2：Watabou 自然条田与真实比例尺校准（T-5.06 ~ T-5.11）===
- T-5.06：在 src/schema/scene.types.ts 的 FarmlandPlot 新增 readonly toneShift?: number;；在 src/schema/entity.schema.ts 的 ZoneSchema 与 src/ai/opSchemas.ts（现 308 行）的 PlaceZone 新增 buildingScale: z.number().min(0.45).max(1.6).optional()（set_terrain 自动派生含 V5 4 项地形新字段）；同步更新 src/ai/opProjectHandlers.ts（现 308 行）在 placeZone 新建选区时显式透传 buildingScale: op.buildingScale（防止新建迷你营地静默丢失 buildingScale），且 opSchemas.ts 与 opProjectHandlers.ts 改后均严控 <= 320 行；在 src/ui/inspector/ZonePanel.tsx 补建筑尺度滑块。
- T-5.07：新建 src/core/generators/farmlandStrips.ts（<= 240 行），实现 subdivideFarmlandStrips：OBB 递归切分长宽比 1.6:1 ~ 3.8:1、单块 0.28 ~ 0.65 ha（宽 32 ~ 75 m）的自然条田，优先对齐临近干道/水渠切向（否则按等高线切向 + 确定性偏角），每次切分加 +-4° ~ 8° 微斜偏角破棋盘感；frayOuter !== false 时对外缘边块按确定性概率退缩或跳格；每块田按最长边（80% 平行 / 20% 垂直）独立计算 angleDeg、5.5 ~ 7.5 m 耕垄与 4 阶 toneShift ∈ [-1, 1]。
- T-5.08：重构 src/core/generators/farmland.ts（<= 200 行），彻底弃用 computeVoronoiCells，接入 subdivideFarmlandStrips；逐块用 sampleObstacleClearance、polygonTouchesExclusion、sampleSlopeDeg <= zone.maxSlopeDeg 硬避让河湖、道路、明渠、城墙、陡坡与禁建圈（轻微擦边做一次安全内缩挽救）；沿共享田埂边界成簇生成 2-5 棵紧密树篱簇（经 guardSafeTree 守卫）。
- T-5.09：升级 src/renderer/paintLand.ts（paintFarmland），按 toneShift 将 pal.farmlandFill 与 pal.paperBg / pal.roofTown / pal.treeFill 做 10%-22% 柔和四阶混色，绘极浅田埂与柔和耕垄。
- T-5.10：校准 src/core/generators/townBlocks.ts（屋宇面宽 9.5-17.5 m、进深 8.0-14.5 m，乘 scale = zone.buildingScale ?? 1，targetCellM2 = (1250 + (1 - zone.density) * 1150) * scale * scale，MAX_EDGE_ROWS = 9，18-24 ha 边镇 walled_city 产出 240-520 栋细密屋宇、典型 280-480 栋、单屋均面积 80-260 m²，单区重抽实机目标 < 80 ms）与 src/core/generators/village.ts（areaHa < 1.5 或 buildingScale < 0.85 时启用紧凑营地参数：屋长 6.5-10.5 m、屋宽 4.5-6.8 m、步距 11-18 m、小篱院或无篱院、支持环空地紧凑排屋，使 0.4-0.8 ha 营地稳定产出 6-14 栋真实木屋）。
- T-5.11：升级 src/ai/spatialAnalyze.ts（新增通用比例健康告警，如单块 farmland > 35 ha 建议拆成多片沿河/沿路中小型条田带、超迷你区比例提醒，严禁世界观名词）；更新 .agents/skills/settlement-studio-mapper/references/{cartography-standards.md,ops-cheatsheet.md}，补齐跨要素真实比例尺红线表与 V5 参数速查。
-> 完成 V5-M2 后立刻跑 npm run check + 行数检查，全绿后回填 11_V5 的 T-5.06 ~ T-5.11。

=== 阶段 V5-M3：全量测试、重制 D2-03 实图导出与终验收官（T-5.12 ~ T-5.16）===
- T-5.12：新建 tests/v5-realism-and-scale.test.ts，完整覆盖规格书第 4.1 节 T1-T8 必填断言：terrainNoiseAmpM: 0 纯解析保护（T1）、全幅平原等高线 4 象限覆盖与 < 2° 宏观坡度及宽河谷汇水微凹（T2）、间曲线缓坡过滤/陡山隐退/SVG 细虚线与裁水（T3）、非 Voronoi 条田多角度/4 阶色差/硬避路水陡坡禁建圈（T4）、20 ha walled_city 产出 240-520 栋（均面积 80-260 m²）且单区重抽单测稳健门禁 < 250 ms（实机目标 < 80 ms）（T5）、迷你营地 0.55 ha 产出 6-14 栋小尺度木屋（T6）、AI 超大农田比例告警与 src/ai + src/cli + src/mcp + .agents/skills 零世界观解耦静态守卫（T7）、三套预设零回归与 D2-03 硬指标（T8）。
- T-5.13：运行 npm run check（tsc + biome 0 错 0 警 + 全量 Vitest，含既有 196 条测试用例零退化）与 npm run build；扫描全仓 src/**/*.ts(x) 确认最大行数 <= 320（含 marchingSquares.ts / opSchemas.ts / opProjectHandlers.ts）且 3 套受保护预设零变更。
- T-5.14：使用新版 npm run studio CLI 按真实人类比例重制 projects/D203_灰山口与囚禁魔营地.worldtown.json：
  * 15 人猎人营地压缩至 ~0.4-0.7 ha（含 ~0.18 ha 环石空地符号与真实小尺度木屋）；
  * 灰山口边镇 ~20 ha 产出 >= 260 栋细密屋宇；
  * 开启全幅长波起伏 + 宽河谷微凹 + 缓坡间曲线；
  * 自然条田拆分为多片中小型条田带沿河谷舒展，严格避路避水；
  * 运行 npm run studio -- inspect 确认 collisionHits === 0、零空区、零 warnings。
- T-5.15：运行 npm run studio -- export 导出 exports/D203_灰山口与囚禁魔营地_导览版.{png,svg} 与 exports/D203_灰山口与囚禁魔营地_标准版.{png,svg}；再运行 npm run studio -- render --crop-zone 生成边镇、迷你营地、条田交界、河谷等高线局部特写图（自检完清理临时特写文件），逐项完成 11_V5 第 4.2 节双尺度视觉自检；如发现任何视觉瑕疵立即用 npm run studio 微调并重新导出直至全项合格。
- T-5.16：完整回填 docs/11_V5_执行对照计划表与视觉验收矩阵.md（16 / 16 项已完成 + 三要素 + 阶段日志 + 八道硬门禁实测 + 双尺度视觉自检表），再次跑一遍 npm run check && npm run build 确认最终退出码为 0。

完成后输出简洁的 V5.0 终验报告（含测试断言数、最大单文件行数、D2-03 重制实测指标与导出文件路径）。
```

---

## 第 3 章 方案二：【分两棒高稳健接力提示词（2-Stage Relay Prompts）】

> **推荐用法**：先在新会话投喂 **第一棒** 完成全部引擎代码与静态门禁；确认 `11_V5` 进度推进到 `11 / 16` 且 `npm run check` 全绿后，再开新会话投喂 **第二棒** 完成专项测试、`D2-03` 真实比例重制、双版导出与双尺度视觉验收。

### 3.1 第一棒：`V5-M1 + V5-M2` 引擎内核、渲染、UI 与 Skill 升级（`T-5.01` — `T-5.11`）

```text
你是负责实施 Settlement Studio V5.0 的首席 TypeScript 图形算法与地图学工程师。
当前执行【V5.0 两棒接力 · 第一棒（V5-M1 + V5-M2：任务 T-5.01 至 T-5.11，共 11 项，暂不写 V5 专项单测与重制 D2-03 工程）】。
工作目录严格限定为：/Users/jrdamocles/code/TERRAX/settlement_studio/

【一、开工必读】
写任何代码前，请先完整读取：
1. /Users/jrdamocles/code/TERRAX/settlement_studio/docs/10_V5_全幅等高线_自然条田与真实比例尺升级规格书.md（重点精读第 0、1、2、3 章）
2. /Users/jrdamocles/code/TERRAX/settlement_studio/docs/11_V5_执行对照计划表与视觉验收矩阵.md
3. 核对目标源码：
   - src/schema/{entity.schema,scene.types}.ts
   - src/core/terrain/{terrainNoise,terrainPrimitives,elevationField,marchingSquares}.ts
   - src/core/{compileScene,compilePipeline,compileSupport}.ts
   - src/core/generators/{farmland,townBlocks,village}.ts
   - src/renderer/{paintScene,paintLand}.ts
   - src/ui/inspector/{TerrainPanel,ZonePanel}.tsx
   - src/ai/{opSchemas,opProjectHandlers,spatialAnalyze}.ts
   - .agents/skills/settlement-studio-mapper/references/{cartography-standards,ops-cheatsheet}.md

【二、本棒交付目标（T-5.01 ~ T-5.11）】
阶段 V5-M1（全幅连续等高线与缓坡间曲线，T-5.01 ~ T-5.05）：
1. T-5.01：在 entity.schema.ts 的 TerrainConfigSchema 增量添加 macroReliefAmpM（0..60 optional）、valleyCarveRatio（0..12 optional）、showSupplementaryContours（default true）、supplementaryMaxSlopeDeg（1..20 default 6.5）；在 scene.types.ts 与 marchingSquares.ts 的 ContourLine 添加 readonly isSupplementary?: boolean;（严守 marchingSquares.ts <= 320 行）。
2. T-5.02：在 terrainNoise.ts 导出 createMacroReliefEvaluator(ampM, worldSizeM, seed)（0.48 * worldSizeM 权重 1.0 + 0.23 * worldSizeM 权重 0.45 两档长波 + 温和 domain warp，保持平原坡度 < 2°），以及 resolveMacroReliefAmp(terrain)（未显式设置且 terrainNoiseAmpM <= 1e-9 返回 0，否则默认 12）与 resolveValleyCarveRatio(terrain)（同理保护归 0，否则默认 5.5）。
3. T-5.03：升级 terrainPrimitives.ts 的 createRiverCarver(river, valleyRatio = 0)，叠加宽 Math.max(carveRadius * 2.5, valleyRatio * 2 * halfW)、深 Math.min(10, 0.55 * carveDepthM) 的平滑河谷汇水微坡（evalRiverCarve 保持默认 valleyRatio = 0）；在 elevationField.ts 合成长波起伏与宽河谷微凹。
4. T-5.04：新建 src/core/terrain/supplementaryContours.ts（<= 200 行），实现 extractSupplementaryContours(field, terrain): ContourLine[]，提取半距层 level = k * step + 0.5 * step 并按 sampleSlopeDeg(field, x, y) <= terrain.supplementaryMaxSlopeDeg 裁切保留 >= 3 点缓坡连续段（标记 isSupplementary: true），陡山自动隐退；在 compilePipeline.ts 新增导出 extractSceneContours(field, terrain) 返回 { baseContours, contours }，并在 compileScene.ts（全量与单区重抽路径）仅将 baseContours 传给 extractScarpTicks 与 buildTerrainShading（防止 3.5°-6.5° 间曲线重复生成晕滃），合并后的 contours 存入 scene.terrain.contours。
5. T-5.05：升级 paintScene.ts（paintContours）用细淡虚线（lineWidth: 0.55, dash: [5, 4], opacity: opacity * 0.52）绘制间曲线、不打高程字且裁断河湖水面，同时将 showLabels 改为按主线计数判定（const primaryCount = data.terrain.contours.filter((c) => !c.isSupplementary).length; const showLabels = withLabels && primaryCount <= 90），防止间曲线导致计曲线高程字全部消失；TerrainPanel.tsx 补 4 项新控件；确认 compileScene.ts / compileSupport.ts 的 terrainSignature 纳入这 4 项新字段。
-> 完成 V5-M1 后立刻实跑 npm run check，确认既有 196 条测试用例 100% 通过后先回填 11_V5 的 T-5.01 ~ T-5.05。

阶段 V5-M2（Watabou 自然条田与真实比例尺校准，T-5.06 ~ T-5.11）：
6. T-5.06：在 scene.types.ts 的 FarmlandPlot 增加 readonly toneShift?: number;；在 entity.schema.ts 的 ZoneSchema 与 src/ai/opSchemas.ts（现 308 行）的 PlaceZone 增加 buildingScale: z.number().min(0.45).max(1.6).optional()（set_terrain 自动派生含 V5 4 项地形新字段）；同步更新 src/ai/opProjectHandlers.ts（现 308 行）在 placeZone 新建选区时显式透传 buildingScale: op.buildingScale（防止新建迷你营地静默丢失 buildingScale），且 opSchemas.ts 与 opProjectHandlers.ts 改后均严控 <= 320 行；在 ZonePanel.tsx 补建筑尺度滑块。
7. T-5.07：新建 src/core/generators/farmlandStrips.ts（<= 240 行），实现 subdivideFarmlandStrips OBB 递归条带切分（对齐临路/水渠或等高线切向、长宽比 1.6:1 ~ 3.8:1、单块 0.28 ~ 0.65 ha、宽 32 ~ 75 m、每次切分附加 +-4° ~ 8° 微斜偏角、frayOuter !== false 参差外缘、每块田按最长边 80% 平行 / 20% 垂直计算 angleDeg 与 5.5 ~ 7.5 m 耕垄、派生 4 阶 toneShift ∈ [-1, 1]）。
8. T-5.08：重构 src/core/generators/farmland.ts（<= 200 行），彻底弃用 computeVoronoiCells，接入 subdivideFarmlandStrips；逐块以 sampleObstacleClearance、polygonTouchesExclusion、sampleSlopeDeg <= zone.maxSlopeDeg 硬避让河湖、道路、明渠、城墙、陡坡与禁建圈（轻微擦边做一次安全内缩挽救）；沿共享田埂成簇生成 2-5 棵紧密树篱簇（经 guardSafeTree）。
9. T-5.09：升级 src/renderer/paintLand.ts（paintFarmland），按 toneShift 将 pal.farmlandFill 与 pal.paperBg / pal.roofTown / pal.treeFill 做 10%-22% 柔和四阶混色，绘极浅田埂与柔和耕垄。
10. T-5.10：校准 townBlocks.ts（屋宇面宽 9.5-17.5 m、进深 8.0-14.5 m，乘 scale = zone.buildingScale ?? 1，targetCellM2 = (1250 + (1 - zone.density) * 1150) * scale * scale，MAX_EDGE_ROWS = 9，18-24 ha 边镇 walled_city 产出 240-520 栋、典型 280-480 栋、单屋均面积 80-260 m²，单区重抽实机目标 < 80 ms）与 village.ts（areaHa < 1.5 或 buildingScale < 0.85 时切入迷你营地模式：屋长 6.5-10.5 m、屋宽 4.5-6.8 m、步距 11-18 m、紧凑小篱院或无篱院、支持环空地紧凑排屋，使 0.4-0.8 ha 稳定产出 6-14 栋木屋）。
11. T-5.11：升级 src/ai/spatialAnalyze.ts（新增通用比例健康告警，如单块 farmland > 35 ha 建议拆成多片沿河/沿路中小型条田带、超迷你区比例提醒）；更新 .agents/skills/settlement-studio-mapper/references/{cartography-standards.md,ops-cheatsheet.md}，补齐跨要素真实比例尺红线表与 V5 参数速查。

【三、六条防呆护栏（违反任一条即不通过）】
1. src/ 下全部 .ts/.tsx 严格 <= 320 行（marchingSquares.ts <= 320、supplementaryContours.ts <= 200、farmlandStrips.ts <= 240、farmland.ts <= 200、opSchemas.ts <= 320、opProjectHandlers.ts <= 320）；零 any / @ts-ignore / TODO / FIXME；src/core/ 与 src/ai/ 零 Math.random()。
2. terrainNoiseAmpM <= 1e-9 时宏观起伏与河谷微凹必须自动归 0，确保既有全部测试零退化。
3. farmland.ts 彻底移除 computeVoronoiCells，条田绝不画到公路、河湖或水渠上。
4. src/ai/、src/cli/、src/mcp/ 与 .agents/skills/ 严禁任何世界观专有名词或外部路径。
5. 严禁修改 projects/ 下任何工程文件（尤其 3 套受保护预设）、legacy_v1_js/ 与 docs/01_*~10_*、docs/12_*。
6. 完成后依次执行并确认全部退出码为 0：
   - npm run check
   - npm run build
   - 全量 src/**/*.ts(x) 行数扫描确认最大行数 <= 320。
   全部全绿后更新 docs/11_V5_执行对照计划表与视觉验收矩阵.md 中 T-5.01 ~ T-5.11 为 [x] 已完成（填齐三要素）、顶部进度改为「11 / 16 项已完成」、填写 V5-M1 与 V5-M2 核验日志并停下等待第二棒指令。
```

### 3.2 第二棒：`V5-M3` 自动化验收、重制 `D2-03` 实图导出与视觉闭环（`T-5.12` — `T-5.16`）

```text
你是负责实施 Settlement Studio V5.0 终验收官的自动化测试与多模态地图学审图专家。
当前执行【V5.0 两棒接力 · 第二棒（V5-M3：任务 T-5.12 至 T-5.16，共 5 项）】。
工作目录严格限定为：/Users/jrdamocles/code/TERRAX/settlement_studio/

【一、开工核查】
1. 完整读取 docs/10_V5_全幅等高线_自然条田与真实比例尺升级规格书.md（重点精读第 4 章）与 docs/11_V5_执行对照计划表与视觉验收矩阵.md（确认 T-5.01 ~ T-5.11 均为 [x] 已完成且 11 / 16）。
2. 先运行 npm run check 确认第一棒基线当前 0 错 0 警全绿。

【二、本棒交付目标（T-5.12 ~ T-5.16）】
1. T-5.12（新建 V5 专项测试套件）：
   - 新建 tests/v5-realism-and-scale.test.ts，严格断言：
     (a) 全幅连续等高线：开启长波宏观起伏后平原区域出现非零等高线且平原坡度保持 < 2°；
     (b) 纯解析零破坏：terrainNoiseAmpM: 0 时 resolveMacroReliefAmp === 0 且 resolveValleyCarveRatio === 0，纯斜坡高程与解析值一致；
     (c) 宽河谷汇水微坡：等高线跨河道向河谷上游弯曲；
     (d) 缓坡间曲线：extractSupplementaryContours 仅保留 slope <= supplementaryMaxSlopeDeg 且点数 >= 3 的缓坡段，陡山自动隐退；SVG 渲染中含虚线间曲线、无额外高程字、河湖水面内无穿越线；
     (e) 非 Voronoi 自然条田：src/core/generators/farmland.ts 源码零 computeVoronoiCells 引用；同选区输出多角度耕垄、4 阶 toneShift 分散、严格避让公路/河湖/明渠/城墙/陡坡/禁建圈且田埂含成簇安全树篱；
     (f) 真实人类比例尺（T5/T6）：20 ha walled_city（density: 0.88, buildingScale: 1.0）稳定产出 240-520 栋细密屋宇（均面积 80-260 m²），单区重抽单测稳健门禁 < 250 ms（实机目标 < 80 ms）；0.55 ha 迷你营地 village（内嵌 0.16 ha exclusion）稳定产出 6-14 栋小尺度木屋（均面积 25-90 m²）；
     (g) AI 通用比例告警与解耦守卫（T7）：单块 farmland > 35 ha 触发 spatialAnalyze 拆分建议告警；扫描 src/ai/、src/cli/、src/mcp/ 与 .agents/skills/ 零世界观专有名词与外部路径；
     (h) 三预设零回归与 D2-03 硬指标（T8）：三套受保护预设零穿模且既有断言全过，D2-03 满足营地/环石/边镇/条田/间曲线硬指标。
2. T-5.13（全量门禁与构建）：
   - 运行 npm run check（tsc + biome 0 错 0 警 + 全量 Vitest，含既有 196 条测试用例零退化）与 npm run build；
   - 扫描全仓 src/**/*.ts(x) 验证最大行数 <= 320 行（含 marchingSquares.ts <= 320、supplementaryContours.ts <= 200、farmlandStrips.ts <= 240、farmland.ts <= 200、opSchemas.ts <= 320、opProjectHandlers.ts <= 320）；
   - 核验 3 套受保护预设工程文件（起点城 / 长湖 / 帕隆）零变更。
3. T-5.14（按真实比例重制 D2-03 工程）：
   - 读取并诊断现有 projects/D203_灰山口与囚禁魔营地.worldtown.json（先跑 npm run studio -- inspect），然后使用新版 npm run studio CLI（apply / inspect / query）按真实人类比例尺完成重制：
     * 15 人猎人营地收束至 ~0.4-0.7 ha（含 ~0.18 ha 环石空地符号 + 6-14 栋小尺度真实木屋，恰当设置 buildingScale）；
     * 灰山口边镇 ~20 ha 产出 >= 260 栋细密紧凑屋宇；
     * 开启全幅长波起伏（macroReliefAmpM）、宽河谷微凹（valleyCarveRatio）与缓坡间曲线（showSupplementaryContours: true）；
     * 将超大农田拆分为多片中小型自然条田带（单块 6-24 ha），沿河谷舒展并严格避路避水；
     * 运行 npm run studio -- inspect 确认 collisionHits === 0、零空区、零 warnings。
   - 如在实图重制中发现引擎边界瑕疵，可做最小化修复并同步补单测，严禁破坏任何门禁。
4. T-5.15（双版正式导出与双尺度视觉自检）：
   - 运行 npm run studio -- export 分别正式导出以下 4 个文件（gridOverlay 严格为 false）：
     * exports/D203_灰山口与囚禁魔营地_导览版.png
     * exports/D203_灰山口与囚禁魔营地_导览版.svg
     * exports/D203_灰山口与囚禁魔营地_标准版.png
     * exports/D203_灰山口与囚禁魔营地_标准版.svg
   - 运行 npm run studio -- render --crop-zone / --crop-bbox 生成边镇街坊、迷你营地、条田与路水交界、河谷等高线 4 张局部特写图并读取审图（对照 11_V5 第 4.2 节 VIS-F1~F5 与 VIS-C1~C4 逐项核验）；发现瑕疵则微调重导出，审图完毕清理临时特写文件。
5. T-5.16（终验收官回填）：
   - 逐项更新 docs/11_V5_执行对照计划表与视觉验收矩阵.md：T-5.12 ~ T-5.16 改为 [x] 已完成并填齐三要素，顶部进度更新为「16 / 16 项已完成」，填齐 V5-M3 阶段核验日志、第 4.1 节 V5-BG-01 ~ V5-BG-08 实测结果与第 4.2 节双尺度视觉自检记录；
   - 终检再跑一次 npm run check && npm run build 与 git status 核验（确认 3 套受保护预设零变更）。

【三、硬性护栏】
1. 绝不触碰 3 套受保护基准预设工程、legacy_v1_js/、docs/01_*~10_*、docs/12_* 及工作目录外任何路径。
2. 全量改动仍须严守 src/ 全文件 <= 320 行、零 any、零 Math.random() 与零世界观解耦红线。
3. 完成后输出终验实测汇总表（含 Vitest 总通过数、最大行数、D2-03 各项关键指标及 4 个导出文件体积）。
```

---

## 第 4 章 方案三：【中断续跑 / 审查返修提示词】

### 4.1 断点续跑提示词（会话中断后无缝接续）

```text
你是负责接续完成 Settlement Studio V5.0 的资深 TypeScript 图形与地图学工程师。
工作目录严格限定为：/Users/jrdamocles/code/TERRAX/settlement_studio/

请立即执行以下断点恢复流程：
1. 读取 docs/11_V5_执行对照计划表与视觉验收矩阵.md 与 docs/10_V5_全幅等高线_自然条田与真实比例尺升级规格书.md，定位对照表中第一个状态仍为「[ ] 待执行」或「[~] 进行中」的任务节点。
2. 运行 git status 与 npm run check 确认当前工作区已有产出状态（严禁推倒重来已完成且通过校验的模块）。
3. 从该断点任务起，严格按顺序继续完成剩余任务直至 T-5.16，全程遵守六条 V5 硬护栏：
   - src/ 全部文件严格 <= 320 行（marchingSquares.ts 禁膨胀，间曲线独立在 supplementaryContours.ts）；
   - terrainNoiseAmpM <= 1e-9 保护既有纯解析单测；
   - farmland.ts 彻底弃用 Voronoi 并硬避路水陡坡禁建圈；
   - src/ai/、src/cli/、src/mcp/ 与 .agents/skills/ 零世界观专有名词解耦；
   - 3 套受保护预设工程零改动；
   - 每阶段先跑通 npm run check（tsc + biome 0 错 0 警 + 全量 Vitest）再回填 11_V5 三要素。
4. 收尾完成 npm run build、D2-03 导览版/标准版双尺度视觉自检与 11_V5 全量 16 / 16 回填，输出续跑终验摘要。
```

### 4.2 审查返修提示词（针对审图或代码审查问题单做最小化闭环修复）

```text
你是负责 Settlement Studio V5.0 定向返修的资深图形与地图学工程师。
工作目录严格限定为：/Users/jrdamocles/code/TERRAX/settlement_studio/

请对照 docs/10_V5_全幅等高线_自然条田与真实比例尺升级规格书.md 与 docs/11_V5_执行对照计划表与视觉验收矩阵.md，针对以下审查发现的问题清单做最小化定向修复：

<在此粘贴代码审查或审图发现的具体问题、文件与期望效果>

【返修硬约束】
1. 仅修改问题直接关联的最小文件集合，严禁顺手重构无关模块或改动 3 套受保护预设工程。
2. 若为代码算法或渲染缺陷：先在 tests/v5-realism-and-scale.test.ts 补充可复现该问题的自动化回归断言，再修复实现直至断言转绿。
3. 若为 D2-03 视觉或比例问题：通过 npm run studio CLI 定向微调 projects/D203_灰山口与囚禁魔营地.worldtown.json，重新导出 exports/D203_灰山口与囚禁魔营地_{导览版,标准版}.{png,svg} 并用局部特写图复检确认问题根除。
4. 保持 src/ 全文件 <= 320 行（marchingSquares.ts <= 320）、零 any、零 Math.random()、零世界观解耦红线。
5. 修复完毕后必须完整通过 npm run check（0 错 0 警）与 npm run build，并同步更新 docs/11_V5_执行对照计划表与视觉验收矩阵.md 对应实测记录。
```
