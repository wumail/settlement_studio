# Terrax Settlement Studio

**Terrax Settlement Studio** 是面向 [TERRAX 建世资料库](../README.md) 的仓库级通用聚落可视化编辑与受控抽卡制图工作台，与跨平台星空创作端 [Terrax Sky Studio](../worldbuilding/README.md) 并列独立部署，专门承担 `300 m — 6,000 m` 微观聚落尺度（都城、湖岸复合市镇、高山峡谷村寨）的交互式地形水系铺设、多边形选区原地受控抽卡、编译期硬防穿模避让、全要素微缩图形图例编辑及高清矢量/位图成图交付。

> **当前工程状态：`V3.1 Atelier Polish Verified (20 / 20 + 12 项精修)`（V3.0 三阶段全部闭环，V3.1 完成图饰双态解耦、全局 UI 设计系统、离屏缓存绕空修复与三套工程穿帮精修，产出 9 张 SVG 审图预览）**
>
> - **V2.0.3 全量编码与三轮复审已闭环（`56` 微模块 / `38` 项任务 / `32` 项返修）**：`src/` 下 `56` 个 `.ts/.tsx` 微模块全部落盘且单文件物理行数不超过 `320` 行；`T-0.1` 至 `T-6.5` 共 `38` 项原子任务全部 `[x] 已完成`，`V2.0.1` 的 `7` 项 `P0` + `8` 项 `P1/P2` 与 `V2.0.2` 的 `9` 项二轮高优缺陷 + `P2` 微瑕与 `V2.0.3` 的 `2` 项 `P1` + `6` 处 `P2` 已全部收口（详见 `docs/03` 第 6、7、8 章）。`npm run check`（`tsc --noEmit` + `biome lint` + `4` 套 Vitest 共 `92` 用例）、`npm run build`（零告警产出 `dist/`）、`tests/verify_backend.py`（`141` 项断言）及上层三套世界观核验脚本退出码全为 `0`。
> - **仓库零侵入已实证**：`地图/` 下六大地理数据文件 `sha256 + mtime_ns` 前后逐字一致，`worldbuilding` git 状态零新增，`legacy_v1_js/` 20 个归档文件 sha256 前后一致且最新 `mtime` 早于 V2 脚手架；全部 Python 命令仅经 `worldbuilding/venv/bin/python3` 执行。
> - **V1.2.2 黄金对拍归档已冻结**：通过三轮对抗终审闭环的原生 ES Module 实现已完整归档至 [legacy_v1_js/](legacy_v1_js/README.md)（首轮 `177/177` + `53/53` 对抗压测全绿，V1.2.2 终审前端无头 `177/177` + 后端及零侵入 `81/81` 断言退出码全 `0`），作为 V2.0 几何算法与成图品质的只读黄金对拍神谕（Golden Reference Oracle）。
> - **三套世界观典范工程原位保留**：`projects/*.worldtown.json` 原位保留三套 TERRAX 世界观标杆聚落工程——[起点城_Losrumura.worldtown.json](projects/起点城_Losrumura.worldtown.json)、[长湖_复市镇.worldtown.json](projects/长湖_复市镇.worldtown.json)、[帕隆_峡谷铁寨.worldtown.json](projects/帕隆_峡谷铁寨.worldtown.json)，V2.0 `TownProjectSchema` 对其提供 100% 无损向下兼容。

---

## 零、V3.0 方志交互制图升级总览（Gazetteer Cartography Release）

V3.0 在不破坏 V2.0 架构与旧工程资产的前提下，完成「交互手感 — 水工建筑 — 方志成图」三级跃迁，`docs/06` 中 `V3-S1.1 — V3-S3.5` 共 **20 / 20** 项全部 `[x]`：

| 维度 | V3.0 关键升级 |
| --- | --- |
| 工具与手感 | 左侧 PS 风格 **7 组聚合工具栏**（角标 / 右键 / 长按 280ms 子工具浮层、组键轮换、14 个单键别名）+ 顶部 **36px 上下文选项栏**；`[` `]` / `Shift+滚轮` 调半径、`Alt` 临时反向、`Shift` 临时平滑 |
| 笔刷引擎 | 7 模式（隆起 / 下压 / 平滑 / 推平 / 阶地 / 斜坡 / 擦除微雕）+ 硬度平顶核 + 等距弧长插值（`max(3, 0.22R)`）；`pointermove` **零 Base64 编码**，松手仅编码一次；林木涂抹/擦除写入 `paintedTrees` |
| 数据契约 | `TownProjectSchema` 19 顶层主键（新增 `weirs / docks / watermills / structures / bridgeOverrides / paintedTrees`），逐点河宽 `widthsM`，`legend.displayMode` 三模式，V1.2 / V2 旧 JSON 100% 无损 |
| 水工与建筑群 | 分水堰（闸墩 + 溢流白浪）、滑道坞 / 木栈桥（岸线法向吸附）、水力工坊；明渠小桥、四型桥梁覆写（双桥头堡）、城墙拱形水门；`rect / l_hall / u_court / round_altar` 真实几何 + 中心/旋转/宽深手柄 |
| 有机生成器 | 道路骨架切块 + 有界 Voronoi + 沿街定向 OBB（面宽 14–28m、进深 12–24m）+ 院落中庭 + `frayOuter` 平滑衰减；`walled_city` / `town_blocks` 自动挖空内嵌堡寨 / 集市 / 禁建圈（城中套城）；集市摊列铺展、村寨沿 `ribbonSpine` 带状生长 |
| 地图学质感 | 确定性 3 八度微地形噪声、高程分层淡彩、顺坡晕滃短线（西北光照调制）、禁建圈黑石界碑点串；**17 层同源画家算法**，Canvas 与 SVG 严格共用一套指令流 |
| 出版模式 | `standard` 标准图饰 / `guided` 编号角标 + 图廓索引 / `pure` 纯净无字艺术底图；离屏静态层缓存保证悬停与缩放 60–120 FPS |

### V3.0 三套方志标杆工程与审图预览

`projects/` 三套工程已按 `候选工作区` 官方样图脚本重制（坐标换算 `wx = W/2 + px`, `wy = W/2 - py`），并逐套通过零穿模与方志空间硬断言：

| 工程 | 图幅 / 主题 | 规模（选区 / 屋宇 / 晕滃段） | 方志要点 |
| --- | --- | --- | --- |
| [起点城_Losrumura](projects/起点城_Losrumura.worldtown.json) | 3200 m · `watabou_classic` | 21 / 1191 / 4508 | 14 点穿界 R1966 干流（72→162m 变宽）、东关三孔分水堰、四类水渠、北埠四道滑道坞、13 边内城 + 内嵌议事厅四公仓、北岸司辰官坛、10 处编号地标 |
| [长湖_复市镇](projects/长湖_复市镇.worldtown.json) | 2600 m · `arid_oasis` | 18 / 276 / 4210 | 贴边一体 L6 湖湾、3 座湖港木栈桥、伊珂暗渠 7 竖井→西水门堡、24 边黑石大疫禁建圈、岸坪市集、496 格分级盐池 |
| [帕隆_峡谷铁寨](projects/帕隆_峡谷铁寨.worldtown.json) | 1500 m · `nordic_fjord` | 24 / 84 / 5565 | 高差 184m 深切 V 形峡谷、14 点 S 形穿界急溪、7 礁 + 暗梁渡口、双生石堡桥头楼、8 座水力锻锤坊、8 条带状村寨 |

审图预览（由 `tests/v3-benchmark-projects.test.ts` 在构建后重新落盘，浏览器直接打开即可）：

```text
previews/losrumura_{standard,guided,pure}.svg
previews/changhu_{standard,guided,pure}.svg
previews/palong_{standard,guided,pure}.svg
```

> 注：`npm run build` 会清空 `dist/`；如需预览文件常驻，请在构建后执行
> `npx vitest run tests/v3-benchmark-projects.test.ts` 重新生成（9 张，单张 1.7–3.7 MB）。

### V3.1 终审精修（Atelier Polish）

| 维度 | 精修内容 |
| --- | --- |
| 图饰双态 | 交互编辑态图饰（标题牌 / 指北针 / 比例尺 / 图例 / 导览目录）钉在**画布视口四角** 14px，绝不随地图平移缩放挤成一团；导出成图态才排进地图纸框内缩 14px；标题牌按实测字宽 `clamp(220, 440, 0.52×可用宽)` 动态撑宽并省略号收口 |
| 半透明可调 | 新增 `legend.furnitureOpacity`（0.15–1，默认 0.72）与 `legend.labelOpacity`（0–1，默认 0.78），图例框 / 标题牌 / 比例尺 / 文字标识统一半透明，Canvas `globalAlpha` 与 SVG `fill-opacity` 双端同效，绝不遮死底图 |
| 设计系统 | 浅色纸本测绘工坊：3px 黄铜底轨 + 松针绿圆钮仪表滑块、定制下拉箭头、隐藏数字微调、药丸 Switch、纸本卡片分区；TopBar 三段式 + 细竖线；选项栏分段控件；检视器六标签不裁字 |
| 性能 | 离屏缓存命中后按平移偏移贴图，拖拽 / 悬停 / 草稿 / ramp 预览不再退回全量直绘；悬停等高线改由第 14 层浮层绘制，静态底图不失效；Worker 编译 0.9s 看门狗 + 同步兜底，首屏不再空白 |
| 制图质感 | 淡彩带水平 RLE 合并（7744 → <=1500 面）+ 角点抖动；晕滃线长 4.5–10.5m；摊棚浅色细描边 + 11.6m 排距 + 随机断口；citadel 屋顶改暖赭金；标注右/下夹紧、地标与建筑名让位、宁缺不叠 |
| 工程精修 | 长湖东北驿道跨 R2147 河口架木桥连至边界；帕隆窄峡只余 1 座双堡桥 + 1 座渠桥，桥头堡与五边形堡寨重叠时自动让位；村寨骨架贴合干道（< 10m）不再重复推白线 |
| 叠放层级 | 每个可选物体（选区 / 河 / 渠 / 道路 / 堰 / 码头 / 工坊 / 建筑群 / 桥防）都有 `zIndex`，检视器「叠放层级」四键可置底 / 下移 / 上移 / 置顶，任意物体都能压过道路与屋宇或沉到水体田畴之下；全默认时仍按 17 层画家序列输出，导出分层不变 |
| 路即桥 | 不再单独绘制桥面 / 栏杆 / 拱线，路面直接跨水即读作桥（仅双桥头堡保留堡体），桥位不再截断道路 |
| 等高线置顶 | 等高线恒绘于全部地图对象之上（等效 z=9999，物体层级上限 500 远低于它）、文字标注之下；默认低透明度 0.35，地形面板「线条透明度」可在 0.05–1 间实时调整 |

### V3.0 终验结果

| 门禁 | 结果 |
| --- | --- |
| `npm run check` | 6 个测试文件 **148 passed**（`tsc --noEmit` + `biome lint` 0 错 0 警 + Vitest） |
| `npm run build` | 退出码 0，1.47s，`dist/assets/index.js` 635.57 kB / gzip 192.70 kB |
| `tests/verify_backend.py` | **141 项断言全部通过**（`dist/` 托管、工程原子存取与路径拦截、地理数据只读、上层核验联动） |
| 微模块红线 | `src/` **103** 个 `.ts/.tsx`，最大 **320** 行；零 `any` / `TODO` / `@ts-ignore`，`core/` 零 `Math.random` |
| 仓库边界 | `legacy_v1_js/`、`docs/01–04`、`候选工作区/`、`worldbuilding/` 零写入 |

> **运行环境说明**：本机 `worldbuilding/venv/bin/python3` 指向的 Homebrew 解释器符号链接已失效（`python@3.13` 未安装）。终验以同版本 Python 3.13 叠加 `PYTHONPATH=<venv>/lib/python3.13/site-packages` 运行同一 `tests/verify_backend.py`，**未创建、删除或改写 `worldbuilding/` 内任何文件**；脚本内的 `sys.executable` 亦自动继承该组合拉起 `server.py`。

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
│       ├── ToolDock.tsx                           # 左侧 7 组聚合工具坞（V3；严守 NG-01 无单栋房屋工具）
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
