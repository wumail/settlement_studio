# Settlement Studio V6.0 — DeepSeek V4.1 Flash 两棒接力执行提示词

| 文档属性 | 规范内容 |
| :--- | :--- |
| **适配模型** | `deepseek v4.1 flash`（建议分 2 棒在独立新会话依次投喂） |
| **工作目录** | `/Users/wumail/code/TERRAX/settlement_studio/` |
| **上游规格书** | [13_V6_Watabou有机街坊_合院尺度与自然林冠升级规格书.md](13_V6_Watabou有机街坊_合院尺度与自然林冠升级规格书.md) |
| **核心红线** | 单文件严格 `<= 320` 行；零新增依赖；零外部世界观耦合；既有 9 个测试文件 100% 全绿 |

> **使用方式**：先复制 **第 1 棒提示词** 投喂给 DeepSeek V4.1 Flash；第 1 棒跑通 `npm run check && npm run build` 后，再开新会话投喂 **第 2 棒提示词**。

---

## 第 1 棒提示词（阶段一：Watabou 宅基地递归剖分 + 可见街巷 + 合院 `courtyard` + 去虚线框场坪）

```text
你是负责实施 Settlement Studio V6.0 的资深计算几何与程序化城市生成架构师。
当前执行【V6.0 两棒接力 · 第 1 棒（有机街坊递归剖分 + 合院尺度重构 + 场坪修复：V6-1 ~ V6-3）】。
工作目录严格限定为：/Users/wumail/code/TERRAX/settlement_studio/

【一、开工必读】
写任何代码前，请先完整读取：
1. /Users/wumail/code/TERRAX/settlement_studio/docs/13_V6_Watabou有机街坊_合院尺度与自然林冠升级规格书.md（重点精读第 0、1、2 章）
2. 必读现有相关文件，掌握既有契约与测试边界：
   - src/core/generators/{townBlocks,walledCity,village,customStructures}.ts
   - src/core/compilePipeline.ts、src/schema/{entity.schema,v3.entity.schema}.ts
   - src/renderer/{paintContext,paintScene,paintAuthored,paintLand,paintStructures}.ts
   - src/ai/{opSchemas,spatialAnalyze}.ts
   - tests/v5-realism-and-scale.test.ts（重点看 T5、T6、T7、T8 的硬指标边界！）

【二、本棒交付目标（V6-1 ~ V6-3）】
1. Watabou 式街块递归剖分与可见次级巷道（V6-1）：
   - 新建 src/core/generators/lotSubdivision.ts（严格 <= 320 行）：
     (a) 实现主轴最小包围盒估算与 subdivideBlockIntoLots：对街块多边形按较长主轴法向递归二分（切分比 0.38..0.62，块较大时法向带 ±3.2° 微扭转、末级带 ±1° 微扭转），直至叶节点面积落入目标区间；
     (b) 识别每个叶节点紧贴母街块外轮廓的临街边（中点距母块边 < 1.6m 且长 >= 5.0 * scale）；无临街边的内部叶节点归入 courtyardPolys 留作内院；
     (c) 实现 buildLotFootprint 三档重尾屋面生成（S 紧凑小铺 ~55% 进深 6.0–8.6m、M 标准商宅 ~35% 进深 8.2–11.4m、L 街口大宅/曲尺院 ~10% 进深 10.2–13.0m，均乘 scale）：直接用平行于临街边的半平面裁剪 lot 多边形并微缩邻墙间隙（0.35–0.55m * scale），使街角自然生成贴合路口的梯形/微楔形屋面，相邻山墙平行紧咬！
   - 升级 src/core/generators/townBlocks.ts：
     (a) compileTownBlocksZone 外边界退界由 6.0m 收紧至 1.8m；
     (b) 废除逐栋随机跳过的麻子脸逻辑：改为整块/外环级平滑衰减（沿主干道 dRoad <= 34m 保持连续临街带，仅在远离干道且 radial > 0.66 的外缘块渐疏）；
     (c) 提取干净的内部街巷折线（避开主干道与选区外框及 holes）推入 targetResult.internalStreets；
     (d) 严格调校参数，确保 tests/v5-realism-and-scale.test.ts 的 T5（20ha walled_city 产出 240–520 栋、均面积 80–260 m²、重抽 < 250ms）与 T8（D203 边镇 >= 260 栋）100% 稳定通过！
   - 补绘次级巷道（src/renderer/paintLand.ts 的 paintLanes）：先画细淡路缘再画 pal.roadFill 街面（宽 ~3.6m），让街坊巷网清晰可见。
   - 微调 src/core/generators/village.ts：保持 compact 迷你营地逻辑 100% 不变（严禁影响 T6 与 D203 营地！）；仅在非 compact 普通村落模式下增加正房三档尺寸错落与 ±4° 随路微摆。

2. 合院建筑群 courtyard 原语与翼楼物理进深硬约束（V6-2）：
   - 在 src/schema/v3.entity.schema.ts 将 STRUCTURE_KINDS 扩充为 ['rect', 'l_hall', 'u_court', 'round_altar', 'courtyard']（UI 检视器/工具栏若有枚举映射同步补齐 '合院建筑群'）；
   - 在 src/core/generators/customStructures.ts：
     (a) 锁死 lHallPoints 与 uCourtPoints 翼楼物理厚度上限 <= 12.5m..13.0m（消除 80m 巨型实心砖块感）；
     (b) 实现 kind === 'courtyard'：产出 yardPolygon（院坪）、带南向正门豁口的 wallPolylines（实线矮院墙）、北侧正堂 polygon（进深 <= 11.5m）及东西独立厢房/南门房 extraPolygons（进深 <= 8.2m，与正堂留 2.2m 火巷）；
   - 在 src/core/compilePipeline.ts 的 collectRigidPolys 中，将 courtyard 的 yardPolygon 注入刚性障碍，防止民房长入客舍院内；
   - 在 src/renderer/paintStructures.ts 中完整绘制 courtyard 的院坪铺地、实线矮院墙及全部主附屋顶、阴影与屋脊；
   - 在 src/ai/spatialAnalyze.ts 的 collectWarnings 中：仅对 kind !== 'courtyard' && kind !== 'round_altar' 且 Math.min(widthM, depthM) > 32 的超大实心单体提示改用 courtyard（确保既有预设与 D203 最大 42×30 零误报！）。

3. 消除导出态 plain 虚线框穿帮 + 新增 enclosure 围栏场坪（V6-3）：
   - 在 src/schema/entity.schema.ts 将 ZoneExclusionStyles 扩充为 ['plague_stones', 'meadow', 'marsh', 'plain', 'enclosure']（UI 下拉若有映射同步补齐 '围栏场坪'）；
   - 在 src/renderer/paintContext.ts 的 PaintContext 新增 isExport: boolean 并在 paintScene.ts 传入 Boolean(options.isExport)；
   - 在 src/renderer/paintLand.ts 的 paintExclusion 中：
     * style === 'plain'：当 ctx.isExport === true 时完全不画任何虚线或填充；编辑态（!ctx.isExport）仅画 0.28 低透明辅助虚线；
     * style === 'enclosure'：绘制淡暖土压实铺地 + 细实线矮墙边（无虚线）。

【三、硬性工程护栏】
1. src/ 下每个 .ts/.tsx 文件物理行数严格 <= 320 行；零 any / as any / @ts-ignore / TODO / FIXME；src/core/ 与 src/ai/ 严禁 Math.random()；严禁新增 npm 包。
2. 解耦红线：src/ai、src/cli、src/mcp 与 .agents/skills 严禁出现任何世界观路径或预设专名（T7 静态守卫必须通过）。
3. 严禁修改 legacy_v1_js/、docs/、受保护基准工程文件及 settlement_studio/ 以外文件。
4. 完成后依次执行并确认全部退出码为 0：
   - npm run check
   - npm run build
   - 全目录 src/**/*.ts(x) 行数扫描确认最大行数 <= 320。
```

---

## 第 2 棒提示词（阶段二：Watabou 多瓣云朵树冠 + 林下底衬与团簇林地 + 分级街区字标 + V6 验收测试）

```text
你是负责实施 Settlement Studio V6.0 的资深制图渲染与视觉美学工程师。
当前执行【V6.0 两棒接力 · 第 2 棒（多瓣云朵树冠 + 团簇林地底衬 + 分级字标排版 + 全套测试：V6-4 ~ V6-6）】。
工作目录严格限定为：/Users/wumail/code/TERRAX/settlement_studio/

【一、开工必读】
写任何代码前，请先完整读取：
1. /Users/wumail/code/TERRAX/settlement_studio/docs/13_V6_Watabou有机街坊_合院尺度与自然林冠升级规格书.md（重点精读第 3、4、5 章）
2. 读取第 1 棒已完成的 src/core/generators/{lotSubdivision,townBlocks,woodland,farmland,customStructures}.ts 与 src/renderer/{paintLand,paintScene,paintAuthored,paintAnnotations}.ts。

【二、本棒交付目标（V6-4 ~ V6-6）】
1. 多瓣融合云朵树冠与林地团簇化（V6-4）：
   - 升级 src/renderer/paintLand.ts 的 paintTrees（如行数接近 320 行请拆出 src/renderer/canopyLobes.ts，严守 <= 320 行）：
     * 对每棵树 (x, y, r) 用确定性坐标整数哈希展开为多瓣圆（r >= 3.2 时 1 中心核 0.72r + 4 偏心叶瓣 0.48..0.62r，偏心距 0.34..0.46r；r < 3.2 时 1 核 + 2 微瓣），统一送入三遍 drawCirclesMergedPass（阴影 → pal.treeOutline → pal.treeFill），使单树呈自然分叶云朵形、近邻树自动布尔融合成团！
   - 新增林下草甸底色 paintWoodlandUnderstory(ctx, zoneId?) 并在 paintScene.ts 与 paintAuthored.ts 的土地底纹层接入：对 contentType === 'woodland' 选区铺一层柔和浅苔绿底色（mixHex(pal.treeFill, pal.paperBg, 0.78), fillOpacity: 0.46）；
   - 重写 src/core/generators/woodland.ts 的 compileWoodlandZone：以团簇核（步距 15 + (1 - density) * 9）为单位，每核紧簇排布 3–5 棵交叠树（半径 4.0..7.2m，圆心距保证融合）并在核间散落少量林缘小树，全部经 guardSafeTree 守卫（彻底告别孤立绿波点阵，同时确保 T8 各预设 trees > 80 及迷你营地 T6 树不压屋断言 100% 通过！）；
   - 微调 src/core/generators/townBlocks.ts 中庭植树（在内院紧簇种 2–4 棵相距 3.2–5.5m 的院树融合成荫）与 src/core/generators/farmland.ts 的 plantHedgerows（树距收紧为 3.4–5.4m 使护田林带连成绿篱）。

2. 分级地图字标排版（V6-5）：
   - 升级 src/renderer/paintAnnotations.ts（仅调整 standard 模式下的选区标注，guided 与 pure 模式逻辑保持不变）：
     * contentType === 'exclusion' && exclusionStyle === 'plain' 的无痕留白选区在导出态不自动画选区标签；
     * 对面积 >= 1.8 ha 的 walled_city / citadel / town_blocks / market 街区，采用大号宽字距衬线暗标（字号 12–14.5px，<=6 字纯中文名插入窄空格拉开字距，颜色 mixHex(pal.inkDark, pal.paperBg, 0.32)，opacity * 0.76，haloWidthPx: 3.0），与 10.5px 带徽记的具体地标形成鲜明主次层级。

3. V6 专项测试与实跑视觉冒烟验证（V6-6）：
   - 新建 tests/v6-organic-fabric.test.ts，完整覆盖规格书第 5 章全部 6 类断言：
     (1) 斜交街块递归剖分产出贴角梯形屋面 + 三档面积分化（maxArea/minArea >= 2.6）+ 零碰撞；
     (2) internalStreets 在导出 SVG 中真实绘出路径；
     (3) 60×48 courtyard 合院产出院坪、带门围墙与多栋短边 <= 13.5m 的厅厢且民房零侵入，80×64 u_court 翼深 <= 12.5m 且触发超尺度告警；
     (4) plain 禁建区导出态零虚线，enclosure 导出态含实线围栏与铺地；
     (5) 多瓣树冠圆弧融合与 woodland 林下底色输出；
     (6) 全量预设与 D203 零穿模零回归。

【三、硬性工程护栏】
1. src/ 下每个 .ts/.tsx 文件物理行数严格 <= 320 行；零 any / as any / @ts-ignore / TODO / FIXME；src/core/ 与 src/ai/ 严禁 Math.random()；严禁新增 npm 包。
2. 解耦红线：src/ai、src/cli、src/mcp 与 .agents/skills 严禁出现任何世界观路径或预设专名。
3. 完成后依次执行并确认全部退出码为 0：
   - npm run check
   - npm run build
   - 全目录 src/**/*.ts(x) 行数扫描确认最大行数 <= 320
   - 用 npm run studio -- render 对既有工程渲染一张临时 PNG 验证视觉无报错并清理临时文件。
```
