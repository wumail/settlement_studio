> [!IMPORTANT]
> **Frozen V1.2.2 Vanilla JS Golden Reference Archive（V1.2.2 原生 JS 冻结黄金对拍归档库）**
> 本目录完整归档已通过三轮终审闭环的 **Terrax Settlement Studio V1.2.2** 原生 ES Module 参考实现与自动化基准测试（首轮 `177/177` + `53/53` 全绿，V1.2.2 终审扩充至前端 `177/177` + 后端 `81/81` 全绿）。本目录作为 V2.0 TypeScript 架构升级的**只读几何与渲染黄金对拍神谕（Golden Reference Oracle）**永久保留；最新 V2.0 TypeScript 工程规格基线请查阅上层主目录 [../README.md](../README.md)。

# Terrax Settlement Studio (Legacy V1.2.2 Vanilla JS Archive)

**Terrax Settlement Studio** 是面向 [TERRAX 建世资料库](../../README.md) 的仓库级通用聚落可视化编辑与受控抽卡制图工作台，与跨平台星空创作端 [Terrax Sky Studio](../../worldbuilding/README.md) 并列独立部署，专门承担 `300 m — 6,000 m` 微观聚落尺度（都城、湖岸复合市镇、高山峡谷村寨）的交互式地形水系铺设、多边形选区原地抽卡、零穿模硬碰撞避让、全要素图形图例编辑及高清成图交付。

> **当前工程状态说明（V1.2.2 终审收口版）：** **V1.2 已完成全量编码与自动化双端验收；V1.2.1 复审 7 项 P0 + 5 组 P1/P2、V1.2.2 终审 6 处精准收口（水渠急折、拾取顺序、图例改色、自定义图例、禁建树/菜畦/缓存签名、旋转连杆）已全部清零**。`M0 — M6` 七大里程碑 `37 / 37` 项原子任务闭环：7 个零依赖 ES Module 内核与前端、浅色纸本测绘工坊 UI、本地 Python 地理桥接服务、3 套世界观精品示例工程与双端自动化核验脚本均已落盘并通过实测。前端 `node tests/verify_headless.mjs` 通过 **177 项断言**（含 200 次随机种子零穿模、反序城墙、重抽零河中树与斜交桥四角压测），后端 `tests/verify_backend.py` 通过 **81 项断言**（含 TERRAX 真值读取、经度 `cos(lat)` 梯度、6 路并发保存、只读零侵入与三套上层核验脚本联跑），两者退出码均为 `0`。

| 交付维度 | 实测结论 |
| --- | --- |
| 三套示例工程 | 起点城 `2895` 屋宇（3 段城垣 / 2 座城门 / 42 敌台）/ 长湖 `1542` / 帕隆 `253`（40 段菜畦），`collisionReport.passed === true`、`riverIslands === 0`，且与内嵌预设逐字一致 |
| 零穿模红线 | 综合压测场 + 3 套示例 × 50 组随机种子 = `200` 次编译，五类穿模命中与河心岛计数恒为 `0`；反序 `[market, walled_city]` 与重抽后同样恒 `0`，河中树木恒 `0` |
| 地理真值桥接 | `42.51°E, 35.19°N` → `row=913, col=3708, elevM=484.9, isLand=true, slopeDir=312.9°`（经度梯度已乘 `cos(lat)`），检出 `R1966`（最近 `0.09 km`） |
| 仓库零侵入 | 五大地理数据文件 sha256 与 `mtime_ns` 前后一致；`worldbuilding` git 状态零新增条目；三套上层核验脚本（候选稿 / 志书集 / 待定故事集）退出码全 `0` |

---

## 核心基线文档入口

| 序号 | 文档路径 | 版本 | 核心职责与阅读指引 |
| --- | --- | --- | --- |
| 01 | [docs/01_BRD_业务需求文档.md](docs/01_BRD_业务需求文档.md) | V1.2 | 世界观尺度断层诊断、前期外部工具与静态脚本失败根因复盘、核心业务目标（`BRD-G01 ~ BRD-G06`）、用户场景（`UC-01 ~ UC-04`）、V1 刻意不做项（含不做单栋房屋手动增删改）及硬性业务验收门禁（`BG-01 ~ BG-08`）。 |
| 02 | [docs/02_PRD_产品需求与技术规格书.md](docs/02_PRD_产品需求与技术规格书.md) | V1.2 | 十大功能模块技术规格（`FR-01 ~ FR-10`）、全新「浅色纸本测绘工坊」CSS 色板体系、`.worldtown.json` 完整 Schema、跨模块精确 `export` 函数签名、等高线数学公式、`512×512` SDF 加解析线段双重零穿模算法及 TERRAX 二进制地理数据只读桥接契约。 |
| 03 | [docs/03_执行对照计划表与验收溯源矩阵.md](docs/03_执行对照计划表与验收溯源矩阵.md) | V1.2 | `M0 — M6` 七阶段里程碑规划、`T-0.1 ~ T-6.6` 原子任务打勾对照表、`BRD / BG / FR` 端到端双向需求溯源矩阵、无头与后端自动化核验脚本规格及执行期变更审计日志表。 |
| 04 | [docs/04_DeepSeek_V4.1_Flash_执行提示词.md](docs/04_DeepSeek_V4.1_Flash_执行提示词.md) | V1.2 | 面向 `deepseek v4.1 flash` 定制的 7 条防偷懒与防占位符硬性护栏，提供【方案一：单轮全自动通关总提示词】与【方案二：分三棒稳健接力提示词】两套可直接复制投喂的执行指令。 |

---

## 交付工程文件树

以下文件树为 V1.2 实际交付结构，与 `docs/02_PRD` 第 1.1 节锁死目录逐字一致：

```text
settlement_studio/
├── README.md                                  # 工程状态声明、核心文档导航、交付文件树与验收命令
├── docs/
│   ├── 01_BRD_业务需求文档.md                 # 业务需求与八大验收门禁基线
│   ├── 02_PRD_产品需求与技术规格书.md         # 产品交互、数据结构、导出接口与算法规格圣经
│   ├── 03_执行对照计划表与验收溯源矩阵.md     # 原子任务勾选进度表与双向需求溯源矩阵
│   └── 04_DeepSeek_V4.1_Flash_执行提示词.md   # 单轮通关与三棒接力专用执行提示词
├── server.py                                  # 本地静态资源与 TERRAX 经纬度地理初值只读 API 服务（默认端口 8765）
├── web/
│   ├── index.html                             # 浅色纸本测绘工坊单页工作台入口（支持无后端纯静态打开）
│   ├── css/
│   │   └── atelier.css                        # Light Cartographer's Atelier 视觉变量、三栏面板与悬浮工具坞样式
│   └── js/
│       ├── state_and_schema.js                # .worldtown.json Schema、40 步历史撤销栈、4 套调色板与图例同步底座
│       ├── terrain_engine.js                  # 257×257 Float32Array 高程场、Marching Squares、等高线推拉与四支涂抹笔刷
│       ├── hydro_road_engine.js               # 纯净无小岛水系、显式基岩礁石、样条道路与跨河自动正交桥梁内核
│       ├── gacha_zone_engine.js               # 9 类多边形抽卡选区生成器与 512×512 SDF + 解析线段零穿模碰撞引擎
│       ├── canvas_renderer.js                 # Watabou 钢笔淡彩渲染器、双遍融合树冠、画布内图形符号图例框与比例尺
│       ├── exporter.js                        # 1x/2x/3x 高清 PNG 离屏渲染导出与独立矢量 SVG 导出器
│       └── app.js                             # 视口矩阵变换、全工具交互状态机、属性/图例/配色面板与快捷键联调
├── projects/
│   ├── 起点城_Losrumura.worldtown.json        # 都城示例：起点都城 Lōsrūmūra（42.51°E, 35.19°N，DEM 真值 484.9 m）
│   ├── 长湖_复市镇.worldtown.json             # 市镇示例：长湖西南岸复市镇（35.61°E, 28.53°N，DEM 真值 427.5 m / 湖岸 414 m）
│   └── 帕隆_峡谷铁寨.worldtown.json           # 村寨示例：帕隆北支停战线双生铁寨（29.04°E, 14.58°N，DEM 真值 1662.6 m / 谷底约 1650 m）
└── tests/
    ├── verify_headless.mjs                    # Node 原生 ES Module 无头几何、等高线推拉与 50 组种子零穿模核验脚本
    └── verify_backend.py                      # Python 服务端地理初值 API 精度与仓库既有基线零侵入核验脚本
```

---

## 核心设计原则摘要

1. **宏观确定性与局部受控抽卡解耦**：高程等高线、纯净河湖海岸、主干道路与多边形功能区边界 100% 由用户可控编辑；选区内部街坊切分、沿街密排屋宇、村寨院落、农田条垄与晒盐池格通过选区级 `seed` 在画布原地秒级重抽，V1 刻意不做单栋房屋的手动增删改拖拽。
2. **物理常识 100% 零穿模红线**：内置 `512×512` Chamfer 有向距离场栅格与解析线段复检双重硬碰撞管线，彻底杜绝道路穿房、河渠穿房、桥梁斜交错位、陡崖违建以及普通窄河道随机生成香肠状河心小岛。
3. **图面 100% 自解释与全要素图形图例**：全面废除不明蝌蚪尖刺状示坡纹，所有上图要素自动生成微缩真图形图例，并支持在线改名、改色、显隐、四角停靠与自定义图例地标扩展。
4. **地图质感与外框工作台视觉分离**：画布内聚落地图严守 Watabou City 经典暖羊皮纸钢笔淡彩质感并统一覆盖城、镇、村三级尺度；软件外框界面采用全新设计的「浅色纸本测绘工坊（Light Cartographer's Atelier）」，与 `worldbuilding/` 暗色星空界面完全独立。

---

## 启动与自动化验收命令（V1.2 已实测通过）

统一使用仓库自带 Python 科学计算环境 `/Users/jrdamocles/code/TERRAX/worldbuilding/venv/bin/python3` 与系统 Node.js（ES Module 原生模式，零第三方 npm 依赖）：

| 操作或核验阶段 | 执行命令（工作目录：`/Users/jrdamocles/code/TERRAX/settlement_studio/legacy_v1_js`） | 通过判据摘要 |
| --- | --- | --- |
| 启动本地测绘工作台 | `/Users/jrdamocles/code/TERRAX/worldbuilding/venv/bin/python3 server.py --port 8765` | 浏览器访问 `http://127.0.0.1:8765/web/index.html`（或 `http://127.0.0.1:8765/`）正常加载浅色工坊与预置工程；`?preset=losrumura|changhu|palong` 可直达示例。经任意静态服务器或 `file://` 直接打开时，除「导入 TERRAX 经纬度」外全部编辑、抽卡、图例、配色与 PNG/SVG 导出 100% 可用。 |
| 前端内核无头全量核验 | `node tests/verify_headless.mjs` | 实测退出码 `0`（177 项断言，约 37 s）；9 类选区全部正常产出几何，最差单区重抽 `65.7 ms`（31 ha，< 80 ms）；100 步等高线推拉与四支笔刷零 `NaN` 零自交；200 次随机编译五类穿模与 `riverIslands` 恒 `0`，并覆盖反序城墙、重抽零河中树、斜交桥四角、凹多边形、水渠 90° 急折与缓存签名失效。 |
| 后端地理桥接与零侵入核验 | `/Users/jrdamocles/code/TERRAX/worldbuilding/venv/bin/python3 tests/verify_backend.py` | 实测退出码 `0`（81 项断言）；临时端口起停 `server.py`，`/api/ping`、`/api/projects`、`/api/terrax-context`（`row=913/col=3708/484.9 m`、`slopeDir=312.9°`、`R1966`）、POST 落盘与路径剥离防逃逸全部通过；6 路并发保存同名工程全部 `200` 且零 `.tmp` 残留；五大地理数据 sha256 与 mtime 零变化；三套上层核验脚本退出码全 `0`。 |
