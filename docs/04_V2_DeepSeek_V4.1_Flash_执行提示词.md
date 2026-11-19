# Terrax Settlement Studio V2.0 — DeepSeek V4.1 Flash 专用执行提示词

| 文档属性 | 规范内容 |
| :--- | :--- |
| **项目与版本** | `Terrax Settlement Studio V2.0（TypeScript + AI 原生工程化升级版）` |
| **文档落盘路径** | `/Users/jrdamocles/code/TERRAX/settlement_studio/docs/04_V2_DeepSeek_V4.1_Flash_执行提示词.md` |
| **上游规格基线** | [01_BRD_V2_TypeScript工程化业务需求文档.md](01_BRD_V2_TypeScript工程化业务需求文档.md) · [02_PRD_V2_TypeScript架构与模块技术规格书.md](02_PRD_V2_TypeScript架构与模块技术规格书.md) · [03_V2_执行对照计划表与验收溯源矩阵.md](03_V2_执行对照计划表与验收溯源矩阵.md) · [../README.md](../README.md) · [../legacy_v1_js/README.md](../legacy_v1_js/README.md) |
| **只读对拍基准** | `/Users/jrdamocles/code/TERRAX/settlement_studio/legacy_v1_js/`（已通过 `177 + 53` 项终审验收的 V1.2.2 纯 JS 黄金归档） |
| **适配目标模型** | `deepseek v4.1 flash`（兼容自主终端 Agent 模式、四棒分段接力模式及断点续跑工作流） |

---

## 第 1 章 针对 `deepseek v4.1 flash` 在 TS/React/Vite 工程下的防呆设计依据与投喂模式选型表

### 1.1 模型特性诊断与 TS 现代工程栈六大防呆依据

基于 V1.2 原生 JS 三轮开发与独立审查的真实样本，`deepseek v4.1 flash` 具备优秀的数学公式实现能力与高吞吐编码速度，但在跨数十个模块构建 `React 19 + TypeScript 5.8 + Vite 6 + Zustand (immer + zundo) + Zod + Tailwind CSS v4 + Web Worker` 工程时，若提示词缺乏精确锁死，极易出现以下六类典型工程偏差：

1. **包管理交互挂起与配置漂移（对应 `V2-R01 / V2-R02`）**：
   - 本机开启 Corepack 时，裸跑 `pnpm install` 可能因首次下载签名确认提示而阻塞非交互终端；同时大模型训练语料中 Tailwind v3 占比较高，若不显式禁令，极易手写废弃的 `tailwind.config.js` 或 `@tailwind base;`，与 `@tailwindcss/vite` v4 插件冲突报错。
   - **防呆对策**：强制逐字复制 `02_PRD_V2` 第 2 章锁定的配置文件，统一使用 `COREPACK_ENABLE_DOWNLOAD_PROMPT=0 pnpm install`（沙箱或网络受限时回退 `npm install`），显式锁定 `@import "tailwindcss";` 与 `@theme` 语法。

2. **Zustand + Immer + Zundo 泛型签名与高频撤销失灵（对应 `V2-R03`）**：
   - 在 `zundo@^2.3.0` 中，`temporal` 中间件函数自身的第 2、3 个泛型参数是内部变异器元组 `Mps / Mcs`，误写 `temporal<StudioState, Pick<...>>` 会直接触发 `TS2344` 编译红错；必须显式声明 `const temporalOptions: ZundoOptions<StudioState, StudioHistorySlice> = { limit: 50, partialize: ... }`（`StudioHistorySlice = Pick<StudioState, 'project'>`）交由 `temporal(immer(...), temporalOptions)` 自动推导；此外滑块与画布连续拖拽若未调用 `pause() / resume()`，会产生数十条碎步快照甚至导致撤销失效。
   - **防呆对策**：在提示词中硬性规定 `ZundoOptions<StudioState, StudioHistorySlice>` 精确泛型范式、`M0` 阶段 `compiledScene: CompiledSceneBase | null` 解耦初始态，以及 `beginContinuousEdit() / endContinuousEdit()` 成对包裹契约。

3. **单文件膨胀、尾段省略与 `as any` 逃逸（对应 `V2-R04 / V2-BG-01~03`）**：
   - 当单个文件超过 `400` 行时，Flash 模型容易在后半段使用 `// TODO`、注释省略号，或用 `as any` 绕过 `noUncheckedIndexedAccess` 数组越界检查及 `SafeBuilding` 品牌守卫。
   - **防呆对策**：实施微模块硬上限（`src/` 下每个 `.ts/.tsx` 严格 `<= 320` 行，9 种选区各自独立成 100—250 行小文件），并用 `biome lint` 封死 `noExplicitAny: "error"`，将代码格式化独立为 `npm run format` 避免空格风格误阻断门禁。

4. **Web Worker 在 Vitest Node 环境下的未定义崩溃（对应 `V2-R05`）**：
   - Vitest 运行在 `environment: 'node'` 高速模式下，全局不存在浏览器 `Worker` 构造器。
   - **防呆对策**：强制 `sceneCompilerClient.ts` 实现双模客户端——检测 `typeof Worker !== 'undefined'` 时启用 ES Module Worker 与 `requestId` 抢占，否则自动回退同步调用 `compileSettlementScene`。

5. **Canvas 与 SVG 双份平行渲染代码漏改（对应 `V2-BG-04`）**：
   - V1.2 中多次发生「Canvas 修了双遍道路或图例改色，但 SVG 导出器漏改」的不一致问题。
   - **防呆对策**：强制通过 `RenderBackend` 抽象接口实现同源双端渲染——14 层地图绘制逻辑只在 `paintScene.ts` 写一遍，22 类微缩结构图例只在 `paintLegendGlyph.ts` 写一遍。

6. **重踩 V1.2.2 历史八大几何与交互边界陷阱（对应 `V2-R06`）**：
   - 从头重写几何代码若不对照 `legacy_v1_js/` 已验证公式，容易重现 `sx/rx` 城墙交点笔误、急折角水渠漏声明 `halfWidths`、斜交桥两角落水、`terrainShape` 截胡 `zone` 点击等隐蔽缺陷。
   - **防呆对策**：在每套提示词中显式嵌入「V1.2.2 历史八大易错点防回归清单」，并允许模型以只读方式查阅 `legacy_v1_js/` 中已通过 `177 + 53` 项终审的几何实现。

### 1.2 三套标准投喂方案选型对比表

| 评估维度 | 方案一：单轮全自动通关总提示词（第 3 章） | 方案二：分四棒高稳健接力提示词（第 4 章） | 方案三：中断恢复 / 审查返修续跑提示词（第 5 章） |
| :--- | :--- | :--- | :--- |
| **适用会话模式** | 开启长时自主 Agent / `/goal` 模式，支持连续数十轮工具调用与终端自检 | 标准 IDE 对话 Agent 模式，希望人工逐棒审阅门禁输出、追求最高一次准确率 | 会话因 Token 上限/网络中断暂停，或独立审查发现局部问题需靶向返修 |
| **覆盖里程碑** | 单次投喂串行闭环 `M0 -> M1 -> M2 -> M3 -> M4 -> M5 -> M6`（`0 -> 38` 项） | **第一棒** `M0+M1`（10 项）-> **第二棒** `M2+M3`（12 项）-> **第三棒** `M4+M5`（11 项）-> **第四棒** `M6`（5 项） | 自动读取 `03_V2` 对照表首个 `[ ] 待执行` 节点或审查问题单精准续跑 |
| **单轮新建模块数** | 全量 `src/` 微模块 + 配置 + `server.py` + 5 套测试 | 每棒严格控制在 `10 — 16` 个小文件以内，上下文注意力最集中 | 仅触碰未完成节点或缺陷关联的 `1 — 4` 个微模块 |
| **门禁同步机制** | 每完成一个 `M` 阶段实跑 `npm run check` 并回写 `03_V2` 对照表 | 每棒收尾强制跑通当棒 Vitest 套件 + 行数扫描并落盘回写 `03_V2` 断点 | 修复前先补单测，修复后跑全套 `npm run check` 与 `verify_backend.py` |
| **推荐等级** | 适合无人值守长程自动通关 | **首选强烈推荐**：微模块饱满度、类型严谨度与一次通过率最高 | 必备应急与闭环返修工具 |

---

## 第 2 章 八条硬性工程护栏总纲（所有执行轮次强制生效）

以下八条工程铁律已完整内嵌至第 3、4、5 章的每一个独立提示词代码块中，开发与验收全程一票否决：

- **护栏 ①（必先通读三大 V2 基线并只读参考 `legacy_v1_js/`）**：动笔写任何代码前，必须依次完整读取 `docs/01_BRD_V2_TypeScript工程化业务需求文档.md`、`docs/02_PRD_V2_TypeScript架构与模块技术规格书.md` 与 `docs/03_V2_执行对照计划表与验收溯源矩阵.md`；在实现复杂几何细节时，可以只读查阅 `legacy_v1_js/` 下已通过终审的 V1.2.2 黄金基准源码与 `projects/*.worldtown.json`，但**严禁修改、移动或删除 `legacy_v1_js/` 内的任何文件**。
- **护栏 ②（逐字锁定脚手架配置与 Corepack/Tailwind v4 防护）**：严格逐字复制 `02_PRD_V2` 第 2 章锁定的 `package.json`、`.npmrc`、`tsconfig.json`、`vite.config.ts`、`biome.json`、`index.html`；安装依赖统一执行 `COREPACK_ENABLE_DOWNLOAD_PROMPT=0 pnpm install`（若环境受限可回退 `npm install`）；样式表 `src/styles/atelier.css` 必须使用 Tailwind v4 原生 `@import "tailwindcss";` 与 `@theme { ... }`，**严禁创建 `tailwind.config.js` / `postcss.config.js` 或书写 `@tailwind base;` 等 Tailwind v3 废弃配置**。
- **护栏 ③（微模块 `<= 320` 行硬红线、零占位、零 `any`、零 `Math.random`）**：`src/` 目录下全部 `.ts/.tsx` 微模块（50 级微模块体系：对应目录树锁定的 `src/` 下全部 `53` 个 `.ts/.tsx` 文件）单文件设计目标 `100 — 300` 行，**硬性上限 `<= 320` 行**（`V2-BG-03`）；所有文件严禁残留 `TODO`、`FIXME`、省略号或假桩返回值；严禁出现任何 `any`、`as any` 或 `@ts-ignore`；确定性生成算法严禁调用 `Math.random()`，统一使用 `src/core/math/rng.ts` 导出的 `createRng(seed)`（`V2-BG-01`）。
- **护栏 ④（编译期 Branded `Safe*` 防穿模锁与两阶段全局城墙前置编译）**：所有屋宇、村寨菜畦篱院、树木必须且只能通过 `src/core/obstacles/guardSafe.ts` 导出的唯一守门函数 `guardSafeBuilding`、`guardSafeFence`、`guardSafeTree` 构造品牌不透明类型 `SafeBuilding`、`SafeFence`、`SafeTree`（严禁类型强转伪造）；`src/core/compileScene.ts` 必须严格执行**两阶段全局编译**——阶段一先遍历全部选区构建所有 `walled_city / citadel` 城垣并写入全局 `ObstacleGrid`（`512×512` 双遍 Chamfer SDF），阶段二再执行 9 类选区内部生成；单选区重抽 `rerollZoneScene` 必须先基于最新水路、城垣与邻区几何构建新鲜障碍上下文（`V2-BG-02 / V2-BG-06`）。
- **护栏 ⑤（同源双端 `RenderBackend` 唯一绘制源）**：地图 14 层画家算法（含双遍无黑叉道路、三步融合树冠、四角智能避让图饰）与 22 类微缩结构图例（14 类内置 + 8 类自定义）必须且只能在 `src/renderer/paintScene.ts` 与 `src/renderer/paintLegendGlyph.ts` 中**编写唯一一遍**，通过 `RenderBackend` 接口同时驱动 `Canvas2DBackend` 与无 DOM 的 `SvgStringBackend`，**严禁为 Canvas 和 SVG 各写一套重复平行绘制代码**（`V2-BG-04`）。
- **护栏 ⑥（严守 V1.2.2 历史八大易错点防回归与 `NG-01` 边界）**：
  1. `wallBuilder.ts`：城墙与道路求交必须使用道路方向向量真实分量 `sx`（严禁误写为 `rx`），敌台与城门按墙段弧长唯一归属，城门沿墙段法向绘出真实厚度；
  2. `riverCanal.ts`：`buildRiverGeometry` 与 `buildCanalGeometry` 均须显式声明 `const halfWidths = new Float64Array(n)` 并做急折角防蝴蝶结限幅，`river.islands` 恒为空数组 `[]`，贴岸水纹展平为 `ReadonlyArray<Polyline>`（严禁四维数组嵌套）；
  3. `reefRoadBridge.ts`：跨河斜交正交桥梁全跨度公式锁定为 `bridgeLength = (riverWidth + 8.0 + (roadWidth + 3.0) * cosAlpha) / Math.max(0.35, sinAlpha)`（命中渡口 `fords` 豁免不生桥），确保锐角斜交时桥面四角全落陆地；
  4. `hitTest.ts`（导出 `hitTestSceneObject` 与 `hitTestActiveHandles`）：画布点击拾取顺序严格固定为 `landmark -> reef -> ford -> canal -> road -> river -> waterBody -> zone -> terrainShape`（**`zone` 必须排在底层 `terrainShape` 之前**）；
  5. `paintLegendGlyph.ts`：函数入口统一提取 `const main = itemColorOverride?.trim() ? itemColorOverride : defaultColor` 并贯穿全部 22 个图例分支，确保自定义改色 22/22 100% 双端生效；
  6. `legend.schema.ts`：`syncLegendWithProject` 对所有满足 `item.isCustom === true` 的自定义图例项强制保持 `item.autoPresent = true`，使新建未盖章自定义图例重编译后恒保持显示；
  7. `obstacleSdf.ts` / `guardSafe.ts`：`obstacleSdf` 严禁对已是半宽的 `halfWidth` 二次乘 `0.5`；`guardSafeBuilding / guardSafeFence / guardSafeTree` 全量拦截 `exclusionPolys` 禁建圈（跨疫圈疏林圈内零树木，村寨菜畦零压路零入水零越界）；
  8. `server.py`：母星（`R = 7016.8 km`，`1° lat = 122466.0 m`）东西向高程差分梯度必须除以球面 `math.cos(math.radians(lat))` 修正因子；
  9. **`NG-01` 范围克制死命令**：**严禁在工具坞、画布交互或检视器中添加任何单栋房屋新建、点选、拖拽、旋转或删除功能**；同时严守浅色纸本测绘工坊 UI（`#f4f1ea / #faf8f3 / #d5cdbd / #365942 / #b55838`），严禁抄袭 `worldbuilding/` 的暗黑星空样式（`V2-BG-08`）。
- **护栏 ⑦（目录物理隔离与唯一 Python 解释器）**：一切写入与构建操作严格限定在 `/Users/jrdamocles/code/TERRAX/settlement_studio/` 内部（且严禁修改 `legacy_v1_js/`、`docs/01_BRD_V2*`、`docs/02_PRD_V2*`、`docs/04_V2*`）；对 `/Users/jrdamocles/code/TERRAX/地图/` 下的二进制地理数据与上层 `候选工作区/` 脚本仅允许 `mode="r"` 只读访问；所有 Python 命令唯一强制使用 `/Users/jrdamocles/code/TERRAX/worldbuilding/venv/bin/python3`（`V2-BG-10`）。
- **护栏 ⑧（逐阶段 `npm run check` 闭环与即时回填对照表）**：每完成一个里程碑（`M0` — `M6`），必须立即在终端运行 `npm run check`（串联 `tsc --noEmit && biome lint src tests && vitest run`）及单文件行数扫描，确认退出码严格为 `0` 后，立即编辑更新 `docs/03_V2_执行对照计划表与验收溯源矩阵.md` 中对应任务行的 `[x] 已完成` 状态、回填三要素（实际路径与行数 + 核心类型/实现要点 + 自测耗时/断言数）、顶部总进度计数及第 `5.2` 节审计日志表，严禁未测先勾或事后攒批补勾。

---

## 第 3 章 方案一：【单轮全自动通关总提示词（V2.0 Master Prompt）】

适用场景：在开启长程自主编码模式（如 `/goal` 或连续工具执行 Agent）时，整段复制下方代码块投喂给 `deepseek v4.1 flash`，一次性串行完成 `M0 — M6` 全部 38 项原子任务、5 套自动化测试与十道硬门禁终验。

```text
你是负责实施 Terrax Settlement Studio V2.0（TERRAX 通用聚落可视化制图工作台 · TypeScript AI 原生工程化升级版）的首席全栈图形架构师与几何算法工程师。你的工作目录严格限定为：
/Users/jrdamocles/code/TERRAX/settlement_studio/

请严格按照以下零歧义工程指令，从 M0 至 M6 按序完成全部 TypeScript/React 19 微模块、Vite 6 + Tailwind v4 构建配置、Web Worker 异步编译、同源双端 RenderBackend、Python 3 类型化服务端 server.py、全套 Vitest 与 Python 自动化验收脚本，并逐阶段实测回填对照计划表，直至全部十道硬门禁（V2-BG-01 至 V2-BG-10）退出码全为 0。

【一、八条一票否决硬性工程护栏（全程强制生效）】
1. 开工前必先通读基线并只读参考黄金归档：写任何代码前，必须依次完整读取：
   - /Users/jrdamocles/code/TERRAX/settlement_studio/docs/01_BRD_V2_TypeScript工程化业务需求文档.md
   - /Users/jrdamocles/code/TERRAX/settlement_studio/docs/02_PRD_V2_TypeScript架构与模块技术规格书.md
   - /Users/jrdamocles/code/TERRAX/settlement_studio/docs/03_V2_执行对照计划表与验收溯源矩阵.md
   遇到几何边界细节可只读查阅 /Users/jrdamocles/code/TERRAX/settlement_studio/legacy_v1_js/（已通过 177+53 项终审的 V1.2.2 基准）及 projects/*.worldtown.json，但严禁修改、移动或删除 legacy_v1_js/ 内任何文件。
2. 逐字锁定脚手架与 Tailwind v4 配置：严格逐字复制 02_PRD_V2 第 2 章给出的 package.json、.npmrc、tsconfig.json、vite.config.ts、biome.json、index.html；依赖安装统一执行：
   COREPACK_ENABLE_DOWNLOAD_PROMPT=0 pnpm install
   （若受限则回退执行 npm install）；src/styles/atelier.css 必须采用 @import "tailwindcss"; 与 @theme { ... }，严禁创建 tailwind.config.js 或写 @tailwind base; 等 Tailwind v3 配置。
3. 微模块行数硬红线与零妥协代码质量：src/ 下全部 .ts/.tsx 文件每个文件目标 100-300 行，硬上限严格 <= 320 行（V2-BG-03）；严禁残留任何 TODO、FIXME、省略号或假桩返回值；严禁出现显式 any、as any 或 @ts-ignore；生成算法严禁调用 Math.random()，统一调用 src/core/math/rng.ts 的 createRng(seed)（V2-BG-01）。
4. 编译期 Branded Safe* 防穿模锁与两阶段编译：所有屋宇、菜畦篱院、树木必须且只能通过 src/core/obstacles/guardSafe.ts 的 guardSafeBuilding、guardSafeFence、guardSafeTree 唯一守门函数构造 SafeBuilding、SafeFence、SafeTree 品牌类型（严禁强转伪造）；compileScene.ts 必须先在阶段一全局构建所有 walled_city/citadel 城垣并注入 512x512 双遍 Chamfer SDF 障碍场，再在阶段二运行 9 个独立选区生成器；单区重抽 rerollZoneScene 必须先基于最新水路、城墙与邻区重建新鲜障碍上下文（V2-BG-02/BG-06）。
5. 同源双端渲染引擎：地图 14 层画家算法与 22 类微缩结构图例必须且只能在 src/renderer/paintScene.ts 与 src/renderer/paintLegendGlyph.ts 编写唯一一遍，通过 RenderBackend 接口同时驱动 Canvas2DBackend 与无 DOM 的 SvgStringBackend，严禁为 Canvas 和 SVG 各写一套重复绘制逻辑（V2-BG-04）。
6. 严守 V1.2.2 历史八大易错点防回归及 NG-01 范围边界：
   (1) wallBuilder.ts 城墙与道路求交严格使用道路方向分量 sx（严禁误写为 rx），敌台与城门按弧长唯一归属，城门按法向绘真实厚度；
   (2) riverCanal.ts 中 buildRiverGeometry 与 buildCanalGeometry 均显式声明 Float64Array halfWidths 并做急折角防蝴蝶结夹紧，islands 恒为 []，ripples 展平为 ReadonlyArray<Polyline>（严禁四维数组）；
   (3) reefRoadBridge.ts 斜交正交桥全跨度公式 bridgeLength = (riverWidth + 8.0 + (roadWidth + 3.0) * cosAlpha) / Math.max(0.35, sinAlpha)，命中 fords 豁免不生桥；
   (4) hitTest.ts（hitTestSceneObject 与 hitTestActiveHandles）拾取优先级严格保证 zone 排在底层 terrainShape 之前（landmark -> reef -> ford -> canal -> road -> river -> waterBody -> zone -> terrainShape）；
   (5) paintLegendGlyph.ts 入口提取 const main = itemColorOverride?.trim() ? itemColorOverride : defaultColor 贯穿全部 14 内置 + 8 自定义共 22 个分支；
   (6) legend.schema.ts 的 syncLegendWithProject 对满足 item.isCustom === true 的自定义图例项强制保持 item.autoPresent = true，未盖章自定义图例重编不消失；
   (7) obstacleSdf.ts 严禁对已是半宽的 halfWidth 再乘 0.5；guardSafe.ts 全量拦截 exclusionPolys（跨疫圈林地圈内零树，村寨菜畦零压路零入水零越界）；
   (8) server.py 计算母星（R=7016.8km, 1度纬度=122466.0m）东西向高程梯度时必须除以球面 cos(lat)；
   (9) 严守 NG-01：严禁实现任何单栋房屋新建、点选、拖拽、旋转或删除控件；严守浅色纸本测绘工坊 UI（#f4f1ea / #faf8f3 / #d5cdbd / #365942 / #b55838），严禁抄袭暗黑星空样式；彻底禁画圆头蝌蚪纹（默认关闭 showScarpTicks，开启仅绘 4.0m 下坡垂直细短齿线）。
7. 目录物理隔离与唯一 Python 解释器：严禁触碰 /Users/jrdamocles/code/TERRAX/settlement_studio/ 以外任何文件（对 /Users/jrdamocles/code/TERRAX/地图/ 与 候选工作区/ 严格只读），严禁修改 docs/01_BRD_V2*、02_PRD_V2*、04_V2*；所有 Python 运行统一强制使用：
   /Users/jrdamocles/code/TERRAX/worldbuilding/venv/bin/python3
8. 逐阶段实测闭环与即时回写：每完成 M0、M1、M2、M3、M4、M5、M6 中的一个阶段，必须立即执行 npm run check（tsc --noEmit && biome lint src tests && vitest run）确认退出码为 0，随后立即更新 docs/03_V2_执行对照计划表与验收溯源矩阵.md 对应 T-x.y 行状态为 [x] 已完成，填齐三要素（实际落盘路径与行数 + 核心类型/实现要点 + 自测耗时/断言数）、顶部总进度与 5.2 审计表。

【二、精确目录结构与 M0 — M6 七步推进路线（共 38 项原子任务）】
- 第 1 步 M0（T-0.1 ~ T-0.6，完成后进度 6/38）：
  落盘 package.json, .npmrc, tsconfig.json, vite.config.ts, biome.json, index.html 并安装依赖；实现 src/schema/{geometry.types,palette.schema,legend.schema,project.schema,presets}.ts（project.schema 持久化键为 sculptDeltaB64 并兼容 sculptDeltaBase64/sculptDelta，presets 导出 BUILTIN_PRESETS/createBlankProject/createPresetProject）、src/core/math/{rng,sculptCodecs}.ts、src/store/useStudioStore.ts（显式声明 ZundoOptions<StudioState, StudioHistorySlice> 锁定 50 步撤销，严禁误写 temporal<StudioState, Pick<...>> 触发 TS2344；M0 阶段 compiledScene 从 geometry.types.ts 引用 CompiledSceneBase | null 并初始为 null 解耦尚未创建的 M3 compileScene.ts；导出 beginContinuousEdit/endContinuousEdit 合并拖拽与 undoProject/redoProject）及 tests/schema-and-store.test.ts（含直接读取校验 projects/*.worldtown.json 三套 V1.2.2 工程）。跑过 npm run check 后回写 M0。
- 第 2 步 M1（T-1.1 ~ T-1.4，完成后进度 10/38）：
  实现 src/core/terrain/{elevationField,marchingSquares,terrainSculpt}.ts 与 src/core/math/{spline,polygon,voronoi}.ts（257x257 五项高程场、偏心二次正根山包、左右独立坡宽、16状态 Marching Squares、4.0m 短齿线、子步限幅推拉与四笔刷、Catmull-Rom 样条、有界 2 轮 Voronoi 与防蝴蝶结内缩）。跑过 npm run check 后回写 M1。
- 第 3 步 M2（T-2.1 ~ T-2.5，完成后进度 15/38）：
  实现 src/core/hydro/{riverCanal,reefRoadBridge}.ts、src/core/obstacles/{obstacleSdf,guardSafe,collisionAudit}.ts 与 tests/terrain-and-hydro.test.ts（验证 100 次推拉零自交、急折角水渠零崩溃、斜交桥四角上岸、SDF 与 Safe* 守卫有效）。跑过 npm run check 后回写 M2。
- 第 4 步 M3（T-3.1 ~ T-3.7，完成后进度 22/38）：
  实现 src/core/generators/{wallBuilder,walledCity,townBlocks,village,citadel,market,farmland,saltpan,woodland}.ts、src/core/{compileScene,hitTest}.ts、src/worker/{compiler.worker,sceneCompilerClient}.ts（浏览器 Worker + Node 同步双模）与 tests/generators-and-safety.test.ts（含反序城墙避让、跨疫圈林地零树、改路重抽 <80ms、50组随机种子x4场景共 200 次零穿模零河心岛压测）。跑过 npm run check 后回写 M3。
- 第 5 步 M4（T-4.1 ~ T-4.5，完成后进度 27/38）：
  实现 src/renderer/{RenderBackend,furnitureLayout,Canvas2DBackend,SvgStringBackend,paintLegendGlyph,paintScene,exportUtils}.ts 与 tests/renderer-and-ui-parity.test.ts（验证双遍道路、三步融合树冠、22 类图例 100% 响应改色、四角智能避让零重叠、1x/2x/3x full/clean 导出同源一致）。跑过 npm run check 后回写 M4。
- 第 6 步 M5（T-5.1 ~ T-5.6，完成后进度 33/38）：
  实现 src/styles/atelier.css、src/main.tsx、src/ui/{App,TopBar,ToolDock,CanvasStage,ZoneFloatingHud,StatusBar,GeoImportModal}.tsx、src/ui/inspector/{InspectorTabs,ZonePanel,TerrainPanel,HydroRoadPanel,LegendPanel,PalettePanel}.tsx（CanvasStage 采用 useRef + store.subscribe + rAF 零 React 重渲染高频交互，严守 NG-01 无单栋房屋编辑）；扫描确认 src/ 下全部 .ts/.tsx <= 320 行，跑通 npm run check && npm run build 产出 dist/ 后回写 M5。
- 第 7 步 M6（T-6.1 ~ T-6.5，完成后进度 38/38）：
  实现带完整类型注解的 server.py（托管 dist/，提供 /api/ping、GET/POST/DELETE /api/projects 及球面 cos(lat) 修正的 /api/geo/bootstrap 兼 /api/terrax-context）；无损对拍 projects/ 下三套工程与 legacy_v1_js/ 零退化；编写并运行 tests/verify_backend.py（含联跑上层三套世界观核验脚本）；完成 docs/03_V2_执行对照计划表与验收溯源矩阵.md 的 38/38 终态回填（含 5.1 十道门禁表与 5.2 审计表）并更新根目录 README.md 状态说明。

【三、结项强制放行命令（必须全部实测退出码为 0 方可结束）】
1. npm run check
2. npm run build
3. /Users/jrdamocles/code/TERRAX/worldbuilding/venv/bin/python3 tests/verify_backend.py
4. 单文件行数与零违禁词核查：确认 src/ 下所有 .ts/.tsx 均 <= 320 行，零 TODO/FIXME/any/Math.random，且 legacy_v1_js/ 与 worldbuilding/ 零新增污染。
```

---

## 第 4 章 方案二：【分四棒高稳健接力提示词（4-Stage Relay Prompts）】

适用场景：推荐首选方案。将 38 项原子任务科学切分为四棒（`10 + 12 + 11 + 5 = 38` 项），每棒仅聚焦 `10 — 16` 个微模块，在独立新会话中依次整段复制投喂，彻底消除长上下文注意力衰减。每棒之间通过 `docs/03_V2_执行对照计划表与验收溯源矩阵.md` 精确交接断点。

### 4.1 第一棒提示词（Stage 1：`M0 + M1` — TS/Vite 底座、Zod/Zustand 状态层与高程等高线内核）

```text
你是负责实施 Terrax Settlement Studio V2.0 的底座架构与地形几何内核工程师。当前执行【分四棒高稳健接力开发 · 第一棒（Stage 1：里程碑 M0 + M1，任务 T-0.1 至 T-1.4，共 10 项）】。工作目录严格限定为：
/Users/jrdamocles/code/TERRAX/settlement_studio/

【本棒专属交付范围（仅限以下文件，暂不创建 M2-M6 文件）】
1. 工程根配置（T-0.1）：package.json, .npmrc, tsconfig.json, vite.config.ts, biome.json, index.html
2. Schema 与数学/编解码底座（T-0.2 ~ T-0.5）：
   - src/schema/geometry.types.ts
   - src/core/math/rng.ts
   - src/core/math/sculptCodecs.ts
   - src/schema/palette.schema.ts
   - src/schema/legend.schema.ts
   - src/schema/project.schema.ts
   - src/schema/presets.ts
3. 时间旅行状态仓库与 M0 测试套件（T-0.6）：
   - src/store/useStudioStore.ts
   - tests/schema-and-store.test.ts
4. 257x257 高程场、可控等高线与基础几何算子（T-1.1 ~ T-1.4）：
   - src/core/terrain/elevationField.ts
   - src/core/terrain/marchingSquares.ts
   - src/core/terrain/terrainSculpt.ts
   - src/core/math/spline.ts
   - src/core/math/polygon.ts
   - src/core/math/voronoi.ts

【八条硬性工程护栏（本棒强制执行）】
1. 开工前必先完整读取 docs/01_BRD_V2_TypeScript工程化业务需求文档.md、docs/02_PRD_V2_TypeScript架构与模块技术规格书.md（重点精读第 1、2、3、4 章）与 docs/03_V2_执行对照计划表与验收溯源矩阵.md；可只读参考 legacy_v1_js/web/js/{state_and_schema,terrain_engine,gacha_zone_engine}.js 与 projects/*.worldtown.json，严禁修改 legacy_v1_js/。
2. 逐字复制 02_PRD_V2 第 2 章锁定的 package.json、.npmrc、tsconfig.json、vite.config.ts、biome.json、index.html；执行 COREPACK_ENABLE_DOWNLOAD_PROMPT=0 pnpm install（受限时回退 npm install）；严禁创建 tailwind.config.js 等 Tailwind v3 配置。
3. 微模块硬上限：本棒新建的全部 src/**/*.ts 文件每个文件必须 <= 320 行（目标 100-300 行），零 TODO/FIXME/省略号，零 any（含 as any），严禁调用 Math.random()（统一用 createRng(seed)）。
4. 严格为后续 M2/M3 预留清晰纯数据类型契约（geometry.types.ts 与 project.schema.ts），保持核心层零 DOM 依赖。
5. 图例与配色数据层须为后续同源双端渲染提供完整 4x12 小写 HEX 调色板（含 archival_parchment、boreal_slate 等方志别名映射）及 14 内置 + 8 自定义图例目录。
6. 严守本棒关联的历史易错点防回归：
   - legend.schema.ts（导出 LegendItemSchema, LegendConfigSchema, BUILTIN_LEGEND_CATALOG, CUSTOM_GLYPH_TYPES, syncLegendWithProject）中，syncLegendWithProject 对 item.isCustom === true 的自定义图例项强制保持 item.autoPresent = true，未盖章自定义图例重同步后恒保持显示；
   - palette.schema.ts 导出 PALETTE_SLOT_KEYS, BUILTIN_PALETTES, THEME_ALIASES, PaletteConfigSchema, resolveThemeId, getActivePalette；
   - project.schema.ts 必须 100% 无损解析磁盘上现有的 projects/起点城_Losrumura.worldtown.json、长湖_复市镇.worldtown.json、帕隆_峡谷铁寨.worldtown.json 三套 V1.2.2 工程（统一持久化字段 sculptDeltaB64，兼容 sculptDeltaBase64/sculptDelta 与缺省补齐），并在 presets.ts 中导出 BUILTIN_PRESETS、createBlankProject、createPresetProject；
   - useStudioStore.ts 必须按 02_PRD_V2 第 3.6 节显式声明 const temporalOptions: ZundoOptions<StudioState, StudioHistorySlice> = { limit: 50, partialize: ... } 交由 temporal(immer(...), temporalOptions) 推导（严禁误写 temporal<StudioState, Pick<...>> 触发 TS2344）；M0 阶段 compiledScene 从 ../schema/geometry.types 引用 CompiledSceneBase | null 并初始为 null（避免在 M0 提前 import 尚未创建的 M3 compileScene.ts）；导出 beginContinuousEdit() / endContinuousEdit() 与 undoProject() / redoProject() 实现连续拖拽单步撤销合并；
   - elevationField.ts 偏心椭圆采用二次正根有效半径核（峰值导数为 0 无尖刺），marchingSquares.ts 默认 showScarpTicks=false（彻底废除圆头蝌蚪纹，开启时仅产 4.0m 下坡垂直细短齿线），terrainSculpt.ts 路径子步 <=24 + 梯度自适应限幅 + 余弦归零高斯核确保推拉零自交，voronoi.ts 严格有界 2 轮 Lloyd 松弛零死循环。
7. 目录隔离与 Python 路径：严禁触碰 settlement_studio/ 以外文件，严禁修改 docs/01_BRD_V2*、02_PRD_V2*、04_V2*；若需辅助脚本，Python 唯一使用 /Users/jrdamocles/code/TERRAX/worldbuilding/venv/bin/python3。
8. 实测闭环与进度回填：
   - 在 tests/schema-and-store.test.ts 中完整断言 RNG、sculptCodecs（误差 <=0.051m）、4x12 调色板与别名、未盖章 isCustom 图例持久显示、三套真实 .worldtown.json 无损解析、Zundo 50 步上限与 pause/resume 单步合并，并可附加 M1 高程/等高线基础冒烟断言；
   - 运行 npm run check（tsc --noEmit && biome lint src tests && vitest run）并扫描确认本棒全部 src/**/*.ts 行数 <= 320，确认退出码严格为 0；
   - 立即更新 docs/03_V2_执行对照计划表与验收溯源矩阵.md 中 T-0.1 至 T-1.4 共 10 行为 [x] 已完成（填齐三要素），将顶部进度更新为「当前进度: 10 / 38 项已完成」，并回填 5.2 审计表中 M0 与 M1 两行。

完成后输出第一棒实测摘要并停下，等待第二棒指令。
```

### 4.2 第二棒提示词（Stage 2：`M2 + M3` — 纯净水系、斜交正交桥、`Safe*` 防穿模锁、9 类微模块生成器与 Worker）

```text
你是负责实施 Terrax Settlement Studio V2.0 的水文路网、防穿模安全锁与程序化城建生成内核工程师。当前执行【分四棒高稳健接力开发 · 第二棒（Stage 2：里程碑 M2 + M3，任务 T-2.1 至 T-3.7，共 12 项）】。工作目录严格限定为：
/Users/jrdamocles/code/TERRAX/settlement_studio/

【第一步：断点核查与前序契约对齐】
1. 完整读取 docs/01_BRD_V2_TypeScript工程化业务需求文档.md、docs/02_PRD_V2_TypeScript架构与模块技术规格书.md（重点精读第 5、6 章及附录）与 docs/03_V2_执行对照计划表与验收溯源矩阵.md，确认 M0+M1（T-0.1 ~ T-1.4，共 10 项）已完成。
2. 只读检查已落盘的 src/schema/*.ts、src/core/math/*.ts、src/core/terrain/*.ts 实际导出类型与函数签名，并可只读参考 legacy_v1_js/web/js/{hydro_road_engine,gacha_zone_engine}.js 中的几何细节（严禁修改 legacy_v1_js/）。

【本棒专属交付范围（M2 + M3，暂不创建 M4-M6 渲染/UI/服务端文件）】
1. M2 纯净水系、斜交桥与编译期防穿模锁（T-2.1 ~ T-2.5）：
   - src/core/hydro/riverCanal.ts
   - src/core/hydro/reefRoadBridge.ts
   - src/core/obstacles/obstacleSdf.ts
   - src/core/obstacles/guardSafe.ts
   - src/core/obstacles/collisionAudit.ts
   - tests/terrain-and-hydro.test.ts
2. M3 9 类微模块生成器、两阶段全局编译、拾取器与 Worker 双模客户端（T-3.1 ~ T-3.7）：
   - src/core/generators/wallBuilder.ts
   - src/core/generators/walledCity.ts
   - src/core/generators/townBlocks.ts
   - src/core/generators/village.ts
   - src/core/generators/citadel.ts
   - src/core/generators/market.ts
   - src/core/generators/farmland.ts
   - src/core/generators/saltpan.ts
   - src/core/generators/woodland.ts
   - src/core/compileScene.ts
   - src/core/hitTest.ts
   - src/worker/compiler.worker.ts
   - src/worker/sceneCompilerClient.ts
   - tests/generators-and-safety.test.ts

【八条硬性工程护栏（本棒强制执行）】
1. 严守上游 02_PRD_V2 第 5-6 章数学公式与接口定义，严禁修改 legacy_v1_js/ 及 docs/01_BRD_V2*、02_PRD_V2*、04_V2*。
2. 保持 package.json / tsconfig.json / biome.json 原样锁死，不新增未授权第三方 npm 包。
3. 微模块硬上限：本棒涉及 9 个独立选区生成器与水文/SDF 文件，src/ 下每个 .ts 文件必须严格 <= 320 行（目标 100-300 行），零 TODO/FIXME/省略号，零 any，零 Math.random()（统一用 createRng(seed)）。
4. 编译期防穿模铁律（V2-BG-02）：
   - 在 guardSafe.ts 中定义品牌不透明类型 SafeBuilding、SafeFence、SafeTree，并仅通过唯一守门函数 guardSafeBuilding、guardSafeFence、guardSafeTree 构造（内部结合 512x512 SDF 预筛 + 河湖岸 >=8.0m、水渠 >=0.5*widthM+4.0m、干道 >=0.5*widthM+2.5m、城墙 >=0.5*wallThicknessM+3.0m、邻屋 >=0.8m、禁建多边形零侵入、坡度 <=maxSlopeDeg 全边段精确复检，含 0.82 收缩挽救）；严禁在任何生成器里用类型断言伪造品牌类型；
   - compileScene.ts 严格实施两阶段全局编译：阶段一遍历所有选区调用 wallBuilder.ts 构建全部 walled_city/citadel 城垣，随后统一生成全局 ObstacleGrid；阶段二再分发调用 9 个独立生成器，彻底消除选区顺序引发的撞墙；单区重抽 rerollZoneScene 必须先从当前最新水路、全局城垣与其他选区几何重建新鲜障碍场，杜绝改路后重抽脏缓存穿模。
5. 输出纯粹、强类型的 CompiledScene 数据结构（零 DOM 依赖），供第三棒同源双端 RenderBackend 直接消费。
6. 严守本棒核心历史易错点防回归：
   - wallBuilder.ts 城墙与道路求交严格使用道路方向向量分量 sx（严禁误写为 rx），敌台与城门按墙段弧长唯一归属不重画，城门计算法向矩形顶点赋予真实厚度；
   - riverCanal.ts 中 buildRiverGeometry 与 buildCanalGeometry 均必须显式声明 const halfWidths = new Float64Array(n) 并做急折角（90/120/150度）防蝴蝶结夹紧；river.islands 类型为 readonly never[] 且恒返 []；贴岸水纹展平为 ReadonlyArray<Polyline>（严禁四维嵌套）；qanat 暗渠每 45.0m 产竖井；
   - reefRoadBridge.ts 仅按显式 project.reefs 产 5-7 边形棱角岩礁簇；solveOrthogonalBridges 斜交全跨度公式严格为 bridgeLength = (riverWidth + 8.0 + (roadWidth + 3.0) * cosAlpha) / Math.max(0.35, sinAlpha)（35m 去重，fords 豁免）；
   - obstacleSdf.ts 严禁对已是半宽的 halfWidth 再乘 0.5，并对 river.bankPolygon 填实内部掩码；woodland.ts 与 guardSafeTree 强制拦截 exclusionPolys（跨疫圈疏林圈内零树木），village.ts 菜畦 gardenFences 强制经 guardSafeFence 校验；
   - hitTest.ts（导出 hitTestSceneObject 与 hitTestActiveHandles）顺序固定为 landmark -> reef -> ford -> canal -> road -> river -> waterBody -> zone -> terrainShape（zone 排在 terrainShape 之前，且不拾取单栋房屋以严守 NG-01）；
   - sceneCompilerClient.ts 检测 typeof Worker !== 'undefined'，在 Vitest Node 环境下无缝同步降级并保持 requestId 最新优先语义（并可与 useStudioStore 的 requestRecompile / rerollZone 衔接填充 compiledScene）。
7. 目录隔离与唯一 Python 路径同总纲。
8. 实测闭环与进度回填：
   - 完整编写 tests/terrain-and-hydro.test.ts（覆盖偏心核、100 次推拉与四笔刷零 NaN 零自交、4.0m 齿线、90/120/150 度急折角水渠零自交、零河心岛、斜交桥四角上岸、SDF 与 Safe* 拦截）与 tests/generators-and-safety.test.ts（覆盖 9 类选区产出、反序城墙避让、跨疫圈林地零树、改路后单区重抽 <80ms、三套预设选区中心点击 100% 命中、Worker 双模客户端、以及 50 组随机 seed x 4 场景共 200 次编译五类穿模与河心岛全 0 压测）；
   - 执行 npm run check 并扫描确认 src/ 下全部 .ts 文件 <= 320 行，确认退出码严格为 0；
   - 立即更新 docs/03_V2_执行对照计划表与验收溯源矩阵.md 中 T-2.1 至 T-3.7 共 12 行为 [x] 已完成（填齐三要素），将顶部进度更新为「当前进度: 22 / 38 项已完成」，并回填 5.2 审计表中 M2 与 M3 两行。

完成后输出第二棒压测数据摘要并停下，等待第三棒指令。
```

### 4.3 第三棒提示词（Stage 3：`M4 + M5` — 同源双端 `RenderBackend` 渲染导出与 React 19 + Tailwind v4 浅色测绘工坊 UI）

```text
你是负责实施 Terrax Settlement Studio V2.0 的矢量制图渲染引擎与高频交互工作台前端工程师。当前执行【分四棒高稳健接力开发 · 第三棒（Stage 3：里程碑 M4 + M5，任务 T-4.1 至 T-5.6，共 11 项）】。工作目录严格限定为：
/Users/jrdamocles/code/TERRAX/settlement_studio/

【第一步：断点核查与内核契约读取】
1. 完整读取 docs/01_BRD_V2_TypeScript工程化业务需求文档.md、docs/02_PRD_V2_TypeScript架构与模块技术规格书.md（重点精读第 2.6、7、8.1~8.2 章）与 docs/03_V2_执行对照计划表与验收溯源矩阵.md，确认 M0—M3（T-0.1 ~ T-3.7，共 22 项）均已完成且 npm run check 全绿。
2. 只读检查已落盘的 src/schema/*.ts、src/store/useStudioStore.ts、src/core/{compileScene,hitTest}.ts、src/worker/sceneCompilerClient.ts，并可只读参考 legacy_v1_js/web/js/{canvas_renderer,exporter}.js 的制图美学参数（严禁复制其双份平行结构，严禁修改 legacy_v1_js/）。

【本棒专属交付范围（M4 + M5，暂不创建 M6 server.py 与 verify_backend.py）】
1. M4 同源双端 RenderBackend 渲染引擎与导出测试（T-4.1 ~ T-4.5）：
   - src/renderer/RenderBackend.ts
   - src/renderer/furnitureLayout.ts
   - src/renderer/Canvas2DBackend.ts
   - src/renderer/SvgStringBackend.ts
   - src/renderer/paintLegendGlyph.ts
   - src/renderer/paintScene.ts
   - src/renderer/exportUtils.ts
   - tests/renderer-and-ui-parity.test.ts
2. M5 Tailwind v4 浅色纸本测绘工坊与 React 19 组件体系（T-5.1 ~ T-5.6）：
   - src/styles/atelier.css
   - src/main.tsx
   - src/ui/App.tsx
   - src/ui/TopBar.tsx
   - src/ui/ToolDock.tsx
   - src/ui/CanvasStage.tsx
   - src/ui/ZoneFloatingHud.tsx
   - src/ui/StatusBar.tsx
   - src/ui/GeoImportModal.tsx
   - src/ui/inspector/InspectorTabs.tsx
   - src/ui/inspector/ZonePanel.tsx
   - src/ui/inspector/TerrainPanel.tsx
   - src/ui/inspector/HydroRoadPanel.tsx
   - src/ui/inspector/LegendPanel.tsx
   - src/ui/inspector/PalettePanel.tsx

【八条硬性工程护栏（本棒强制执行）】
1. 严格遵循 02_PRD_V2 第 7-8 章契约，严禁修改 legacy_v1_js/ 及 docs/01_BRD_V2*、02_PRD_V2*、04_V2*。
2. Tailwind v4 铁律：src/styles/atelier.css 必须以 @import "tailwindcss"; 与 @theme { ... } 定义暖亚麻桌面 #f4f1ea、象牙卡纸面板 #faf8f3、内嵌卡片 #efeae0、黄铜分割线 #d5cdbd、深褐主墨 #2b2620、松针绿 #365942、陶土橙红 #b55838 及长音符兼容字体栈；严禁创建 tailwind.config.js 或写 @tailwind base;；严禁抄袭 worldbuilding/ 的暗黑星空 UI（V2-BG-08）。
3. 微模块硬上限：src/ 下全部 53 个 .ts 与 .tsx 微模块文件（含 paintScene.ts、paintLegendGlyph.ts、CanvasStage.tsx 等）每个文件严格 <= 320 行（若某渲染或舞台文件接近上限，务必合理复用同目录已规定的子函数保持精炼清晰，零 TODO/省略号，零 any，零 Math.random）。
4. 保持数据单向流与编译期类型安全，UI 组件禁止绕过 Store 直接变异工程对象。
5. 同源双端渲染铁律（V2-BG-04）：
   - 地图 Watabou 14 层画家算法只在 paintScene.ts 写唯一一遍：必须包含第 7 层双遍融通道路（Pass 1 绘全部路缘 roadCasing，Pass 2 绘全部路面 roadFill，彻底消除路口黑叉）、第 11 层三步双遍融合树冠（图层 layerId 为唯一 trees-canopy，即 SVG <g id="layer-trees-canopy"> 内依次三次调用 drawCirclesMergedPass：阴影 -> r+1.8m 外廓圆 -> r 叶面圆，消除树丛内部杂线）、导出态隐藏第 14 交互层、clean 模式剥离第 13 图饰层；
   - 22 类图例（14 内置 + 8 自定义）只在 paintLegendGlyph.ts 写唯一一遍：全部绘出 28x18 真实微缩制图结构（严禁单色圆点敷衍），入口统一提取 const main = itemColorOverride?.trim() ? itemColorOverride : defaultColor 贯穿全部 22 个分支，确保自定义改色在 Canvas 与 SVG 双端 22/22（100%）同步生效；
   - furnitureLayout.ts 自动计算四角停靠包络框，确保图例框在任一角均不与标题牌匾、指北针、比例尺重叠；SvgStringBackend 纯字符串零 DOM，支持 Node 直接运行。
6. 动静分离 60-120 FPS 交互与防回归红线（V2-BG-06/BG-07 & NG-01）：
   - CanvasStage.tsx 采用 useRef + useStudioStore.subscribe + requestAnimationFrame 直接驱动 Canvas2DBackend，高频平移缩放、山包偏心菱形柄拖拽（注意旋转柄连杆起点按旋转角精确计算）、等高线推拉、四笔刷+Alt 海拔吸管、水路与选区顶点编辑均不触发外层 React 树重渲染；
   - 所有画布拖拽与面板 range 滑块必须成对调用 beginContinuousEdit() / endContinuousEdit() 合并单步撤销（笔刷半径/强度滑块仅更新 UI 工具状态，不触发冗余重编译）；
   - ToolDock 严格锁定 12 工具（V/C/B/H/G/W/L/K/D/Z/M/U）与 R 重抽、Cmd/Ctrl+Z 撤销重做快捷键；严守 NG-01：全界面严禁出现任何单栋房屋新建、点选、拖拽、旋转或删除入口；无后端时 /api/ping 静默降级离线独立模式，全部本地编辑与 1x/2x/3x PNG / SVG / JSON 导出 100% 可用。
7. 目录隔离与 Python 路径同总纲。
8. 实测闭环与进度回填：
   - 完整编写 tests/renderer-and-ui-parity.test.ts（用录制 Backend 与 SvgStringBackend 校验双端基元同源一致、双遍道路与三步树冠顺序、22 类图例赋 #ff11aa 后 22/22 双端变色、四角停靠零包络重叠、clean/full 导出差异、src/ 全文件 <=320 行自动断言与 12 工具列表零单屋编辑项）；
   - 依次执行 npm run check 与 npm run build，确认 TypeScript、Biome、4 套 Vitest 测试与 Vite 生产打包（生成 dist/）退出码全为 0；
   - 立即更新 docs/03_V2_执行对照计划表与验收溯源矩阵.md 中 T-4.1 至 T-5.6 共 11 行为 [x] 已完成（填齐三要素），将顶部进度更新为「当前进度: 33 / 38 项已完成」，并回填 5.2 审计表中 M4 与 M5 两行。

完成后输出第三棒测试与 dist/ 构建摘要并停下，等待第四棒收官指令。
```

### 4.4 第四棒提示词（Stage 4：`M6` — 类型化 Python 服务端、V1.2.2 黄金对拍与十道门禁收官）

```text
你是负责实施 Terrax Settlement Studio V2.0 的地理数据后端与总验收质量工程师。当前执行【分四棒高稳健接力开发 · 第四棒收官战（Stage 4：里程碑 M6，任务 T-6.1 至 T-6.5，共 5 项）】。工作目录严格限定为：
/Users/jrdamocles/code/TERRAX/settlement_studio/

【第一步：断点核查与前序构建确认】
1. 完整读取 docs/01_BRD_V2_TypeScript工程化业务需求文档.md、docs/02_PRD_V2_TypeScript架构与模块技术规格书.md（重点精读第 8.3~8.4 节服务端协议与测试契约）与 docs/03_V2_执行对照计划表与验收溯源矩阵.md，确认 M0—M5（T-0.1 ~ T-5.6，共 33 项）已完成且 dist/ 已构建就绪。
2. 只读查阅 legacy_v1_js/server.py 与 legacy_v1_js/tests/verify_backend.py，注意本棒编写的根级 server.py 位于 settlement_studio/server.py（因此 REPO_ROOT = STUDIO_DIR.parent），且静态资源目录托管 Vite 生产产物 dist/（而非旧 web/）。

【本棒专属交付范围（M6：T-6.1 至 T-6.5）】
1. server.py（T-6.1：Python 3 完整类型注解服务端）
2. 对拍校验 projects/起点城_Losrumura.worldtown.json、长湖_复市镇.worldtown.json、帕隆_峡谷铁寨.worldtown.json 与 src/schema/presets.ts（T-6.2）
3. tests/verify_backend.py（T-6.3：全栈后端、生产包托管与仓库零侵入核验脚本）
4. 全栈十道硬门禁联跑闭环（T-6.4）与 docs/03_V2_执行对照计划表与验收溯源矩阵.md、README.md 终态收口（T-6.5）

【八条硬性工程护栏（收官强制执行）】
1. 严禁修改、删除或污染 legacy_v1_js/ 黄金归档库及 docs/01_BRD_V2*、02_PRD_V2*、04_V2*。
2. 若对拍发现任何前端微模块边界瑕疵，修复时必须继续严守 package.json 锁定、Tailwind v4 与单文件 <= 320 行红线，修复后重新执行 npm run build 刷新 dist/。
3. server.py 与 verify_backend.py 严禁留下任何 TODO 或占位逻辑，具备完整 Python typing 注解与清晰异常处理。
4. 对 projects/*.worldtown.json 三套世界观工程执行 V2 全量编译与碰撞审计，确保屋宇、城垣城门、正交桥、疫圈零屋零树、暗渠竖井、7 块底礁、4.0m 陡坎短齿线、村寨安全菜畦与 legacy_v1_js/ 对拍零退化，collisionReport.passed 100% 为 true。
5. 保持双端同源渲染无损导出，确保三套工程生成的 SVG 均结构完整闭合。
6. 严守服务端核心防回归细节：
   - server.py 支持 --port（默认 8765）与 --host（默认 127.0.0.1），托管 dist/ 静态构建产物（含 SPA 根路由 index.html 与 assets/）；
   - 提供 GET /api/ping、GET /api/projects、GET /api/projects/<filename>、POST /api/projects、DELETE /api/projects/<filename>（强制使用 Path(name).name 剥离路径分隔符并限定于 projects/*.worldtown.json，采用临时文件 + os.replace 原子写加线程锁，严防并发损坏与目录逃逸）；
   - 提供只读映射 TERRAX 四大地理数据源（lake_bed_dem.bin shape=(3000,6000) dtype="<f4"、global_owner.npz、map_lake_mask.npz、rendered_centerlines.npz + centerline_index.json）的 GET /api/geo/bootstrap（并同时兼容路由 GET /api/terrax-context），母星 R=7016.8km（PLANET_DEG_LAT_M=122466.0）东西向高程差分梯度必须严格除以球面 math.cos(math.radians(lat)) 修正因子。
7. 绝对仓库零侵入与唯一 Python 解释器：
   - 对 /Users/jrdamocles/code/TERRAX/地图/ 下所有文件仅允许 mode="r" 只读映射；
   - 所有 Python 命令强制唯一使用 /Users/jrdamocles/code/TERRAX/worldbuilding/venv/bin/python3；
   - tests/verify_backend.py 必须覆盖：空闲端口拉起 server.py（start_new_session + finally 回收进程组）、校验 dist/ 首页与静态资源 200、/api/ping、起点城（lon=42.51, lat=35.19, span_m=2800 -> row=913, col=3708, |elevM-484.9|<1.0, isLand=True, R1966 及高纬度 cos(lat) 坡向验证）、三套工程读取、6 路并发保存与删除、路径穿越 400/404 拦截、测试临时文件与 *.tmp 零残留、五大地理数据文件 sha256 与 mtime_ns 前后逐字一致、worldbuilding git 状态零新增、以及联跑上层三套世界观核验脚本（核验候选稿.py、核验志书集.py、核验待定故事集.py）退出码全为 0。
8. 终审实测闭环与文档收口：
   依次实跑并确认以下全部命令退出码严格为 0：
   (1) npm run check
   (2) npm run build
   (3) /Users/jrdamocles/code/TERRAX/worldbuilding/venv/bin/python3 tests/verify_backend.py
   (4) 运行 legacy_v1_js 自检或 git/文件扫描确认 legacy_v1_js/ 未被篡改且 src/ 下全部 .ts/.tsx <= 320 行、零 TODO/any/Math.random。
   全部通过后，完整回填 docs/03_V2_执行对照计划表与验收溯源矩阵.md（T-6.1~T-6.5 勾选 [x] 已完成，顶部总进度更新为「当前进度: 38 / 38 项已完成」，逐项填满 5.1 十大一票否决硬门禁实测证据、5.2 七大里程碑审计表与 5.3 八大易错点自检表），并将根目录 README.md 工程状态更新为 V2.0 全量编码与十道自动化门禁已完成状态（注意文档全文零全角感叹号）。
```

---

## 第 5 章 方案三：【中断恢复 / 审查返修续跑提示词（Session Resume Prompt）】

### 5.1 会话中断断点恢复提示词（用于上下文耗尽或中途断开后续跑）

当执行方案一或方案二某棒中途因单轮输出上限停止时，在新会话中直接整段复制下方代码块投喂，模型将自动校验断点并无缝接续：

```text
请继续执行 Terrax Settlement Studio V2.0（工作目录：/Users/jrdamocles/code/TERRAX/settlement_studio/）的未完成开发任务，严格遵守以下断点恢复规程：

1. 首步状态盘点：
   - 依次读取 docs/03_V2_执行对照计划表与验收溯源矩阵.md 与 docs/02_PRD_V2_TypeScript架构与模块技术规格书.md；
   - 扫描磁盘当前已创建的 src/、tests/ 文件列表，检查最后修改的 2-3 个文件是否存在半截截断、语法残缺、TODO 占位或单文件超过 320 行的情况；若存在残缺文件，先将其补全修复并通过 npx tsc --noEmit。
2. 精准断点续跑：
   - 定位 docs/03_V2_执行对照计划表与验收溯源矩阵.md 第 3 章中第一个状态仍为 [ ] 待执行 的原子任务节点（T-x.y），从该节点向后按序实施。
3. 全程保持八条硬性工程护栏不松动：
   - 严禁修改只读归档目录 legacy_v1_js/ 及 settlement_studio/ 以外的任何仓库文件；
   - 严禁修改锁定的 package.json / tsconfig.json / vite.config.ts / biome.json 或引入 Tailwind v3 配置；
   - src/ 下全部 .ts/.tsx 单文件严格 <= 320 行，零 TODO/FIXME/省略号，零 any，生成逻辑零 Math.random()；
   - 屋宇、菜畦篱院、树木必须经 guardSafe.ts 唯一守门函数构造 SafeBuilding / SafeFence / SafeTree，严守两阶段全局城墙前置编译与新鲜障碍场单区重抽；
   - 地图与 22 类图例仅在 paintScene.ts 与 paintLegendGlyph.ts 编写唯一一遍，严守历史八大易错点防回归（sx 城墙交点、halfWidths 显式声明、斜交桥 sinAlpha、zone 拾取先于 terrainShape、22 图例 main 改色、isCustom 未盖章持久显示、禁建圈零树、server.py 球面 cos(lat)）及 NG-01 不做单栋房屋增删改；
   - Python 解释器唯一使用 /Users/jrdamocles/code/TERRAX/worldbuilding/venv/bin/python3。
4. 先测后勾：每完成一个里程碑立即运行 npm run check（若至 M5/M6 同步跑 npm run build 与 tests/verify_backend.py），确认退出码为 0 后即时回写更新 docs/03_V2_执行对照计划表与验收溯源矩阵.md 的完成状态、三要素记录、总进度计数与 5.2 审计表。
```

### 5.2 审查缺陷靶向返修提示词（用于代码审查后零打地鼠精准修复）

若独立审查或验收测试报告了具体缺陷项，将审查问题粘贴在下方提示词末尾投喂，利用微模块隔离优势实现「改一处、测全套、零新增回归」：

```text
你是 Terrax Settlement Studio V2.0 的质量收口工程师（工作目录：/Users/jrdamocles/code/TERRAX/settlement_studio/）。请针对下方附带的审查问题清单执行「测试先行 · 微模块靶向修复 · 十道门禁防打地鼠回归」：

1. 根因定位与影响面收敛：
   - 先查阅 docs/02_PRD_V2_TypeScript架构与模块技术规格书.md 对应契约及只读基准 legacy_v1_js/（严禁修改 legacy_v1_js/），定位问题所属的具体 src/ 微模块文件；
   - 严禁在未读懂上下文的情况下跨文件盲改，严禁用 as any、@ts-ignore 或删除测试断言来掩盖报错。
2. 测试先行（Test-First Fix）：
   - 先在对应的 tests/*.test.ts（或 tests/verify_backend.py）中新增能够稳定复现该缺陷的针对性回归断言；
   - 再修改目标微模块实现，并确保修改后该文件及 src/ 下全部 .ts/.tsx 依然严格 <= 320 行（V2-BG-03）、零 TODO、零 any、零 Math.random（V2-BG-01）、严守 Safe* 品牌守卫（V2-BG-02）与同源 RenderBackend（V2-BG-04）。
3. 全量门禁联跑与文档同步：
   - 依次运行并确认全部退出码为 0：
     (1) npm run check
     (2) npm run build
     (3) /Users/jrdamocles/code/TERRAX/worldbuilding/venv/bin/python3 tests/verify_backend.py
   - 将本次修复涉及的文件路径、行数、根因与新增回归断言数补充记录到 docs/03_V2_执行对照计划表与验收溯源矩阵.md 末尾或对应审计备注中（全文保持零全角感叹号）。

【待修复审查问题清单】：
（在此处粘贴具体审查发现的问题描述）
```
