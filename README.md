# Terrax Settlement Studio

**Terrax Settlement Studio** 是面向 [TERRAX 建世资料库](../README.md) 的仓库级通用聚落可视化编辑与受控抽卡制图工作台，与跨平台星空创作端 [Terrax Sky Studio](../worldbuilding/README.md) 并列独立部署，专门承担 `300 m — 6,000 m` 微观聚落尺度（都城、湖岸复合市镇、高山峡谷村寨）的交互式地形水系铺设、多边形选区原地受控抽卡、编译期硬防穿模避让、全要素微缩图形图例编辑及高清矢量/位图成图交付。

> **当前工程状态：`V2.0.3 Final Tuning Verified (2 P1 + 6 P2 Closed)`（`V2.0.3 终版微调已完成，2 项 P1 与 6 处 P2 全部清零，三道门禁退出码均为 0`）**
>
> - **V2.0.3 全量编码与三轮复审已闭环（`56` 微模块 / `38` 项任务 / `32` 项返修）**：`src/` 下 `56` 个 `.ts/.tsx` 微模块全部落盘且单文件物理行数不超过 `320` 行；`T-0.1` 至 `T-6.5` 共 `38` 项原子任务全部 `[x] 已完成`，`V2.0.1` 的 `7` 项 `P0` + `8` 项 `P1/P2` 与 `V2.0.2` 的 `9` 项二轮高优缺陷 + `P2` 微瑕与 `V2.0.3` 的 `2` 项 `P1` + `6` 处 `P2` 已全部收口（详见 `docs/03` 第 6、7、8 章）。`npm run check`（`tsc --noEmit` + `biome lint` + `4` 套 Vitest 共 `92` 用例）、`npm run build`（零告警产出 `dist/`）、`tests/verify_backend.py`（`141` 项断言）及上层三套世界观核验脚本退出码全为 `0`。
> - **仓库零侵入已实证**：`地图/` 下六大地理数据文件 `sha256 + mtime_ns` 前后逐字一致，`worldbuilding` git 状态零新增，`legacy_v1_js/` 20 个归档文件 sha256 前后一致且最新 `mtime` 早于 V2 脚手架；全部 Python 命令仅经 `worldbuilding/venv/bin/python3` 执行。
> - **V1.2.2 黄金对拍归档已冻结**：通过三轮对抗终审闭环的原生 ES Module 实现已完整归档至 [legacy_v1_js/](legacy_v1_js/README.md)（首轮 `177/177` + `53/53` 对抗压测全绿，V1.2.2 终审前端无头 `177/177` + 后端及零侵入 `81/81` 断言退出码全 `0`），作为 V2.0 几何算法与成图品质的只读黄金对拍神谕（Golden Reference Oracle）。
> - **三套世界观典范工程原位保留**：`projects/*.worldtown.json` 原位保留三套 TERRAX 世界观标杆聚落工程——[起点城_Losrumura.worldtown.json](projects/起点城_Losrumura.worldtown.json)、[长湖_复市镇.worldtown.json](projects/长湖_复市镇.worldtown.json)、[帕隆_峡谷铁寨.worldtown.json](projects/帕隆_峡谷铁寨.worldtown.json)，V2.0 `TownProjectSchema` 对其提供 100% 无损向下兼容。

---

## 一、V2.0 核心技术栈（Approved V2.0 Tech Stack）

V2.0 针对高频 2D 矢量测绘工作台与大模型（`deepseek v4.1 flash` 等）上下文工程特性，采用**动静分离 + 单一事实源 + 编译期物理防穿模锁 + 同源双端渲染**技术栈：

| 架构层次 | 锁定技术选型与版本契约 | 工程职责与防错价值 |
| --- | --- | --- |
| 包管理与构建底座 | `pnpm` (`pnpm@9.15.9` + `.npmrc`) / `npm` 兼容 + `Vite 6` | 秒级冷启动与 HMR，`worker: { format: 'es' }` 原生模块 Worker 打包，`/api` 开发代理直连本地 `127.0.0.1:8765`。 |
| 静态类型与极速门禁 | `TypeScript 5.8 (strict + noUncheckedIndexedAccess)` + `Biome 1.9.4` + `Vitest` | 0.2 秒级拦截未声明变量（如历史 `halfWidths` 漏声明）、数组越界、维度错位与隐式 `any`；`npm run check` 一键串联类型、静态规则与单测。 |
| 单一事实源与状态机 | `Zod` + `Zustand (immer + zundo 50-step Undo/Redo)` | `TownProjectSchema` 一处定义同时产出运行期默认值归一化校验器与静态 TS 类型；自动维护 50 步不可变时间旅行撤销栈，并通过 `pause/resume` 合并连续滑块、笔刷与推拉拖拽。 |
| 动静分离外框 UI | `React 19` + `Tailwind CSS v4 (@tailwindcss/vite)` | React 仅承载低频属性检视器、工具坞与弹窗；中央 `<CanvasStage>` 通过 `useRef` 直接订阅状态切片维持 `60–120 FPS` 零重渲染交互；纯 CSS `@theme` 定义「浅色纸本测绘工坊」色板令牌（零 Tailwind v3 遗留配置）。 |
| 异步编译与双模桥接 | `Web Worker` (`compiler.worker.ts` + `sceneCompilerClient.ts`) | 将 `257×257` 高程等高线、`512×512` SDF 距离场与 Voronoi 街坊切分卸载至后台线程并按 `requestId` 丢弃过时帧；Node / Vitest 无 Worker 环境下自动无缝回退同步编译。 |
| 编译期物理防穿模锁 | `Branded SafePolygon Types` (`SafeBuilding` / `SafeFence` / `SafeTree`) | 唯一守卫模块 `guardSafe.ts` 封装 `512×512` 双遍 Chamfer SDF 与全边段解析复检，配合阶段一全局城墙前置编译；未经安全校验的裸多边形在编译期即被 TS 类型系统拒绝入列。 |
| 同源双端渲染引擎 | `Shared RenderBackend (Canvas2DBackend + SvgStringBackend)` | `paintScene.ts`（14 层画家算法、双遍无黑叉道路、三步融合树冠）与 `paintLegendGlyph.ts`（14 类内置 + 8 类自定义微缩图形图例）**只写一遍**，同时驱动屏幕高清 Canvas/PNG 与无损分层 SVG 导出。 |
| 本地地理只读服务 | Typed Python `server.py` (`worldbuilding/venv/bin/python3`) | 完整 Python 类型注解，统一托管生产包 `dist/`、本地 `projects/*.worldtown.json` 原子存取，以及 `地图/` 下四大二进制地理真值的 `mode="r"` 只读球面 `cos(lat)` 引导接口。 |

---

## 二、核心基线文档与归档导航

| 序号 | 文档与归档路径 | 版本 / 范围 | 核心职责与阅读指引 |
| --- | --- | --- | --- |
| 01 | [docs/01_BRD_V2_TypeScript工程化业务需求文档.md](docs/01_BRD_V2_TypeScript工程化业务需求文档.md) | V2.0 BRD | V1.2 三轮审查实证复盘（7 项首轮 P0 + 2 项二轮回归病根剖析）、框架选型横评、七大架构目标（`V2-G01 ~ V2-G07`）、四大不做边界（`NG-01 ~ NG-04`，含禁做单栋房屋手动增删改）、六大防呆矩阵（`V2-R01 ~ V2-R06`）与十大一票否决硬门禁（`V2-BG-01 ~ V2-BG-10`）。 |
| 02 | [docs/02_PRD_V2_TypeScript架构与模块技术规格书.md](docs/02_PRD_V2_TypeScript架构与模块技术规格书.md) | V2.0 PRD | 50 微模块系统蓝图、可直接复制落盘的脚手架逐字配置、Zod Schema 与 Zustand/Zundo 泛型契约、高程/等高线/水路/斜交正交桥数学公式、`Branded Safe*` 两阶段编译与 Worker 协议、`Shared RenderBackend` 接口、React 19 浅色纸本测绘工坊组件契约、类型化 `server.py` 协议及 V1.2.2 八大历史陷阱防回归速查表。 |
| 03 | [docs/03_V2_执行对照计划表与验收溯源矩阵.md](docs/03_V2_执行对照计划表与验收溯源矩阵.md) | V2.0 Plan | `M0 — M6` 七大阶段里程碑、`T-0.1` 至 `T-6.5` 共 **38 项原子任务**执行对照表（`38 / 38` 已实测回填）、双向需求溯源矩阵及 `V2-BG-01` 至 `V2-BG-10` 硬门禁逐项核验清单。 |
| 04 | [docs/04_V2_DeepSeek_V4.1_Flash_执行提示词.md](docs/04_V2_DeepSeek_V4.1_Flash_执行提示词.md) | V2.0 Prompt | 面向 `deepseek v4.1 flash` 定制的八条硬性工程护栏总纲，提供【单轮全自动通关总提示词】、【分四棒稳健接力提示词（`M0+M1` / `M2+M3` / `M4+M5` / `M6`）】与【中断恢复/返修续跑提示词】。 |
| 05 | [legacy_v1_js/README.md](legacy_v1_js/README.md) | V1.2.2 Archive | **冻结黄金参考归档库**：完整保留已通过终审的 V1.2.2 原生 JS 代码、文档、三套工程副本及双端核验套件（`177/177` + `53/53` / `81/81` 全绿），供 V2.0 编码期间只读查阅算法细节与成图对拍。 |

---

## 三、V2.0 标准工程目录树（Canonical 50-Micro-Module Blueprint）

为彻底消除超长单文件导致的上下文退化与改东坏西，V2.0 严格执行 `V2-BG-03` 微模块门禁：**`src/` 下全部 50 级微模块单元的设计目标行数为 `100 — 300` 行，单文件硬上限 `<= 320` 行**：

```text
settlement_studio/
├── README.md                                      # V2.0 工程基线总览、技术栈、目录树与研发核验命令
├── docs/                                          # V2.0 全套工程规格基线文档（已就绪）
│   ├── 01_BRD_V2_TypeScript工程化业务需求文档.md
│   ├── 02_PRD_V2_TypeScript架构与模块技术规格书.md
│   ├── 03_V2_执行对照计划表与验收溯源矩阵.md
│   └── 04_V2_DeepSeek_V4.1_Flash_执行提示词.md
├── projects/                                      # 三套 TERRAX 典范聚落工程资产（V1.2.2 / V2.0 100% 通用）
│   ├── 起点城_Losrumura.worldtown.json            # 都城示例：起点都城 Lōsrūmūra（42.51°E, 35.19°N，DEM 484.9 m）
│   ├── 长湖_复市镇.worldtown.json                 # 市镇示例：长湖西南岸复市镇（35.61°E, 28.53°N，DEM 427.5 m）
│   └── 帕隆_峡谷铁寨.worldtown.json               # 村寨示例：帕隆北支双生铁寨（29.04°E, 14.58°N，DEM 1662.6 m）
├── legacy_v1_js/                                  # 冻结只读归档：V1.2.2 原生 JS 黄金对拍参考实现（177/177 + 81/81 全绿）
│   ├── README.md
│   ├── docs/                                      # V1.2 历史基线文档归档（01_BRD ~ 04_Prompt）
│   ├── server.py                                  # V1.2.2 本地静态与地理桥接服务归档
│   ├── web/                                       # V1.2.2 零依赖 ES Module 7 大核心模块与浅色工坊样式
│   ├── projects/                                  # V1.2.2 归档工程快照副本
│   └── tests/                                     # verify_headless.mjs 与 verify_backend.py 黄金对拍测试
│
│   # ── 以下为已按 02_PRD_V2 / 03_V2 全量落盘并通过十道门禁的 V2.0 实际结构 ──
├── package.json                                   # pnpm@9.15.9 工程描述、锁定依赖与 dev/build/check 脚本
├── .npmrc                                         # strict-peer-dependencies=false 与 auto-install-peers=true
├── tsconfig.json                                  # TS 5.8 strict + noUncheckedIndexedAccess 编译配置
├── vite.config.ts                                 # React 19 + Tailwind v4 插件、ES Worker、5173->8765 代理与 Vitest
├── biome.json                                     # Biome 1.9.4 静态规则（禁 explicit any、禁未声明变量）
├── index.html                                     # 浅色纸本测绘工坊 HTML 挂载入口
├── server.py                                      # Python 3 类型化服务端（托管 dist/ + /api/projects + /api/geo/bootstrap）
├── src/                                           # V2.0 微模块源码树（单文件目标 <= 300 行，硬上限 <= 320 行）
│   ├── main.tsx                                   # React 19 根节点挂载与全局快捷键注册
│   ├── styles/
│   │   └── atelier.css                            # Tailwind v4 @import + @theme 浅色纸本测绘工坊设计令牌
│   ├── schema/                                    # Zod 单一事实源与静态类型推导层
│   │   ├── geometry.types.ts                      # Vec2, Polyline, Polygon, BBox, CompiledScene 几何契约
│   │   ├── palette.schema.ts                      # 4×12 语义调色板、方志别名映射与覆盖合并
│   │   ├── legend.schema.ts                       # 14 类内置 + 8 类自定义徽记 Schema 与自动感知同步器
│   │   ├── project.schema.ts                      # TownProjectSchema 100% 向下兼容归一化与序列化
│   │   └── presets.ts                             # 空白模板与三套内置世界观预设工程构建器
│   ├── core/                                      # 纯函数确定性几何、高程、水路、碰撞与选区生成内核（零 DOM 依赖）
│   │   ├── math/
│   │   │   ├── rng.ts                             # Mulberry32 / FNV-1a 确定性伪随机源（严禁 Math.random）
│   │   │   ├── sculptCodecs.ts                    # Float32Array <-> Int16 定点 Base64 无损编解码
│   │   │   ├── spline.ts                          # Catmull-Rom 样条离散、折线重采样与法向偏移包络
│   │   │   ├── polygon.ts                         # 点在多边形内、线段求交、面积形心、内缩与 OBB 切分
│   │   │   └── voronoi.ts                         # 裁剪 Voronoi 胞元切分与 Lloyd 松弛算子
│   │   ├── terrain/
│   │   │   ├── elevationField.ts                  # 257×257 Float32 五项高程合成、偏心核、左右坡宽与采样
│   │   │   ├── marchingSquares.ts                 # 16 状态渐近消歧等高线提取、平滑与可选 4m 短示坡齿线
│   │   │   └── terrainSculpt.ts                   # 等高线拾取、子步自适应限幅推拉与四模式涂抹笔刷
│   │   ├── hydro/
│   │   │   ├── riverCanal.ts                      # 零河心岛变宽河道（防蝴蝶结折角 + 贴岸水纹）、湖海与明暗渠/坎儿井
│   │   │   └── reefRoadBridge.ts                  # 显式棱角岩礁、三级道路与斜交全跨度修正正交桥梁
│   │   ├── obstacles/
│   │   │   ├── obstacleSdf.ts                     # 512×512 障碍栅格化与双遍 Chamfer 有向距离场
│   │   │   ├── guardSafe.ts                       # SafeBuilding / SafeFence / SafeTree 品牌类型唯一构造守门人
│   │   │   └── collisionAudit.ts                  # 独立五维零穿模与零河心岛全量几何审计器
│   │   ├── generators/                            # 9 类受控抽卡选区独立微模块生成器 + 全局城墙构建器
│   │   │   ├── wallBuilder.ts                     # 阶段一城垣、敌台、真实交点 (sx,sy) 豁口与瓮城城门构建
│   │   │   ├── walledCity.ts                      # 内城密排街坊与院落生成
│   │   │   ├── townBlocks.ts                      # 关厢开放市镇街区生成
│   │   │   ├── village.ts                         # 自然散居村寨、柴扉院落与安全菜畦篱笆生成
│   │   │   ├── citadel.ts                         # 卫城/宫城内城轴线院落群生成
│   │   │   ├── market.ts                          # 集市广场、商铺廊庑与摊位矩阵生成
│   │   │   ├── farmland.ts                        # 顺等高线条垄农田与沟渠生成（严格扣除禁建圈）
│   │   │   ├── saltpan.ts                         # 滨岸晒盐池格网与卤水渠生成（严格扣除禁建圈）
│   │   │   └── woodland.ts                        # 疏密渐变林地树丛生成（严格扣除禁建圈与水路屋宇）
│   │   ├── compileScene.ts                        # 两阶段全局场景管线（先全图城墙与 SDF，后并发 9 类选区）与单区新鲜重抽
│   │   └── hitTest.ts                             # 确定性拾取优先级（landmark -> ... -> zone -> terrainShape）
│   ├── worker/                                    # 后台编译与主线程零卡顿通信层
│   │   ├── compiler.worker.ts                     # Web Worker 消息入口与最新帧序列响应
│   │   └── sceneCompilerClient.ts                 # 浏览器 Worker / Node 同步双模自适应编译客户端
│   ├── renderer/                                  # 同源双端渲染层（逻辑只写一遍）
│   │   ├── RenderBackend.ts                       # 统一绘图后端抽象接口契约
│   │   ├── Canvas2DBackend.ts                     # HTMLCanvasElement / OffscreenCanvas 2D 实现
│   │   ├── SvgStringBackend.ts                    # 无损分层矢量 SVG 字符串序列化实现
│   │   ├── furnitureLayout.ts                     # 图例框四角停靠与标题牌匾、指北针、比例尺自动避让
│   │   ├── paintLegendGlyph.ts                    # 14 类内置 + 8 类自定义微缩制图图例唯一绘制源（全分支响应自定义色）
│   │   ├── paintScene.ts                          # Watabou 14 层画家算法唯一绘制源（双遍道路 + 三步融合树冠）
│   │   ├── paintHandles.ts                        # 第 14 层交互覆盖：顶点/中点/山包偏心焦点/旋转连杆/脊坎坡宽柄
│   │   └── exportUtils.ts                         # 1x/2x/3x 高清 PNG、分层 SVG 与格式化 JSON 导出工具
│   ├── store/
│   │   └── useStudioStore.ts                      # Zustand + Immer + Zundo 50 步时间旅行仓库与拖拽事务合并
│   └── ui/                                        # React 19 浅色纸本测绘工坊界面组件层
│       ├── App.tsx                                # 三栏工作台主骨架与初始化编排
│       ├── TopBar.tsx                             # 工程切换、保存/导入导出、Undo/Redo 与全局视图开关栏
│       ├── ToolDock.tsx                           # 左侧 12 项测绘工具坞（严守 NG-01 无单栋房屋工具）
│       ├── CanvasStage.tsx                        # 60–120 FPS 高频平移缩放、多边形绘制、推拉与笔刷画布舞台
│       ├── canvasStageHandlers.ts                 # 手柄拖拽/插点/删点、草稿落盘与坡宽写入的纯操作层
│       ├── canvasStageInput.ts                    # 指针状态机（平移/推拉/笔刷/测距/手柄）与拖拽事务清理
│       ├── ZoneFloatingHud.tsx                    # 选中选区画布内悬浮操作胶囊（原地重抽 Seed / 切类型 / 显隐）
│       ├── StatusBar.tsx                          # 世界坐标、实时海拔坡度、建筑统计与碰撞审计绿灯状态栏
│       ├── GeoImportModal.tsx                     # TERRAX 经纬度球面地理引导导入弹窗
│       └── inspector/
│           ├── InspectorTabs.tsx                  # 右侧属性检视器五页签容器
│           ├── ZonePanel.tsx                      # 多边形选区参数、密度朝向与原地抽卡控制卡
│           ├── TerrainPanel.tsx                   # 基底坡向、偏心高程图元、等高距截断与涂抹笔刷参数卡
│           ├── HydroRoadPanel.tsx                 # 河湖海岸、明暗渠坎儿井、显式岩礁、三级道路与浅滩参数卡
│           ├── LegendPanel.tsx                    # 22 类真图形图例改名/改色/排序/四角停靠与自定义地标盖章卡
│           └── PalettePanel.tsx                   # 4 套古典测绘调色板切换与 12 项语义色单点微调卡
└── tests/                                         # 全栈自动化门禁测试套件
    ├── schema-and-store.test.ts                   # M0：Schema 向下兼容、Base64 往返、Zundo 50 步撤销与拖拽合并测试
    ├── terrain-and-hydro.test.ts                  # M1–M2：偏心核无尖刺、推拉零自交、零河心岛、急折水渠与斜交桥四角测试
    ├── generators-and-safety.test.ts              # M3：Branded Safe* 防穿模、反序城墙、单区重抽 <80ms 与 200 次随机种子压测
    ├── renderer-and-ui-parity.test.ts             # M4–M5：Canvas/SVG 同源对拍、双遍道路、22 类图例改色与拾取优先级测试
    └── verify_backend.py                          # M6：Python 服务端、dist/ 托管、球面 cos(lat) 真值与仓库零侵入核验
```

---

## 四、核心架构原则与硬门禁摘要（`V2-BG-01` — `V2-BG-10`）

1. **宏观确定性与局部受控抽卡解耦（严守 `NG-01`）**：地形等高线、河湖海岸、水渠道路与功能区多边形边界 100% 由用户可控编辑；选区内街坊切分、屋宇排布、院落菜畦与林木通过选区 `seed` 秒级原地重抽（单区 `< 80 ms`），严禁引入单栋房屋手动增删改拖拽。
2. **类型级物理防穿模与两阶段城墙编译（`V2-BG-02` / `V2-BG-05`）**：全局先构建全部城墙与 `512×512` SDF 障碍场再并发生成选区内容，彻底消除选区顺序依赖；所有屋宇、篱院、树木强制经由 `SafeBuilding / SafeFence / SafeTree` 品牌类型守卫，河心小岛计数恒为 `0`，斜交桥四角 100% 稳落陆地。
3. **同源双端渲染与真图形图例（`V2-BG-04` / `V2-BG-08`）**：画布内严守城、镇、村统一的 Watabou 暖羊皮纸钢笔淡彩质感，废除不明圆头蝌蚪尖刺纹；软件外框采用独立设计的「浅色纸本测绘工坊」，严禁复刻暗色星空界面；Canvas/PNG 与 SVG 共享同一套 `paintScene` 与 `paintLegendGlyph` 代码，杜绝双端不一致。
4. **资产 100% 向下兼容与仓库绝对零侵入（`V2-BG-09` / `V2-BG-10`）**：无缝读写 `projects/*.worldtown.json`，对 `地图/`、`worldbuilding/`、`候选工作区/` 保持 100% 只读零污染，上层三套世界观核验脚本退出码恒为 `0`。

---

## 五、V2.0 研发、构建与自动化核验命令

> 说明：以下 V2.0 命令在 `deepseek v4.1 flash` 完成 `M0 — M6` 落盘后直接生效；Python 环境统一锁定仓库自带科学计算解释器 `/Users/jrdamocles/code/TERRAX/worldbuilding/venv/bin/python3`。

### 5.1 V2.0 TypeScript 工程标准命令（工作目录：`/Users/jrdamocles/code/TERRAX/settlement_studio`）

| 阶段 / 用途 | 执行命令 | 预期产物与门禁判据 |
| --- | --- | --- |
| 安装前端工程依赖 | `COREPACK_ENABLE_DOWNLOAD_PROMPT=0 pnpm install`（若环境受限可回退 `npm install`） | 零交互挂起完成依赖安装，生成锁文件与 `node_modules/`。 |
| 启动前端热更新开发台 | `npm run dev` | 启动 Vite 6 开发服（默认 `http://127.0.0.1:5173`），自动将 `/api/*` 代理转发至本地 `127.0.0.1:8765`。 |
| 一键静态类型 + Lint + 单测门禁 | `npm run check` | 串联执行 `tsc --noEmit && biome lint src tests && vitest run`；零 TS 错误、零 `any`、零穿模与双端同源套件退出码严格为 `0`。 |
| 构建生产前端静态包 | `npm run build` | 执行 `tsc --noEmit && vite build`，产出零告警生产静态包 `dist/`，可直接由 `server.py` 单端口独立托管。 |
| 启动本地地理桥接与生产服务 | `/Users/jrdamocles/code/TERRAX/worldbuilding/venv/bin/python3 server.py` | 默认监听 `http://127.0.0.1:8765`，托管 `dist/` 静态前端并提供 `/api/projects` 与 `/api/geo/bootstrap` 只读地理真值服务。 |
| 全栈后端与仓库零侵入核验 | `/Users/jrdamocles/code/TERRAX/worldbuilding/venv/bin/python3 tests/verify_backend.py` | 临时端口拉起 `server.py`，核验 `dist/` 托管、工程存取防穿越、球面 `cos(lat)` 真值精度、五大地理数据只读零变更及上层三套核验脚本退出码全 `0`。 |

### 5.2 已冻结 V1.2.2 黄金参考归档自检命令（随时可独立运行对拍）

```bash
# 1. 运行归档 V1.2.2 前端无头几何与 200 次随机种子零穿模核验（177 项断言）
node /Users/jrdamocles/code/TERRAX/settlement_studio/legacy_v1_js/tests/verify_headless.mjs

# 2. 运行归档 V1.2.2 后端地理桥接与仓库零侵入核验（81 项断言）
/Users/jrdamocles/code/TERRAX/worldbuilding/venv/bin/python3 /Users/jrdamocles/code/TERRAX/settlement_studio/legacy_v1_js/tests/verify_backend.py
```
