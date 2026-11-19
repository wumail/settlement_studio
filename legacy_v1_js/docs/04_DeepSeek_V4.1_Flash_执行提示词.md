# Terrax Settlement Studio — DeepSeek V4.1 Flash 专用执行提示词

| 文档属性 | 规范内容 |
| :--- | :--- |
| **项目与版本** | `Terrax Settlement Studio` · `V1.2（正式执行基线版）` |
| **落盘路径** | `/Users/jrdamocles/code/TERRAX/settlement_studio/docs/04_DeepSeek_V4.1_Flash_执行提示词.md` |
| **上游规格基线** | [01_BRD_业务需求文档.md](01_BRD_业务需求文档.md) · [02_PRD_产品需求与技术规格书.md](02_PRD_产品需求与技术规格书.md) · [03_执行对照计划表与验收溯源矩阵.md](03_执行对照计划表与验收溯源矩阵.md) · [../README.md](../README.md) |
| **适配目标模型** | `deepseek v4.1 flash`（兼容 Agent 工具调用终端与多轮文件编辑工作流） |

---

## 第一章 模型特性诊断与投喂方案选型指南

### 1.1 针对 `deepseek v4.1 flash` 的工程防呆设计依据

`deepseek v4.1 flash` 具备极高的代码生成吞吐率与清晰的公式转译能力，但在执行跨 `10` 余个文件、总计约 `4,500 — 6,500` 行原生前后端代码的完整工程时，容易出现以下四类典型偏差：
1. **长文件尾段偷懒省略**：在编写 `9` 类 `ZONE_CONTENT_TYPES` 或 `14` 类微缩真图形图例时，前几项完整实现，后几项用 `// TODO`、注释省略号或单色圆点敷衍收尾。
2. **跨文件导出名漂移**：未严格核对前置模块的 `export` 符号表，在下游 `app.js` 或 `verify_headless.mjs` 中凭记忆拼错函数名导致运行期 `SyntaxError` 或 `TypeError`。
3. **碰撞与水文走捷径**：仅检测建筑中心点是否落入河道而漏检屋角压路，或在河道偏移中混入随机噪波导致窄河产生河心小岛。
4. **未测先勾进度表**：一次性写完多份文件而未在终端运行 Node 与 Python 实测断言便直接将对照表全部打勾。

为彻底锁死上述风险，本文档提供两套内嵌 **7 条硬性防偷懒护栏（Anti-Hallucination & Anti-Placeholder Guardrails）** 的标准提示词，用户可按当前会话环境任选其一直接复制投喂：

| 维度 | 方案一：单轮全自动通关总提示词（Master Prompt） | 方案二：分三棒稳健接力提示词（3-Stage Relay Prompts） |
| :--- | :--- | :--- |
| **适用模式** | IDE 开启长时自主 Agent / Goal 模式，允许模型连续调用数十次读写与终端工具 | 标准对话 Agent 模式，希望人工把控每棒质量、彻底规避单次上下文过长衰减 |
| **覆盖阶段** | 单次投喂自动串行跑完 `M0 -> M1 -> M2 -> M3 -> M4 -> M5 -> M6` | **第一棒** `M0—M3` 内核 -> **第二棒** `M4—M5` 浅色工坊前端 -> **第三棒** `M6` 服务端、示例与总核验 |
| **进度同步** | 每过一个 `M` 阶段自动实测并回写 `03_执行对照计划表` | 每棒结束强制落盘回写 `03_执行对照计划表`，下一棒开局自动读取断点无缝接续 |
| **推荐指数** | 适合无人值守一气呵成 | **最稳健推荐**：每棒仅聚焦 `3 — 5` 个文件，代码饱满度与一次通过率最高 |

---

## 第二章 七条硬性防偷懒护栏总纲（所有执行轮次强制生效）

以下七条铁律已完整嵌入第三章与第四章的每一段复制框内，监督者验收时亦以此为准绳：

1. **护栏 ①（必先通读三大基线）**：动笔写任何一行代码前，必须完整读取 `docs/01_BRD_业务需求文档.md`、`docs/02_PRD_产品需求与技术规格书.md` 与 `docs/03_执行对照计划表与验收溯源矩阵.md`，严禁跳过文档凭主观臆测开工。
2. **护栏 ②（零占位符与零省略铁律）**：所有落盘代码文件严禁出现 `TODO`、`FIXME`、`placeholder`、未实现空函数体、`// 其余类型同理省略` 等任何偷懒片段；确定性生成逻辑严禁调用 `Math.random()`，统一调用 `createRng(seed)`。
3. **护栏 ③（目录物理隔离与仓库零侵入）**：一切新建与修改操作严格限定在 `/Users/jrdamocles/code/TERRAX/settlement_studio/` 目录内部；对 `/Users/jrdamocles/code/TERRAX/地图/` 下的 `.bin / .npz / .json` 地理数据及上层 `候选工作区/` 脚本仅允许 `mode="r"` 只读访问，严禁修改任何外部文件或新建外部临时缓存，严禁创建 `package.json` 或安装第三方 npm 依赖。
4. **护栏 ④（跨模块 `export / import` 精确签名锁死）**：7 个前端 JS 模块的导出常量名、类名、函数名与参数顺序必须与 `02_PRD` 第 1.4 节逐字一致，所有浏览器与 Node 共用的 ES Module `import` 语句必须写全相对路径及 `.js` 扩展名；`M0 — M3` 四大内核模块及 `exporter.js` 的 `buildSVGString` 严禁在顶层引用 `window` 或 `document`。
5. **护栏 ⑤（五大业务红线与范围克制死命令）**：
   - **`BG-01` 零穿模**：完整实现 `512×512` 双遍 Chamfer SDF 栅格预筛加全顶点、边中点、全边段精确解析距离复检（`isPolygonSafe` 与 `verifyZeroCollisions`），确保 `buildingRoadHits === 0 && buildingWaterHits === 0 && buildingWallHits === 0 && buildingBuildingHits === 0 && buildingExclusionHits === 0`，跨河道路自动生成正交木石桥梁；
   - **`BG-02` 纯净无小岛河道**：`buildRiverGeometry` 严禁生成任何自动河心小沙岛或孔洞（`riverIslands === 0`），水中礁石仅由显式 `project.reefs` 生成；
   - **`BG-05` 无蝌蚪尖刺纹且图形图例齐全**：彻底禁画圆头蝌蚪尖刺纹（默认 `showScarpTicks: false`，开启时仅绘 `4.0 m` 下坡垂直细短齿线）；14 类内置图例与 8 类自定义地标必须逐一用 Canvas/SVG 绘出真实微缩制图结构图形，严禁画单色圆点敷衍；
   - **`BG-06` 全新浅色纸本测绘工坊 UI**：`atelier.css` 必须采用暖亚麻桌面 `#f4f1ea`、象牙面板 `#faf8f3`、黄铜分割线 `#d5cdbd`、松针绿 `#365942`、陶土红 `#b55838` 浅色设计语言，严禁复制 `/Users/jrdamocles/code/TERRAX/worldbuilding/` 的暗黑星空界面样式；地图内部屋宇与双遍融合树冠保持纯正 Watabou 质感且城、镇、村统一；
   - **`NG-01` 不做单栋房屋增删改**：严禁在工具坞或检视器添加任何单栋房屋新建、点选、拖拽、旋转或单栋橡皮擦删除功能。
6. **护栏 ⑥（Python 环境唯一指定）**：所有运行 `server.py`、`tests/verify_backend.py` 或联跑上层核验脚本的命令，统一强制使用 `/Users/jrdamocles/code/TERRAX/worldbuilding/venv/bin/python3`。
7. **护栏 ⑦（逐阶段实测闭环与实时回写对照表）**：每完成一个里程碑（`M0` 至 `M6`），必须立即在终端运行验证命令并确认退出码为 `0`，随后立即编辑更新 `docs/03_执行对照计划表与验收溯源矩阵.md` 中对应原子任务行的 `[x] 已完成` 状态、执行记录三要素、顶部总进度计数及 `5.3` 审计日志表，严禁攒到最后一次性补勾。

---

## 第三章 方案一：【单轮全自动通关总提示词（Master Prompt）】

适用场景：在开启长任务或自主编码模式下，直接完整复制下方代码块投喂给 `deepseek v4.1 flash`，一次性完成 `M0 — M6` 全部编码、三大示例工程构建、自动化核验与文档回写。

```text
你是负责实施 Terrax Settlement Studio（TERRAX 通用聚落可视化制图工作台 V1.2）的首席全栈图形与几何算法工程师。你的工作目录严格限定为：
/Users/jrdamocles/code/TERRAX/settlement_studio/

请严格按以下零歧义工程指令，一次性高质量完成 M0 至 M6 全部七个里程碑的完整代码编写、三大世界观示例工程构建、前后端自动化测试验收以及进度溯源表回写，直至全部核验脚本退出码为 0。

【一、最高优先级：七条防偷懒与防幻觉硬性护栏】
1. 必先通读基线文档：开始写任何代码前，必须依次完整读取以下三份基线文档，全面掌握全部数学公式、数据结构、接口签名与验收断言：
   - /Users/jrdamocles/code/TERRAX/settlement_studio/docs/01_BRD_业务需求文档.md
   - /Users/jrdamocles/code/TERRAX/settlement_studio/docs/02_PRD_产品需求与技术规格书.md
   - /Users/jrdamocles/code/TERRAX/settlement_studio/docs/03_执行对照计划表与验收溯源矩阵.md
2. 零占位符与零省略：所有 .js、.html、.css、.py、.json 文件必须 100% 完整实现。严禁在任何文件中留下 TODO、FIXME、省略号注释、空壳函数或伪造的固定返回值；确定性生成过程严禁调用 Math.random()，必须统一使用 state_and_schema.js 导出的 createRng(seed)。
3. 严守目录边界与仓库零侵入：严禁创建、修改或删除 /Users/jrdamocles/code/TERRAX/settlement_studio/ 以外的任何仓库文件（对 /Users/jrdamocles/code/TERRAX/地图/ 下的地理数据文件及候选工作区核验脚本仅允许只读访问）；严禁创建 package.json 或引入任何第三方前端 npm 依赖；严禁修改 docs/01_BRD_业务需求文档.md、docs/02_PRD_产品需求与技术规格书.md 与 docs/04_DeepSeek_V4.1_Flash_执行提示词.md。
4. 严守跨模块精确导出契约：全部 7 个前端 ES Module 的导出常量、类与函数名必须与 02_PRD 第 1.4 节完全一致，import 路径必须带完整 .js 后缀：
   - web/js/state_and_schema.js 必导出：SCHEMA_VERSION, GRID_N, OBSTACLE_GRID_N, BUILTIN_PALETTES, ZONE_CONTENT_TYPES, BUILTIN_LEGEND_CATALOG, CUSTOM_GLYPH_TYPES, hashSeed, createRng, createUid, encodeSculptDelta, decodeSculptDelta, getActivePalette, createDefaultProject, getBuiltinPresetProjects, normalizeProject, serializeProject, deserializeProject, syncLegendWithProject, HistoryManager
   - web/js/terrain_engine.js 必导出：buildElevationField, sampleElevation, sampleGradient, sampleSlopeDeg, evalTerrainShape, evalRiverCarve, extractContours, extractScarpTicks, buildTerrainPackage, hitTestContourLine, applyContourWarpDrag, applySculptBrush
   - web/js/hydro_road_engine.js 必导出：sampleCatmullRom, polylineLength, closestPointOnSegment, closestPointOnPolyline, buildRiverGeometry, buildWaterBodyGeometry, buildCanalGeometry, buildReefGeometry, buildRoadGeometry, solveOrthogonalBridges, buildHydroRoadPackage
   - web/js/gacha_zone_engine.js 必导出：computePolygonAreaSigned, computePolygonAreaHa, computePolygonCentroid, pointInPolygon, segmentsIntersect, segmentToSegmentDist, clipPolygonHalfPlane, computeVoronoiCells, insetConvexPolygon, buildObstacleGrid, sampleObstacleClearance, isPolygonSafe, compileSingleZone, compileAllZones, verifyZeroCollisions, compileSettlementScene, rerollZoneSeed
   - web/js/canvas_renderer.js 必导出：createViewport, worldToScreen, screenToWorld, zoomViewportAtScreenPoint, fitViewportToWorld, renderMergedTreeCanopy, drawLegendGlyphCanvas, renderSceneToCanvas
   - web/js/exporter.js 必导出：renderOffscreenPNGCanvas, exportPNGDataURL, downloadPNG, buildLegendGlyphSVG, buildSVGString, downloadSVG, downloadProjectJSON, readProjectJSONFile
   - web/js/app.js 必导出：createStudioApp
   同时确保 M0 至 M3 模块以及 buildSVGString 零 DOM 依赖（不访问 window 或 document），可在纯 Node.js v22 下直接 import 运行。
5. 严守五大核心业务红线：
   - BG-01 零穿模：完整实现 512x512 双遍 Chamfer SDF 距离场加全顶点、边中点、全边段精确解析距离复检（isPolygonSafe + verifyZeroCollisions），确保建筑对河流湖海岸退界 >= 8.0m、水渠 >= 0.5*widthM+4.0m、干道 >= 0.5*widthM+2.5m、城垣 >= 0.5*wallThicknessM+3.0m、邻屋 >= 0.8m、坡度 <= maxSlopeDeg，跨河道路自动生成正交木石桥梁（长 W_river+8m，宽 road.widthM+3m，命中渡口 fords 则改绘涉水渡口）；
   - BG-02 纯净河道：buildRiverGeometry 严禁生成任何自动河心小沙岛（river.islands 恒为空数组），水中岩礁仅由显式 project.reefs 生成 5-7 边形硬朗棱角礁石簇；
   - BG-05 无蝌蚪尖刺纹与真图形图例：彻底废除圆头蝌蚪尖刺纹（showScarpTicks 默认 false，开启时仅绘 4.0m 下坡向垂直细短齿线）；14 类内置图例与 8 类自定义地标徽记必须在 Canvas 和 SVG 中逐一绘制真实微缩制图结构图形，严禁用单色圆点敷衍；
   - BG-06 全新浅色纸本测绘工坊 UI：web/css/atelier.css 严格采用暖亚麻桌面 #f4f1ea、象牙卡纸面板 #faf8f3、黄铜分割线 #d5cdbd、松针绿 #365942、陶土红 #b55838 浅色体系，严禁抄袭 worldbuilding/ 的暗色星空界面；画布内地图严格呈现 Watabou 经典羊皮纸钢笔淡彩质感与三步双遍融合树冠（阴影 + 外廓 r+1.8m + 叶面 r），城、镇、村视觉规则统一；
   - 不做单栋房屋增删改：严禁实现任何单栋房屋新建、点选、拖拽、旋转或单栋橡皮擦功能，全部 9 类 ZONE_CONTENT_TYPES（walled_city, town_blocks, village, citadel, market, farmland, saltpan, woodland, exclusion）均由多边形选区加 seed 受控生成。
6. Python 解释器唯一路径：运行服务端与后端测试统一使用 /Users/jrdamocles/code/TERRAX/worldbuilding/venv/bin/python3。
7. 逐阶段实测与即时回写对照表：每完成 M0、M1、M2、M3、M4、M5、M6 中的一个阶段，必须立即运行终端测试命令确认通过，随后立即更新 docs/03_执行对照计划表与验收溯源矩阵.md 中该阶段对应 T-x.y 行的状态为 [x] 已完成，回填实际文件路径、实现要点与实测摘要，并同步更新顶部总进度与 5.3 里程碑审计表，严禁未测先勾。

【二、分阶段推进顺序与强制自测关卡】
- 第 1 步（M0 -> T-0.1~0.5）：编写 web/js/state_and_schema.js，用 node -e 实测 Base64 编解码误差 <= 0.051m、4套x12色 HEX 矩阵、normalizeProject、HistoryManager 40步栈与 syncLegendWithProject，通过后回写 M0 状态。
- 第 2 步（M1 -> T-1.1~1.5）：编写 web/js/terrain_engine.js，严格按 02_PRD 第 4-5 章公式实现五项高程合成、偏心椭圆二次正根有效半径核、山脊/冲沟/陡坎左右独立坡宽、16状态渐近消歧 Marching Squares、边键哈希拼接、4.0m 陡坎短齿线、子步限幅高斯核推拉 applyContourWarpDrag 与四支笔刷 applySculptBrush；用 node -e 连续跑推拉与笔刷断言零 NaN 零自交，通过后回写 M1 状态。
- 第 3 步（M2 -> T-2.1~2.5）：编写 web/js/hydro_road_engine.js，实现 Catmull-Rom 样条、零沙岛纯净变宽河道与贴岸水纹、湖海与明暗渠（qanat 含 45m 竖井串）、显式棱角岩礁与 solveOrthogonalBridges 正交桥；用 node -e 实测 islands 长度为 0 且桥面主轴正交，通过后回写 M2 状态。
- 第 4 步（M3 -> T-3.1~3.6）：编写 web/js/gacha_zone_engine.js，实现半平面裁剪、有界 2 轮 Lloyd Voronoi 街坊、防自交半平面街坊内缩、固定深度 OBB 沿街切屋、全部 9 类选区编译、512x512 Chamfer SDF + isPolygonSafe 解析复检 + 82% 收缩挽救 + verifyZeroCollisions；用 node -e 跑多组随机种子断言全部冲突计数为 0 且单选区重抽 < 80ms，通过后回写 M3 状态。
- 第 5 步（M4 -> T-4.1~4.5）：编写 web/css/atelier.css、web/index.html、web/js/canvas_renderer.js、web/js/exporter.js；实现完整浅色工坊四区界面、12工具按钮、5检视器标签、14层画家渲染、双遍融合树冠、14类内置+8类自定义真图形图例、1x/2x/3x PNG 与独立矢量 SVG 导出；运行 node --check 全部 JS 文件并实测 buildSVGString 输出合法闭合 SVG，通过后回写 M4 状态。
- 第 6 步（M5 -> T-5.1~5.5）：编写 web/js/app.js，打通视口缩放平移、/api/ping 离线无报错静态降级、全部 12 项交互工具（含偏心菱形柄拖拽、等高线直接推拉、四支笔刷与 Alt 吸管、水路拖拽联动选区零穿模避让、选区悬浮胶囊重抽 R、自定义图例增改盖章、12色槽实时拾色、测距标尺 U、经纬度导入弹窗与全套快捷键）；运行 node --check 校验通过后回写 M5 状态。
- 第 7 步（M6 -> T-6.1~6.6）：
  1) 编写 server.py（支持 --port 默认 8765、只读映射 lake_bed_dem.bin / global_owner.npz / map_lake_mask.npz / rendered_centerlines.npz 提供 /api/terrax-context，以及带安全文件名剥离的 /api/projects）；
  2) 精心构建并校验三套世界观真实精品工程：projects/起点城_Losrumura.worldtown.json（42.51E, 35.19N, 484.9m）、projects/长湖_复市镇.worldtown.json（35.61E, 28.53N, 427.5m，含黑石大疫 exclusion 禁建圈与暗渠哭井）、projects/帕隆_峡谷铁寨.worldtown.json（29.04E, 14.58N, 1662.6m，含陡峡齿线与 7 块显式底礁），并将这三套验证通过的完整工程同步写入 state_and_schema.js 的 getBuiltinPresetProjects() 以保障纯静态离线体验一致；
  3) 编写并运行 tests/verify_headless.mjs（随机 50 组 seed 下全部穿模与河心岛恒为 0）与 tests/verify_backend.py（校验起点城真值 API、示例工程及联跑上层核验候选稿.py 退出码为 0）；
  4) 全部实测通过后，完成 docs/03_执行对照计划表与验收溯源矩阵.md 的 37/37 全部勾选与 5.3 审计日志回填，并将根目录 README.md 顶部工程状态说明更新为 V1.2 全部代码与自动化验收已完成状态。

【三、结项硬性放行命令（必须全部实测退出码为 0 方可结束任务）】
1. node /Users/jrdamocles/code/TERRAX/settlement_studio/tests/verify_headless.mjs
2. /Users/jrdamocles/code/TERRAX/worldbuilding/venv/bin/python3 /Users/jrdamocles/code/TERRAX/settlement_studio/tests/verify_backend.py
3. 扫描确认 settlement_studio/ 下全部代码文件零 TODO 占位符，且 git -C /Users/jrdamocles/code/TERRAX/worldbuilding status --porcelain 输出为空。
```

---

## 第四章 方案二：【分三棒稳健接力提示词（3-Stage Relay Prompts）】

适用场景：担心单轮上下文窗口过长导致模型在后半程简化 UI 或图例细节时，按 **第一棒 -> 第二棒 -> 第三棒** 顺序依次在新会话（或清空上下文后）复制投喂。每棒均通过读写 [03_执行对照计划表与验收溯源矩阵.md](03_执行对照计划表与验收溯源矩阵.md) 实现精确状态交接。

### 4.1 第一棒提示词（Stage 1：`M0 — M3` 几何、等高线、纯净水路与零穿模内核）

```text
你是负责实施 Terrax Settlement Studio（V1.2）的几何与程序化生成内核工程师。当前执行【分三棒接力开发 · 第一棒（Stage 1：里程碑 M0 至 M3）】。工作目录严格限定为：
/Users/jrdamocles/code/TERRAX/settlement_studio/

本棒你只负责完整编写并无头实测以下 4 个零 DOM 依赖的核心算法 ES Module 文件，并回写进度表 M0—M3：
1. web/js/state_and_schema.js（M0：T-0.1 ~ T-0.5）
2. web/js/terrain_engine.js（M1：T-1.1 ~ T-1.5）
3. web/js/hydro_road_engine.js（M2：T-2.1 ~ T-2.5）
4. web/js/gacha_zone_engine.js（M3：T-3.1 ~ T-3.6）
注意：本棒暂不创建 web/index.html、atelier.css、canvas_renderer.js、exporter.js、app.js 与 server.py（留交第二棒与第三棒完成）。

【七条硬性防偷懒护栏（本棒强制执行）】
1. 必先通读三份基线：动笔前必须完整读取 docs/01_BRD_业务需求文档.md、docs/02_PRD_产品需求与技术规格书.md（重点精读第 1、3、4、5、6、7、8、9.1、10.1 章全部公式与代码契约）以及 docs/03_执行对照计划表与验收溯源矩阵.md。
2. 零占位符铁律：严禁写任何 TODO、FIXME、省略号或假桩代码；全部 9 种 ZONE_CONTENT_TYPES 生成分支必须逐一完整实现；严禁使用 Math.random()，统一调用 createRng(seed)。
3. 严守目录隔离：严禁触碰 /Users/jrdamocles/code/TERRAX/settlement_studio/ 以外的任何文件；严禁修改 docs/01、02、04 文档；严禁创建 package.json。
4. 严守精确导出名与无头规范：4 个文件的所有 export 名称与参数必须与 02_PRD 第 1.4 节逐字一致，import 语句写全相对路径与 .js 后缀，模块内严禁访问 window、document 或 localStorage：
   - state_and_schema.js：SCHEMA_VERSION, GRID_N, OBSTACLE_GRID_N, BUILTIN_PALETTES, ZONE_CONTENT_TYPES, BUILTIN_LEGEND_CATALOG, CUSTOM_GLYPH_TYPES, hashSeed, createRng, createUid, encodeSculptDelta, decodeSculptDelta, getActivePalette, createDefaultProject, getBuiltinPresetProjects, normalizeProject, serializeProject, deserializeProject, syncLegendWithProject, HistoryManager
   - terrain_engine.js：buildElevationField, sampleElevation, sampleGradient, sampleSlopeDeg, evalTerrainShape, evalRiverCarve, extractContours, extractScarpTicks, buildTerrainPackage, hitTestContourLine, applyContourWarpDrag, applySculptBrush
   - hydro_road_engine.js：sampleCatmullRom, polylineLength, closestPointOnSegment, closestPointOnPolyline, buildRiverGeometry, buildWaterBodyGeometry, buildCanalGeometry, buildReefGeometry, buildRoadGeometry, solveOrthogonalBridges, buildHydroRoadPackage
   - gacha_zone_engine.js：computePolygonAreaSigned, computePolygonAreaHa, computePolygonCentroid, pointInPolygon, segmentsIntersect, segmentToSegmentDist, clipPolygonHalfPlane, computeVoronoiCells, insetConvexPolygon, buildObstacleGrid, sampleObstacleClearance, isPolygonSafe, compileSingleZone, compileAllZones, verifyZeroCollisions, compileSettlementScene, rerollZoneSeed
5. 严守核心算法红线：
   - BG-01 零穿模：严格实现 512x512 双遍 Chamfer SDF（buildObstacleGrid）+ 全顶点/边中点/全边段精确解析复检（isPolygonSafe）+ 82% 收缩挽救 + 独立审计 verifyZeroCollisions，确保 buildingRoadHits === 0 && buildingWaterHits === 0 && buildingWallHits === 0 && buildingBuildingHits === 0 && buildingExclusionHits === 0；跨河自动求解正交桥梁（长 W_river+8m，宽 road.widthM+3m，命中渡口 fords 豁免）；
   - BG-02 纯净河道：buildRiverGeometry 严禁生成任何自动河心小岛（islands 恒为空数组 []），仅 buildReefGeometry 按显式 reefs 生成硬朗 5-7 边形棱角岩礁；
   - BG-03 & BG-05 等高线内核：严格实现偏心椭圆二次正根有效半径核（峰值导数为 0 无尖刺）、山脊/冲沟/陡坎左右独立坡宽、16状态渐近中心消歧 Marching Squares、网格边键哈希拼接平滑、子步限幅高斯核推拉 applyContourWarpDrag（永不打结自交）与四支涂抹笔刷；彻底禁画蝌蚪尖刺纹（showScarpTicks 默认 false，开启时仅产 4.0m 下坡垂直短齿线）；
   - 不做单栋房屋增删改数据逻辑，9 类选区采用半平面裁剪 + 有界 2 轮 Lloyd Voronoi + 防自交半平面街坊内缩 + 固定深度 OBB 沿街切屋（绝无死循环）。
6. 如需辅助校验脚本，Python 统一使用 /Users/jrdamocles/code/TERRAX/worldbuilding/venv/bin/python3，Node 直接使用系统 node。
7. 逐阶段实测回写：每完成 M0、M1、M2、M3 中的一个模块，必须立即用 node --input-type=module -e 运行真实断言测试（特别是 M3 完成后必须实测随机 50 组 seed 下 verifyZeroCollisions 返回 passed === true 且全部冲突与河心岛计数恒等于 0，9 种选区全部正常产出，单选区 rerollZoneSeed < 80ms），确认通过后立即将 docs/03_执行对照计划表与验收溯源矩阵.md 中 T-0.1 至 T-3.6 及 5.3 审计表中 M0—M3 行更新为 [x] 已完成并填入详细实测数据，顶部总进度更新为 21 / 37。

完成 M0—M3 全部代码、Node 实测零报错与对照表回写后，输出第一棒完成摘要并停下等待第二棒指令。
```

### 4.2 第二棒提示词（Stage 2：`M4 — M5` 浅色纸本测绘工坊前端、渲染导出与全工具交互）

```text
你是负责实施 Terrax Settlement Studio（V1.2）的制图渲染与交互前端工程师。当前执行【分三棒接力开发 · 第二棒（Stage 2：里程碑 M4 至 M5）】。工作目录严格限定为：
/Users/jrdamocles/code/TERRAX/settlement_studio/

【第一步：断点读取与前置接口校验】
1. 依次完整读取 docs/01_BRD_业务需求文档.md、docs/02_PRD_产品需求与技术规格书.md（重点精读第 1、2、5.1、7.1、9、10、11.3 章）以及 docs/03_执行对照计划表与验收溯源矩阵.md，确认 M0—M3（T-0.1 至 T-3.6）均处于 [x] 已完成状态。
2. 只读检查磁盘上已落盘的 web/js/state_and_schema.js、terrain_engine.js、hydro_road_engine.js、gacha_zone_engine.js 实际导出的函数签名，确保你在本棒编写的前端模块与既有内核 100% 严丝合缝对接。

【本棒专属交付范围（M4 至 M5）】
1. web/css/atelier.css（M4：T-4.1）
2. web/index.html（M4：T-4.1）
3. web/js/canvas_renderer.js（M4：T-4.2 ~ T-4.4）
4. web/js/exporter.js（M4：T-4.4 ~ T-4.5）
5. web/js/app.js（M5：T-5.1 ~ T-5.5）
注意：本棒暂不创建 server.py、projects/*.worldtown.json 与 tests/*（留交第三棒完成），但 app.js 必须完整实现无后端静态打开时的离线降级正常运行与 /api/terrax-context、/api/projects 的前端调用对接逻辑。

【七条硬性防偷懒护栏（本棒强制执行）】
1. 必先通读三大基线文档与既有 M0—M3 源码后再动笔。
2. 零占位符与零敷衍：严禁在 HTML、CSS、Canvas 渲染器、SVG 导出器或 12 个交互工具状态机中留下任何 TODO、空分支或未绑定事件按钮。
3. 严守目录隔离：严禁触碰 /Users/jrdamocles/code/TERRAX/settlement_studio/ 以外的任何文件；严禁抄袭或引用 /Users/jrdamocles/code/TERRAX/worldbuilding/ 下的任何文件；严禁修改 docs/01、02、04 文档。
4. 严守精确导出名：
   - canvas_renderer.js 必导出：createViewport, worldToScreen, screenToWorld, zoomViewportAtScreenPoint, fitViewportToWorld, renderMergedTreeCanopy, drawLegendGlyphCanvas, renderSceneToCanvas
   - exporter.js 必导出：renderOffscreenPNGCanvas, exportPNGDataURL, downloadPNG, buildLegendGlyphSVG, buildSVGString, downloadSVG, downloadProjectJSON, readProjectJSONFile（其中 buildSVGString 必须纯字符串拼接、零 DOM 依赖，支持 Node 直接调用）
   - app.js 必导出：createStudioApp（并在浏览器 DOMContentLoaded 时自动挂载）
5. 严守四大视觉与交互红线：
   - BG-06 全新「浅色纸本测绘工坊」UI：atelier.css 必须原样包含 02_PRD 第 2.1 节全部 :root CSS 变量（桌面 #f4f1ea、面板 #faf8f3、卡片 #efeae0、黄铜边框 #d5cdbd、松针绿 #365942、陶土红 #b55838 及长音符兼容字体栈），构筑顶栏 #topbar、左侧 12 工具坞 #tool-dock、中央视口 #viewport-wrap（含悬浮抽卡胶囊 #zone-floating-hud）、右侧 5 标签检视器 #inspector 与底部实时状态栏 #statusbar（含 ✓ 零穿模核验绿灯）；
   - Watabou 14 层画家渲染与双遍融合树冠：严格按 02_PRD 第 10.2-10.3 章绘制羊皮纸底纹、田垄盐池、无尖刺等高线、纯净水纹、显式暗礁、明暗渠、双遍融通道路、正交桥梁、东南微阴影屋宇、城垣敌台，以及三步双遍融合树冠（阴影 + 外廓 r+1.8m + 叶面 r，彻底消除树丛内部交叉黑圈）；
   - BG-05 真实微缩图形图例：drawLegendGlyphCanvas 与 buildLegendGlyphSVG 必须在 28x18px 内完整绘制全部 14 类内置微缩制图结构（内城双屋、村舍曲尺院配小树、带敌台城墙、双边白路、跨水正交桥、带水纹河带、湖海内纹、明渠竖井、计首双棕线、4px陡坎垂齿、斜垄梯田、2x2盐池、三圆融合绿云朵、五边形碎波礁石）与 8 类自定义地标徽记，严禁用单色圆点代替；完整打通图例改名、改色、显隐、排序、四角停靠与 [+ 新增自定义图例符号] + M 工具盖章闭环；
   - 全工具闭环且严禁单栋房屋增删改：完整打通全部 12 工具（V 选择与偏心菱形柄/顶点编辑、C 等高线直接捏住拖拽推拉、B 四支涂抹笔刷与 Alt 吸管、H 山包盆地、G 山脊冲沟陡坎、W 纯净河流、L 湖海水渠、K 岩礁与渡口切换、D 三级道路、Z 多边形抽卡选区与 R 键秒级原地重抽、M 地标戳记、U 测距高差标尺）及拖拽水路时选区动态避让重编、HistoryManager 单步合并撤销重做、4套主题+12色槽实时拾色、1x/2x/3x full/clean PNG 与 SVG 导出；严禁出现任何单栋房屋手动增删改控件。
6. Python 环境如使用统一为 /Users/jrdamocles/code/TERRAX/worldbuilding/venv/bin/python3。
7. 实测与回写对照表：对 web/js/ 下全部 7 个 JS 文件执行 node --check 确认零语法错误，并用 node --input-type=module -e 实测视口不动点缩放、syncLegendWithProject 与 buildSVGString（校验包含 <svg、trees-outline、trees-fill、图例框与闭合 </svg>）；确认通过后立即更新 docs/03_执行对照计划表与验收溯源矩阵.md 中 T-4.1 至 T-5.5 及 5.3 审计表中 M4—M5 行为 [x] 已完成，顶部总进度更新为 31 / 37。

完成 M4—M5 全部代码、实测校验与对照表回写后，输出第二棒完成摘要并停下等待第三棒指令。
```

### 4.3 第三棒提示词（Stage 3：`M6` 本地 Python 服务端、三大精品示例工程与端到端总核验）

```text
你是负责实施 Terrax Settlement Studio（V1.2）的地理数据桥接后端与总验收工程师。当前执行【分三棒接力开发 · 第三棒收官战（Stage 3：里程碑 M6 与全工程总核验）】。工作目录严格限定为：
/Users/jrdamocles/code/TERRAX/settlement_studio/

【第一步：断点读取与前序资产核查】
1. 依次读取 docs/01_BRD_业务需求文档.md、docs/02_PRD_产品需求与技术规格书.md（重点精读第 11 章 FR-10.1 至 FR-10.5 全部 Python 读取公式、REST 契约、三套示例规格与验收断言）以及 docs/03_执行对照计划表与验收溯源矩阵.md，确认 M0—M5（T-0.1 至 T-5.5，共 31 项）均已完成。
2. 检查 web/ 下 HTML、CSS 与 7 个 JS 模块完备性。

【本棒专属交付范围（M6：T-6.1 至 T-6.6）】
1. server.py（支持 --port 默认 8765、--host 默认 127.0.0.1；托管 web/ 静态资源；提供 GET /api/ping、GET /api/terrax-context、GET /api/projects、GET /api/projects/<filename>、POST /api/projects）
2. 三套世界观真实精品零穿模示例工程（同时同步更新内嵌进 web/js/state_and_schema.js 的 getBuiltinPresetProjects()，确保离线直开与服务端读取完全一致）：
   - projects/起点城_Losrumura.worldtown.json（42.51E, 35.19N，真值 484.9m，图幅 3200m，watabou_classic 主题：北侧东南向西北流 R1966 纯净变宽大河、高阶台坎、东关饮用净水明渠与排污碱渠、P1 坡冈换装主干驿道与跨河正交木石大桥、walled_city 砾基夯土内城、citadel 三木合契议事厅与高阶公仓、town_blocks 西坡老榆梁客舍换装街区、market 南门灰粪柴市、farmland 河阶条田，以及东关总分水堰、司辰河衡官坛、北埠浅船滑道坞地标）
   - projects/长湖_复市镇.worldtown.json（35.61E, 28.53N，真值 427.5m / 湖岸 414m，图幅 2600m，arid_oasis 主题：东北侧 L6 半咸水湖湾、西坡缓倾等高线、西北角前 405 年黑石大疫 exclusion 禁建界圈、西坡 qanat 伊珂免税暗渠与第三竖井哭井、东西两片 town_blocks 互市坊巷、湖滨 market 盐鱼互市坪、saltpan 晒盐卤畦、farmland 灌区条田及西井母共祭祠等地标）
   - projects/帕隆_峡谷铁寨.worldtown.json（29.04E, 14.58N，真值 1662.6m / 谷底约 1650m，图幅 1400m，nordic_fjord 主题：南北两条非对称山脊夹峙深切 V 形停战峡谷且开启 showScarpTicks: true、中央纯净急溪并在暗梁渡口显式点放 7 块花岗岩底礁 reefs、跨溪正交廊桥与盘山石道、南北两岸窄阶地各一片 village 顺坡散居铁寨选区 maxSlopeDeg: 28 使两侧陡崖自动零建房、山腰 woodland 薪炭林及水力锻锤铁坊、停战线哨塔望碉地标）
3. tests/verify_headless.mjs（前端无头全量自动化核验脚本）
4. tests/verify_backend.py（后端地理真值 API 与仓库既有文件零侵入核验脚本）
5. 更新 docs/03_执行对照计划表与验收溯源矩阵.md（完成 37/37 全部勾选与 5.3 审计日志）及根目录 README.md 工程状态声明。

【七条硬性防偷懒护栏（收官强制执行）】
1. 必先精读 02_PRD 第 11.2 节的 TERRAX 二进制地理数据精确路径与行列换算公式（lonlat_to_rowcol、lake_bed_dem.bin shape=(3000,6000) dtype="<f4"、global_owner.npz、map_lake_mask.npz、rendered_centerlines.npz）。
2. 零占位符与精品示例高水准要求：三套 .worldtown.json 示例工程严禁只放三四个简陋方块应付，必须用 compileSettlementScene 实测校准坐标，使起点城屋宇数 >= 200 且水陆城坊层次饱满、三套工程 collisionReport.passed 全部恒为 true。
3. 绝对零侵入仓库外部文件：server.py 对 /Users/jrdamocles/code/TERRAX/地图/ 下的全部数据文件仅允许以 mode="r" 只读打开，POST /api/projects 必须用 Path(filename).name 剥离路径并限定落盘于 projects/；verify_backend.py 测试保存接口后必须清理临时文件，严禁污染世界观目录或 worldbuilding/。
4. 严守前序模块导出契约：更新 state_and_schema.js 内置预设时严禁破坏任何既有 export 函数签名。
5. 严守 BG-01 至 BG-08 全部一票否决门禁：
   - verify_headless.mjs 必须覆盖：Schema/Base64 误差 <= 0.051m、HistoryManager 40步栈、连续等高线推拉与 4 种笔刷无 NaN 无跨高程自交、9 类 ZONE_CONTENT_TYPES 全部有效且单区重抽 < 80ms、在综合压测场景及全部 3 套示例工程上循环跑随机 50 组 seed 且每轮强制断言 buildingRoadHits === 0 && buildingWaterHits === 0 && buildingWallHits === 0 && buildingBuildingHits === 0 && buildingExclusionHits === 0 && riverIslands === 0、图例同步与 buildSVGString 完整性；
   - verify_backend.py 必须覆盖：自动拉起临时空闲端口 server.py 子进程（finally 确保回收）、校验 /api/ping、校验 /api/terrax-context?lon=42.51&lat=35.19&span_m=2800 返回 row == 913, col == 3708, abs(elevM - 484.9) < 1.0, isLand == True 且检出 R1966、校验 /api/projects 三套示例可读、校验 git -C /Users/jrdamocles/code/TERRAX/worldbuilding status --porcelain 为空、以及调用上层 /Users/jrdamocles/code/TERRAX/候选工作区/20261116_B大陆文化与历史/核验候选稿.py 断言退出码严格为 0。
6. Python 统一强制使用 /Users/jrdamocles/code/TERRAX/worldbuilding/venv/bin/python3。
7. 实测闭环与文档收官：若核验脚本发现任何一处碰撞或边界偏差，必须立即定位修复对应源码或示例工程并重跑直至退出码为 0；全部通过后更新 docs/03_执行对照计划表与验收溯源矩阵.md（T-6.1~T-6.6 全部标 [x] 已完成，总进度改为 37 / 37，填齐 5.3 审计日志表），并将 settlement_studio/README.md 顶部的“待执行编码状态”更新为“V1.2 已完成全量编码与自动化双端验收”。
```

---

## 第五章 附：中途会话截断续跑补丁提示词（Session Resume Prompt）

若在运行方案一或方案二某棒期间，因单次会话输出上限或网络波动导致模型中途停止，无需重头再来，直接复制下方短提示词投喂即可精准续接：

```text
请继续执行 Terrax Settlement Studio（/Users/jrdamocles/code/TERRAX/settlement_studio/）的未完成开发任务：
1. 先读取 docs/03_执行对照计划表与验收溯源矩阵.md 与 docs/02_PRD_产品需求与技术规格书.md，并检查 settlement_studio/ 当前已落盘的文件列表及最后修改文件的完整性（确认无半截截断代码或 TODO 占位符）。
2. 从 docs/03_执行对照计划表与验收溯源矩阵.md 中第一个状态仍为 [ ] 待执行 的原子任务节点开始继续向后实施，严格保持全部 7 条防偷懒护栏（精确对齐 02_PRD 第 1.4 节 export 签名、零穿模 BG-01、零河心沙岛 BG-02、无蝌蚪尖刺且真图形图例 BG-05、浅色测绘工坊 UI BG-06、不做单栋房屋增删改、统一使用 /Users/jrdamocles/code/TERRAX/worldbuilding/venv/bin/python3、严禁触碰 settlement_studio/ 以外文件）。
3. 每完成一个阶段务必先跑终端命令实测通过，再回写更新 docs/03_执行对照计划表与验收溯源矩阵.md 的 [x] 已完成状态与实测记录，直至当前目标阶段全部核验通过。
```
