# Terrax Settlement Studio V3.0 — DeepSeek V4.1 Flash 三阶段接力执行提示词

| 文档属性 | 规范内容 |
| :--- | :--- |
| **适配模型** | `deepseek v4.1 flash`（推荐分三棒在独立新会话依次投喂，每棒聚焦 5–8 项任务，避免长上下文衰减） |
| **工作目录** | `/Users/wumail/code/TERRAX/settlement_studio/` |
| **上游规格与账本** | [05_V3_方志交互制图与笔刷重构规格书.md](05_V3_方志交互制图与笔刷重构规格书.md) · [06_V3_执行对照计划表与视觉验收矩阵.md](06_V3_执行对照计划表与视觉验收矩阵.md) |
| **只读方志美学参考** | `/Users/wumail/code/TERRAX/候选工作区/20261116_B大陆文化与历史/聚落地图样稿_候选之候选/{settlement_engine,render_losrumura,render_fushi_town,render_palong_village}.py` |

> **使用方式**：按顺序把下面 **第 1 棒 → 第 2 棒 → 第 3 棒** 的代码块整段复制投喂给 DeepSeek V4.1 Flash。每棒结束后你可以在浏览器里直接打开试手感、看 `dist/previews/*.svg` 成图效果，满意再发下一棒；如果中途断线或你想局部返修，直接使用 **第 4 节（断点续跑 / 视觉返修提示词）**。

---

## 第 1 棒提示词（阶段一：PS 分组工具栏 + 顶部选项栏 + 笔刷引擎重做 + 离屏缓存 + 图饰修复）

```text
你是负责实施 Terrax Settlement Studio V3.0 的资深前端图形与交互架构师。当前执行【V3.0 三阶段接力 · 第 1 棒（阶段一：任务 V3-S1.1 至 V3-S1.7，共 7 项）】。
工作目录严格限定为：/Users/wumail/code/TERRAX/settlement_studio/

【一、开工必读】
写任何代码前，请先完整读取：
1. /Users/wumail/code/TERRAX/settlement_studio/docs/05_V3_方志交互制图与笔刷重构规格书.md（重点精读第 0、1、2 章）
2. /Users/wumail/code/TERRAX/settlement_studio/docs/06_V3_执行对照计划表与视觉验收矩阵.md
3. 检查现有文件：src/schema/{geometry.types,project.schema,legend.schema}.ts、src/store/useStudioStore.ts、src/core/terrain/terrainSculpt.ts、src/renderer/{furnitureLayout,paintScene}.ts、src/ui/{App,ToolDock,CanvasStage,canvasStageInput}.tsx/.ts 与 tests/renderer-and-ui-parity.test.ts。

【二、本棒交付目标（V3-S1.1 ~ V3-S1.7，暂不做阶段二的水工/城坊重构与阶段三的工程数据重写）】
1. Schema V3 向下兼容扩展（V3-S1.1）：
   - 在 src/schema/project.schema.ts 以 .default(...) 增量新增顶层数组：weirs、docks、watermills、structures、bridgeOverrides、paintedTrees，并扩展 canal.style、zone 可选字段（frayOuter/marketMode/exclusionStyle/ribbonSpine/corridorWidthM）、terrain 可选字段（showHypsometricTint/showHachures/hachureSlopeMinDeg/terrainNoiseAmpM/terrainSeed）、legend.displayMode 与 landmark.badgeNum/subtitle；
   - 必须保证现有 projects/*.worldtown.json 及不含 V3 字段的旧 V1.2/V2 JSON 100% 无损通过 normalizeProject()；
   - 在 src/schema/geometry.types.ts 升级 SculptBrushMode 为 7 模式（'raise' | 'lower' | 'smooth' | 'flatten' | 'terrace' | 'ramp' | 'erase'），并升级 TOOL_IDS 与 SelectionTargetType（包含 'weir' | 'dock' | 'watermill' | 'structure' | 'bridge'）。
2. Store 升级（V3-S1.2）：
   - 保持现有 ZundoOptions<StudioState, StudioHistorySlice> 精确泛型与 50 步撤销合并机制不变（严禁破坏 TS 推导）；
   - 新增 lastToolInGroup、brush.hardness（0~0.95）、brush.autoLockStartElev、brush.terraceStepM、treeBrush 设置（radiusM / spacingM / minR / maxR / eraseMode）、hydraulicPreset 与 structurePreset 状态及更新方法。
3. PS 风格左侧 7 组聚合工具栏 + 顶部 36px 上下文选项栏（V3-S1.3）：
   - 新建 src/ui/toolCatalog.ts（定义 7 个工具组与组内子工具、主快捷键与单键直达映射）；
   - 重写 src/ui/ToolDock.tsx：左侧只展示 7 个分组槽位，带右下角 ◢ 展开角标；单击选中组内记忆工具，右键/点击角标/长按 280ms 弹出子工具浮层；重复按组快捷键或 Shift+组键在组内轮切；
   - 新建 src/ui/ToolOptionsBar.tsx（36px 高，置于 TopBar 下方、画布正上方，随 activeTool 动态横排笔刷模式/半径/硬度/强度/林木笔刷/水工/建筑群/选区等常用参数），接入 App.tsx（同时接入 Delete 删除新实体与 `[` / `]` / `Shift+[` / `Shift+]` 笔刷快捷键）。
4. 笔刷数学引擎重做（V3-S1.4）：
   - 升级 src/core/terrain/terrainSculpt.ts：
     (a) 实现带硬度平顶衰减核（u <= hardness 权重恒 1，其余平滑归零）；
     (b) 实现等距弧长插值 applySculptStrokeSegment（spacing = max(3, 0.22 * radiusM)），杜绝快拖断珠与慢拖叠爆；
     (c) 完整实现 7 种模式：raise、lower、smooth、flatten、terrace（按 terraceStepM 收敛阶地）、ramp（独立导出 applyRampStroke 从 A->B 拉出均匀斜坡）、erase（将 sculptDelta 平滑归零恢复原地形）；
     (d) 支持 options.skipEncode（拖拽期间为 true，严禁在 pointermove 中调用 encodeSculptDelta 做 Base64 编码！仅在 pointerup 统一编码一次）。
5. 画布笔刷手感、双圈光标与林木涂抹/擦除笔刷（V3-S1.5）：
   - 修复 canvasStageInput.ts 悬停 Bug：!drag 且处于 sculpt_brush / contour_drag / tree_brush 时必须置 refs.dirty.current = true；
   - paintScene.ts 的 ui-overlay 层绘制双圈光标（外虚线总半径 + 内实线硬度平顶区 + 右下海拔/模式微型读数芯片），ramp 模式拖拽中绘制斜坡起止预览带；
   - 接入画布快捷操作：Shift+滚轮原地调半径、拖拽中按住 Alt 临时反向（raise<->lower 或 tree_brush 擦除）、按住 Shift 临时切 smooth；flatten 开启 autoLockStartElev 时落笔自动锁当前海拔；contour_drag 改读 state.brush.radiusM 与 strength（解除 90/0.85 硬编码）；
   - 实现 tree_brush：拖拽沿弧长确定性撒点，经 guardSafeTree 校验写入 project.paintedTrees（并入编译结果的 trees 同步渲染）；按住 Alt 或擦除模式删除半径内 paintedTrees；单笔涂抹经 beginContinuousEdit/endContinuousEdit 合并为单步撤销。
6. 三层离屏缓存 + 图饰 frame 锚定修复（V3-S1.6）：
   - 新建 src/renderer/stageCache.ts：在浏览器环境使用离屏 Canvas 缓存静态地图层（1-12 层），悬停光标、拖拽预览与静止缩放直接 drawImage 复用缓存，显著降低主线程每帧开销（Node/无 DOM 环境自动透明降级直绘，不影响测试与 SVG 导出）；
   - 修复 src/renderer/furnitureLayout.ts：computeFurnitureLayout 必须接收 frame: LayoutRect（地图纸框像素矩形），把标题牌、指北针、比例尺、图例框严格锚定在 frame ∩ viewport 内部（14px 内边距）并零重叠；比例尺实现 niceScaleMeters() 吸附 1/2/5×10^n 整刻度并按准确 zoom 反算宽度。
7. 单测与门禁闭环（V3-S1.7）：
   - 更新 tests/renderer-and-ui-parity.test.ts 中已过时的 V2 硬编码断言（如 TOOL_IDS.length === 12、files.length === 56、旧视口 rect.x === 16），改为验证 V3 7 组工具栏、frame 内图饰不越界（含 1440×800 宽屏测试）、整刻度比例尺与全 src/ 单文件 <= 320 行；
   - 新增断言覆盖：笔刷弧长插值连续性、hardness 平顶效果、ramp 斜坡线性过渡、terrace 阶地收敛、erase 还原、pointermove 零 Base64 编码、tree_brush 涂抹与擦除及防穿模、V1.2/V2 旧 JSON 无损兼容。

【三、硬性工程护栏（违反任一条即不通过）】
1. src/ 下每一个 .ts / .tsx 文件物理行数严格 <= 320 行（超限必须拆分模块）；零 any / as any / @ts-ignore / TODO / FIXME；src/core/ 严禁 Math.random()；严禁新增 npm 包；严禁创建 tailwind.config.js。
2. 严禁修改 legacy_v1_js/、docs/01_*~04_* 及 /Users/wumail/code/TERRAX/settlement_studio/ 以外的任何文件。
3. 严守同源渲染：地图绘制逻辑只在 paintScene.ts 写一遍，Canvas 与 SVG 严格共用。
4. 完成后必须依次执行并确认全部退出码为 0：
   - npm run check
   - npm run build
   - 全目录 src/**/*.ts(x) 行数扫描确认最大行数 <= 320。
5. 全部全绿后，更新 docs/06_V3_执行对照计划表与视觉验收矩阵.md 中 V3-S1.1 ~ V3-S1.7 为 [x] 已完成（填齐三要素）、顶部进度改为「7 / 20 项已完成」、并填写第 4 章阶段一核验日志。

完成后输出阶段一实测摘要并停下，等待第 2 棒指令。
```

---

## 第 2 棒提示词（阶段二：水工结构件 + 核心建筑群精确编辑 + 有机生成器 + 山水淡彩晕滃与导览模式）

```text
你是负责实施 Terrax Settlement Studio V3.0 的水工实体、程序化城建与地图学渲染首席工程师。当前执行【V3.0 三阶段接力 · 第 2 棒（阶段二：任务 V3-S2.1 至 V3-S2.8，共 8 项）】。
工作目录严格限定为：/Users/wumail/code/TERRAX/settlement_studio/

【一、开工核查与只读参考】
1. 完整读取 docs/05_V3_方志交互制图与笔刷重构规格书.md（重点精读第 3 章）与 docs/06_V3_执行对照计划表与视觉验收矩阵.md，确认阶段一（7/20）已完成且 npm run check 为 0。
2. 可只读参考以下文件了解 TERRAX 真实地图美学与原语实现（严禁修改）：
   /Users/wumail/code/TERRAX/候选工作区/20261116_B大陆文化与历史/聚落地图样稿_候选之候选/settlement_engine.py

【二、本棒交付目标（V3-S2.1 ~ V3-S2.8）】
1. 水工结构件编译与自动桥/水门联动（V3-S2.1）：
   - 新建 src/core/hydro/hydraulicWorks.ts：构建 project.weirs（堰体多边形 + 闸墩 + 溢流白浪）、project.docks（slipway 岸坪+平行涂脂滑道 / wooden_pier 岸坪+木栈桥，提供 snapPointToWaterBank 供交互吸附岸线与自动对齐法向）、project.watermills（工坊石基屋体 + 侧挂水轮）；
   - 升级 src/core/hydro/reefRoadBridge.ts：道路跨非 qanat 明渠（widthM >= 3.5）自动生成小桥；支持 project.bridgeOverrides（35m 内匹配：stone_arch / timber / fortified_twin 双桥头堡 / ford 降级为渡口）；
   - 升级 src/core/generators/wallBuilder.ts：城墙额外与明渠求交，在交点生成拱形水门豁口（width = canal.widthM + 2.5m），禁止水渠横切死墙；
   - 升级 src/core/hydro/riverCanal.ts：支持 5 类水渠样式（stone_clean/open、irrigation、drainage_dashed、foul_outfall、qanat）。
2. 核心建筑群精确编译、障碍前置与画布操控（V3-S2.2）：
   - 新建 src/core/generators/customStructures.ts：将 project.structures 编译为真实多边形（rect 矩形、l_hall 6 顶点曲尺 L 形、u_court 8 顶点三合院、round_altar 16 边圆坛+内环台基），输出脊线与阴影；
   - 在 compileScene.ts 阶段一（普通民房生成之前）将 structures、weirs、docks、watermills、fortified_twin 桥头堡全部注入 ObstacleGrid 与 spatialHash，确保周围民居与树木自动避让零穿模；
   - 升级 src/core/hitTest.ts、src/renderer/paintHandles.ts、src/ui/{canvasStageHandlers,canvasStageInput}.ts：支持 place_hydraulic 与 place_structure 工具画布落位（水工自动吸附岸线），以及 select 工具下点选、中心拖拽、旋转柄、长宽缩放柄完整交互（拾取优先级排在 zone 之前）。
3. 城坊生成器质变升级（V3-S2.3）：
   - 升级 src/core/generators/walledCity.ts：自动收集落在 walled_city 内部或相交的 citadel / market / exclusion 多边形作为 innerHoles，街坊与屋宇严格避让，实现“城中套城”；
   - 重写 src/core/generators/townBlocks.ts：
     (a) 先用穿过选区的 project.roads 切割/对齐街坊骨架，再行有界 Voronoi 次级巷道划分；
     (b) 彻底废除“把不规则碎多边形直接缩 0.62m 当屋顶”的碎渣画法！改为沿街坊各条临街边排布定向矩形/曲尺（OBB）建筑基底（面宽 14–28m、进深 12–24m），街坊内部自然留出院落中庭并点缀院树；
     (c) 支持 zone.frayOuter（true 时距主干道越远、越近选区外边界的建筑按平滑概率梯度稀疏衰减，消除方框硬切感）。
4. 村寨、集市、堡寨、农田、禁建圈全面修复（V3-S2.4）：
   - village.ts：优先沿 zone.ribbonSpine 或穿过/邻近该选区的 project.roads 两侧带状排布农舍、曲尺厢房、安全菜畦与果树（无路时回退等高线切线）；
   - market.ts：彻底修复 ix * pitchX * 0.5 挤压 Bug（改为 ix * pitchX，让货棚饱满铺展集坪而非挤在中心一团），并支持 stalls / timber_yard / port_apron 三种模式；
   - citadel.ts：若该选区内已有显式 project.structures，则只铺高阶院坪与院树不再硬塞固定 5 小点；无显式建筑时按大院真实尺寸成比例生成大殿与四仓；
   - farmland.ts：田块保持柔和相邻角度错落，田角自然点缀少量安全田间树；
   - compileScene.ts 同步并入 project.paintedTrees（经 guardSafeTree 校验），确保笔刷种的树受全局防穿模保护。
5. 微地形噪声、高程分层淡彩带与顺坡晕滃短线（V3-S2.5）：
   - 升级 src/core/terrain/elevationField.ts：按 terrain.terrainNoiseAmpM 与 terrain.terrainSeed 叠加确定性 2–3 八度平滑值噪声（零 Math.random），打破光滑椭圆感；
   - 新建 src/core/terrain/terrainShading.ts：
     (a) 基于高程场生成柔和低饱和分层淡彩带（hypsometric tint，可由 showHypsometricTint 开关）；
     (b) 沿等高线在坡度 >= hachureSlopeMinDeg 处沿下坡方向生成西北光照疏密调制的短促顺坡晕滃线段（受 showHachures 控制，零圆头蝌蚪纹），以批处理线段数组输出。
6. 同源双端渲染器升级（V3-S2.6）：
   - 新建 src/renderer/paintStructures.ts（拆分水工、核心建筑群、双桥头堡与黑石疫圈绘制，保证 paintScene.ts <= 320 行）；
   - 升级 src/renderer/paintScene.ts 与 src/renderer/exportUtils.ts（Canvas 与 SVG 严格同源）：
     (a) 补绘之前漏绘的 scene.lanes 与 scene.exclusionPolys（plague_stones 黑石界碑圆点串+虚线、meadow 草甸、marsh 排碱虚线）；
     (b) 绘制高程淡彩带与顺坡晕滃短线批处理；
     (c) 农田去掉重黑描边（pal.inkDark 边框移除，改柔和浅底 + 清晰平行垄线）；
     (d) 绘制 5 类水渠（stone_clean / irrigation / drainage_dashed / foul_outfall / qanat）、分水堰、滑道坞/木栈桥、水力工坊、核心建筑（含圆坛双环与 L/U 院阴影）、双桥头堡；
     (e) 修复全图缩放标注（22% 缩放下河名与核心选区名清晰可读并带光晕）；实现 legend.displayMode 的 standard / guided（编号圆标 ①②③ + 外置图注目录）/ pure（纯净无字无框艺术底图）三模式导出。
7. 检视器面板升级（V3-S2.7）：
   - 新建 src/ui/inspector/StructurePanel.tsx（或整合进 HydroRoadPanel），支持编辑选中水工（闸孔/滑道数/长度/角度）与核心建筑群（名称/形制/精确宽深米数/旋转角/屋顶色），并精简右侧面板中已被顶部选项栏取代的重复“绘图子模式”区块，强化对象图层列表点选定位。
8. 阶段二综合单测与反丑陋门禁（V3-S2.8）：
   - 新建 tests/v3-structures-and-quality.test.ts，严格断言：
     (1) weirs/docks/watermills/structures/bridgeOverrides 编译、碰撞避让、拾取与 Canvas/SVG 双端绘制一致；
     (2) 水渠穿城墙生水门、干道跨明渠生小桥、walled_city 自动挖空内嵌 citadel；
     (3) market 货棚散布包围盒面积 >= 45% 集坪（彻底根治 0.5 挤压 Bug）；
     (4) scene.lanes 与 scene.exclusionPolys 在 Canvas 与 SVG 中实测产出非零绘制调用；
     (5) 城坊产出定向 OBB 建筑、frayOuter 外缘稀疏、农田无重黑外框、地形产出非零淡彩与晕滃短线；
     (6) 全局零穿模审计全绿、单文件 <= 320 行。

【三、硬性护栏与收尾】
1. 全 src/ 任意 .ts/.tsx 严格 <= 320 行；零 any / TODO / FIXME / Math.random()；严禁新增 npm 包；严禁修改 legacy_v1_js/ 及 settlement_studio/ 以外任何目录。
2. 实跑 npm run check && npm run build 退出码全为 0，并核查单文件最大行数 <= 320。
3. 回填 docs/06_V3_执行对照计划表与视觉验收矩阵.md 中 V3-S2.1 ~ V3-S2.8 为 [x] 已完成（三要素完整）、顶部进度改为「15 / 20 项已完成」、填写第 4 章阶段二核验日志。

完成后输出阶段二实测与反丑陋断言摘要并停下，等待第 3 棒指令。
```

---

## 第 3 棒提示词（阶段三：重制三套 TERRAX 方志标杆工程 + 9 张无头 SVG 视觉预览 + 全栈终验）

```text
你是负责实施 Terrax Settlement Studio V3.0 的 TERRAX 方志空间测绘与终审交付工程师。当前执行【V3.0 三阶段接力 · 第 3 棒（阶段三：任务 V3-S3.1 至 V3-S3.5，共 5 项）】。
工作目录严格限定为：/Users/wumail/code/TERRAX/settlement_studio/

【一、开工核查与只读方志底稿读取】
1. 读取 docs/05_V3_方志交互制图与笔刷重构规格书.md（重点精读第 4 章）与 docs/06_V3_执行对照计划表与视觉验收矩阵.md，确认阶段一+二（15/20）已全绿完成。
2. 严格只读查阅以下三份 TERRAX 官方样图场景构建脚本，以坐标转换公式：
   wx = worldSizeM / 2 + px
   wy = worldSizeM / 2 - py
   将其真实山河脉络、多边形城垣、水工设施、核心大院、放射驿道与编号地标高保真移植为 V3.0 .worldtown.json（严禁对候选工作区做任何写入！）：
   - /Users/wumail/code/TERRAX/候选工作区/20261116_B大陆文化与历史/聚落地图样稿_候选之候选/render_losrumura.py
   - /Users/wumail/code/TERRAX/候选工作区/20261116_B大陆文化与历史/聚落地图样稿_候选之候选/render_fushi_town.py
   - /Users/wumail/code/TERRAX/候选工作区/20261116_B大陆文化与历史/聚落地图样稿_候选之候选/render_palong_village.py

【二、本棒交付目标（V3-S3.1 ~ V3-S3.5）】
1. 重制 projects/起点城_Losrumura.worldtown.json（V3-S3.1，worldSizeM=3200，watabou_classic）：
   - 彻底消灭 V1.2/V2 的 14 个生硬矩形方块与悬空断河！
   - 14 点蜿蜒变宽 R1966 干流从东界流畅延展至西界（两端超出或紧贴 0 / 3200 边界，无平头截断）；东北与东南多条分叉山脊+冲沟+阶地陡坎（开启淡彩与顺坡晕滃）；
   - 东关三孔总分水堰（weir）跨河落位并配跨河主桥；接出穿城饮用净水渠（stone_clean 入东门穿内城）、上农灌溉支渠（irrigation 绕城南）、南排碱沟（drainage_dashed）与西北污尾渠（foul_outfall）；北埠回水湾南岸设四道涂脂滑道坞（dock: slipway）；
   - 13 边圆润有机内城（walled_city），东北角内嵌 citadel（含精准 L 形三木合契议事厅 + 4 座高阶公仓 structures），北岸东关分水堰东侧石矶独立建围垣官坛（citadel + round_altar + rect 司辰河衡官坛）；
   - 放射状官驿主干道由四城门向外自然展开并延展至图边；西坡老榆梁换装街、北关河埠坊、东关盐铁坊采用多边形有机选区且 frayOuter=true；南门外分设旧木行（timber_yard）与灰粪柴市（stalls）；外围多边形有机条田 + 大量沿山脊/河岸/田角自然散落的 paintedTrees（绝不画齐边绿色矩形森林！）；配 10 处带 badgeNum 的方志导览地标。
2. 重制 projects/长湖_复市镇.worldtown.json（V3-S3.2，worldSizeM=2600，arid_oasis）：
   - 东北入湖浅河与东南 L6 半咸水湖湾连成一体贴合右/上/下边界（非悬浮椭圆），东街湖岸设 3 座湖港木栈桥（wooden_pier），南端设古沙坝内侧浓缩卤水小潟湖；
   - 西侧红砂岩浅山多脊显明顺坡晕滃；西坡伊珂免税暗渠（qanat 竖井串）直通西水门堡（citadel + weir + structures）并接出穿镇明渠入湖；
   - 西北高地设 24 边圆形「前405年黑石大疫禁建界圈」（exclusion，exclusionStyle='plague_stones'）；镇坊紧贴湖港岸坪（port_apron）与十字街有机围合；南滩设非矩形有机分级晒盐池与条田；沿山坡与岸线点布 paintedTrees；配带 badgeNum 方志导览地标。
3. 重制 projects/帕隆_峡谷铁寨.worldtown.json（V3-S3.3，worldSizeM=1500，nordic_fjord）：
   - 深切 V 形多脊峡谷（南北交错多条主/次脊，高差约 180m，全坡面显明顺坡晕滃）；14 点 S 形穿界急溪（两端达图边）+ 中段急弯 7 块花岗岩底礁 + 暗梁涉水渡口；
   - 西南窄峡跨溪桥通过 bridgeOverrides 设为 fortified_twin（南北双生石堡桥头楼）；沿急溪两岸布设 6~8 座 watermill（水力锻锤铁坊）；
   - 南北两岸用带 ribbonSpine 的 village 沿盘山石道带状散居，山坡自然点布 paintedTrees 疏林；配带 badgeNum 方志导览地标。
4. 预设同步、9 张无头 SVG 视觉预览生成与方志空间硬断言（V3-S3.4）：
   - 核查 src/schema/presets.ts 完整无损载入更新后的三套工程；
   - 新建 tests/v3-benchmark-projects.test.ts：
     (a) 对三套工程逐一执行全量编译与零穿模审计（totalHits === 0，riverIslands === 0）；
     (b) 反丑陋与方志硬断言：每套工程 4 顶点简单矩形选区占比 < 20%；主河/湖湾端点触及边界（距图边 <= 20m）；起点城含 weirs>=1、docks>=1、structures>=5（含内嵌议事厅+公仓与北岸官坛）；长湖含 >=20 顶点圆形黑石疫圈、docks>=3、qanat 暗渠；帕隆含 fortified_twin 双桥头堡、watermills>=6、reefs===7、fords>=1；
     (c) 利用 SvgStringBackend（renderSceneToSvgString）将三套工程的 standard / guided / pure 共 9 张矢量预览落盘至 dist/previews/{losrumura,changhu,palong}_{standard,guided,pure}.svg（确保 SVG 合法闭合且体积 > 20KB），供用户直接打开审图！
5. 全栈终验与文档收口（V3-S3.5）：
   - 依次实跑以下全部命令并确认退出码严格为 0：
     1. npm run check
     2. npm run build
     3. /Users/wumail/code/TERRAX/worldbuilding/venv/bin/python3 tests/verify_backend.py
     4. 扫描确认 src/ 全部 .ts/.tsx 行数 <= 320，零 any/TODO/FIXME，src/core/ 零 Math.random()，且 legacy_v1_js/ 与 settlement_studio/ 以外目录零修改零污染。
   - 更新 docs/06_V3_执行对照计划表与视觉验收矩阵.md 全部 20/20 项为 [x] 已完成（填齐三要素）、第 4 章阶段三核验日志，并更新 README.md 简要记录 V3.0 升级特性与预览产物路径。

完成后输出全栈终验报告（含 3 套工程关键指标与 9 张 dist/previews/*.svg 路径清单）。
```

---

## 第 4 节 断点续跑 / 视觉审图返修提示词（按需使用）

当某棒中途中断，或你打开浏览器 / `dist/previews/*.svg` 审图后发现具体视觉或手感瑕疵时，复制下方模板并填入你的修改点：

```text
你是 Terrax Settlement Studio V3.0 的断点续跑与精修工程师。工作目录：/Users/wumail/code/TERRAX/settlement_studio/

请先读取：
- docs/05_V3_方志交互制图与笔刷重构规格书.md
- docs/06_V3_执行对照计划表与视觉验收矩阵.md

【当前任务模式（二选一）】
- 若为断点续跑：先运行 npm run check 核查当前状态，定位 06_V3 表中第一个仍为 `[ ]` 的任务继续完成当前阶段，全部通过后回填 06_V3。
- 若为视觉/交互返修：针对以下具体问题进行靶向修复，先补一条防回归单测再改代码：
  1. （在此粘贴你看到的截图/SVG 问题或操作手感问题）
  2. （可补充第二条）

【硬性护栏】
1. 严禁修改 legacy_v1_js/ 及 settlement_studio/ 以外任何文件；src/ 下所有 .ts/.tsx 严格 <= 320 行；零 any / TODO / Math.random()。
2. 修复后必须跑通 npm run check && npm run build，并重新生成 dist/previews/*.svg 供核验。
```


---

## 第 5 节 V3.1 终审精修与全局 UI 统一美化提示词（独立审图 + 交互体验收口专用）

```text
你是 Terrax Settlement Studio V3.1 的终审精修与 UI 设计系统工程师。工作目录：/Users/wumail/code/TERRAX/settlement_studio/

基于独立审图、源码核查与实机截图反馈，请一次性完成以下全部 11 项缺陷修复与全局 UI 统一美化（严禁破坏既有测试，保持 src/ 所有 .ts/.tsx <= 320 行、零 any/TODO/Math.random、零新增 npm 包、严禁创建 tailwind.config.js）：

============================================================
一、图饰双态解耦（交互态固定视口四角 vs 导出态落入图框）
============================================================
1. 修复 src/renderer/furnitureLayout.ts、src/renderer/paintFurniture.ts 与 src/renderer/paintScene.ts：
   - 交互编辑态（options.isExport !== true）：标题牌、指北针、比例尺、图例框与 guided 导览目录一律锚定在「画布视口矩形 { x: 0, y: 0, w: vp.widthPx, h: vp.heightPx }」的四角内边距（14px），绝不跟随地图 frame 缩放或平移而缩成一团盖住地图！比例尺长度仍按当前 vp.zoom 实时吸附 1/2/5×10ⁿ 整刻度；
   - 导出成图态（options.isExport === true，PNG / SVG 导出）：才锚定在地图纸框 `frame` 内部排版；
   - 同时修复标题牌宽度计算：根据主标题与副标题的实际估算宽度动态撑宽（或做优雅截断/双行收口，上限 clamp(220, 440, bounds.w * 0.52)），彻底根除长副标题溢出标题牌右边框的问题；
   - 图例卡片与图面文字标识统一半透明可调（绝不压死背后实际地图内容）：
     (a) 在 `src/schema/legend.schema.ts` 的 `LegendConfigSchema` 中新增两个带默认值的可调字段：`furnitureOpacity: z.number().min(0.15).max(1).default(0.72)`（图例框、标题牌、指北针、比例尺与导览目录底板与内容的统一透明度）与 `labelOpacity: z.number().min(0).max(1).default(0.78)`（地图内选区名、地标名、河名、核心建筑名与等高线高程字的统一透明度，调至 0 可一键隐去全部文字标识）；
     (b) 在 `paintFurniture.ts`、`paintAnnotations.ts`（含 `paintGuidedDirectory`）、`paintStructures.ts` 与 `paintScene.ts` 中将这两个透明度严格透传到 Canvas 与 SVG 双端绘制样式（图例与图面标注背景/光晕及文字同步应用，确保默认即柔和半透明、透出底层建筑与地形，不遮挡实际内容）；
     (c) 在右侧 `LegendPanel.tsx` 增加「图饰透明度」与「文字标识透明度」两条统一调节滑块（支持连续拖拽单步撤销合并），实时联动画布；
   - 更新 tests/renderer-and-ui-parity.test.ts，同时断言「交互态缩小到 zoom=0.12 时图饰仍稳居视口四角零挤压」、「导出态图饰 100% 落在 frame 内零越界」与「`furnitureOpacity / labelOpacity` 双端透传生效且旧 JSON 兼容默认值」。

============================================================
二、全局 UI 美化与样式统一（除画布与左侧工具栏外的全部区域）
============================================================
2. 建立统一的「浅色纸本测绘工坊（Light Cartographer's Atelier）」控件设计系统：
   - 升级 src/styles/atelier.css：
     (a) 定制纤细精致的测绘仪表滑块（input[type="range"] 自定义 3px 黄铜底轨 + 12px 松针绿实心圆钮带 2px 象牙白描边与柔和阴影，悬停/聚焦平滑过渡）；
     (b) 统一自定义复选框/开关、精致下拉箭头、数字输入框隐藏多余原生微调箭头、统一点按与 focus-visible 黄铜/松针绿微光；
     (c) 统一间距与层次：圆角一律 rounded-md (6px) / rounded (4px)，字号严格 11px 正文 / 10px 辅标 / 10.5px 等宽数字，统一细边框 border-brass/80。
   - 抽离或重构公共表单控件（如 src/ui/inspector/FormControls.tsx，彻底修复 Tailwind v4 的 w-full 覆盖 w-24/w-36 导致标签竖排折行的致命 Bug！）：
     (a) 根治标签折行：所有字段标签强制 `shrink-0 whitespace-nowrap`（如「基准高程」「计曲线间隔」「最低截断」「模式」绝不允许折成两行！），输入框从通用样式中移除 `w-full`，由各控件显式设定 `w-24`（数字）/ `w-36`（下拉）/ `flex-1 min-w-0`（名称文本）；
     (b) ToggleField 升级为精致的「药丸滑动开关（Switch）」，替代生硬原生绿色方框 checkbox；
     (c) PanelSection 升级为带微暖卡纸底（bg-desk/50 或柔和分组卡片 + 清晰细标题线）的视觉分组，留白舒展呼吸，视觉整齐对齐。
   - 美化与统一四大外框区域：
     (a) TopBar（顶栏）：收拢为清晰三段式布局——左侧「松针绿印章徽标 + 衬线可编辑工程标题 + 精致胶囊工程切换器 + 经纬度导入」，右侧按「撤销/重做｜文件存取｜导出组（PNG / SVG / Clean）｜服务端状态胶囊」用细竖线分组，按钮高度统一 `h-7`、字号 `11px`、统一柔和阴影与悬停反馈；
     (b) ToolOptionsBar（顶部 36px 上下文选项栏）：与顶栏和右栏视觉完全一致，采用柔和分组分隔线、统一紧凑滑块与分段式（Segmented Control）模式切换按钮（替代杂乱平铺小按钮）；
     (c) InspectorTabs（右侧检视器）：将 6 个标签页做成精致紧凑的分段/底线标签栏（`地形 | 水路 | 选区 | 工坊 | 图例 | 配色`，将「配色导出」精简为「配色」或改均分不挤边不裁字，底部/顶部留出清晰内边距），并清理 TerrainPanel 中已由顶部选项栏接管的冗余重复笔刷大段表单（仅保留精简折叠提示或快捷参数同步）；
     (d) StructurePanel（工坊面板）：为分水堰、码头、水力工坊、核心建筑群补齐「名称」输入框；
     (e) StatusBar（底栏）：坐标/海拔/坡度/缩放/要素计数采用等宽表格数字 + 细竖线分隔，右侧在线/离线与零穿模徽章样式统一克制精致。

============================================================
三、此前独立审图抓出的 P0/P1/P2 性能与地图学精修
============================================================
3. 修复 src/ui/stageRender.ts 离屏缓存被拖拽绕空的问题：
   - 平移/拖手柄/ramp 预览/悬停/画草稿时，只要 scene 与地形未变，禁止退回全量直绘（平移可通过偏移贴图或仅在地形/场景变更时重建静态底图，其余操作直接贴缓存 + 只重绘第 14 层 ui-overlay）；
   - 将 hoverContourId 高亮移入 ui-overlay 层绘制，不再令静态底图缓存失效，同时保证悬停等高线真实高亮。
4. 优化 src/core/terrain/terrainShading.ts 与 paintTerrain.ts：
   - 对 buildHypsometricTint 同行连续同 band 网格做水平 Run-Length 合并为连续长条多边形，将 7,744 个碎方块压减至 <= 1,500 个，大幅减小 SVG 体积并提速 Canvas 绘制；
   - 增强顺坡晕滃可读性：线长随图幅与坡度自适应为 4.5–10.5m，paintTerrain.ts 线宽 0.65、opacity 0.72。
5. 修复预览目录被 vite build 清空：将 tests/v3-benchmark-projects.test.ts 的 9 张 SVG 预览输出目录改为根目录平级 previews/（不放 dist/ 内），确保先 npm run check 再 npm run build 后 previews/*.svg 完整保留。
6. 修复 src/renderer/paintStructures.ts 第 76–80 行：citadel 屋顶严禁使用炭黑墙色 pal.wallFill，改为暖赭金派生色（mixHex(pal.roofInner, '#b58e4a', 0.45)）。
7. 修复 src/renderer/paintAnnotations.ts：
   - guided 模式隐藏全图大面积 zone.name（仅保留编号圆标 ①②③ 与河名）；
   - paintGuidedDirectory 加宽至 268–300px，去掉 label.slice(0, 16) 硬截断（完整显示名称，超宽才按字符省略）；
   - standard 模式增加图框右/下边界夹紧（防裁字）与 60px 内同名地标-选区去重。
8. 调优 src/core/generators/market.ts 与 townBlocks.ts：
   - market.ts stalls 模式拉大排距（ROW_PITCH_Y 11.5–13m、STALL_D 4.8–5.5m、列间增随机断口），保持摊列包围盒散布 >= 45% 集坪，消除“实心巧克力板”；
   - townBlocks.ts 收紧内城临街屋间距（1.2–2.6m）与 setback（1.4–2.2m），增强 Watabou 密排连片街坊感。
9. 修复两套工程穿帮与 village 叠线：
   - projects/长湖_复市镇.worldtown.json：东北出城驿道延伸跨 R2147 河口架桥连至东北边界，消除空地断头路；
   - projects/帕隆_峡谷铁寨.worldtown.json：理顺西南窄峡双哨桥防布局，消除 fortified_twin 与外围两个大五边形 citadel 叠套及北侧多余小桥；
   - src/core/generators/village.ts：若村寨骨架已贴合现有主干道（距离 < 10m），不再重复向 targetResult.lanes 推送白色叠线。
10. 更新 tests/generators-and-safety.test.ts 中 21/21 重抽测试标题与真实阈值一致，并补齐以上所有修复的回归断言（含交互态/导出态图饰解耦、淡彩多边形数 <= 1500、citadel 非炭黑屋顶、guided 目录无硬截断、previews/*.svg 存在性）。

【收尾验收】
依次实跑 npm run check && npm run build，确认 previews/ 下 9 张 SVG 完好、src/ 全部 .ts/.tsx <= 320 行、零 any/TODO/Math.random、退出码全为 0，并更新 docs/06_V3_执行对照计划表与视觉验收矩阵.md 的 V3.1 精修日志。
```
