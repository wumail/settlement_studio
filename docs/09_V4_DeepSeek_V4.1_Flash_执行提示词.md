# Settlement Studio V4.0 — DeepSeek V4.1 Flash 两棒接力执行提示词

| 文档属性 | 规范内容 |
| :--- | :--- |
| **适配模型** | `deepseek v4.1 flash`（建议分 2 棒在独立新会话依次投喂） |
| **工作目录** | `/Users/wumail/code/TERRAX/settlement_studio/` |
| **上游规格书** | [08_V4_AI语义制图引擎与CLI_MCP技术规格书.md](08_V4_AI语义制图引擎与CLI_MCP技术规格书.md) |
| **设计铁律** | `src/ai/`、`src/cli/`、`src/mcp/` 与外部世界观仓库 100% 解耦；单文件严格 `<= 320` 行 |

> **使用方式**：先复制 **第 1 棒提示词** 交给 DeepSeek V4.1 Flash；第 1 棒全绿验收后，再开新会话复制 **第 2 棒提示词** 完成 CLI、MCP 与端到端闭环。

---

## 第 1 棒提示词（阶段一：依赖安装 + 选址雷达 + 几何吸附 + 语义 Ops + resvg 视觉预览）

```text
你是负责实施 Settlement Studio V4.0 AI 赋能层的资深 TypeScript 图形与工具链工程师。
当前执行【V4.0 两棒接力 · 第 1 棒（核心无头引擎 V4-1 ~ V4-4）】。
工作目录严格限定为：/Users/wumail/code/TERRAX/settlement_studio/

【一、开工必读】
写任何代码前，请先完整读取：
1. /Users/wumail/code/TERRAX/settlement_studio/docs/08_V4_AI语义制图引擎与CLI_MCP技术规格书.md（全文精读）
2. 检查现有契约与渲染入口：
   - src/schema/{geometry.types,entity.schema,v3.entity.schema,project.schema,legend.schema,palette.schema,presets}.ts
   - src/core/compileScene.ts、src/core/terrain/elevationField.ts、src/core/math/{polygon,rng}.ts
   - src/renderer/{RenderBackend,SvgStringBackend,paintScene,exportUtils}.ts
   - package.json

【二、本棒交付目标（V4-1 ~ V4-4，暂不写 CLI 和 MCP 壳）】
1. 依赖安装（V4-1）：
   - 在 /Users/wumail/code/TERRAX/settlement_studio/ 安装且仅安装以下 3 个包：
     npm install @resvg/resvg-js @modelcontextprotocol/sdk
     npm install -D tsx
   - 不改动现有前端 UI、Vite 构建配置或 Tailwind 配置。

2. 选址雷达与编译诊断（V4-2）：
   - 新建 src/ai/spatialBrief.ts（如超 300 行请拆出辅助文件，严禁超过 320 行）：
     - 导出 buildSpatialRadar(project, scene): SpatialBrief
       * 8×8 网格采样（每格采样 3×3 子点取平均海拔、最大坡度、河湖占比，归类 'prime' | 'marginal' | 'steep' | 'water'）；
       * 河道沿累计弧长归一化采样 5 点（长河 > 1800m 采样 9 点），含 [x, y]、实测或插值河宽、tangentDeg、leftNormal、rightNormal；
       * 水体、明渠、选区（含 buildingCount/treeCount/plotCount/meanSlopeDeg/maxSlopeDeg/status/emptyReason）、结构件、水工、自动桥位、地标、碰撞报告汇总与可执行 warnings（空区归因、非嵌套选区重叠、地标间距 < 65m 拥挤告警）。
     - 导出 querySpatialPoint(project, scene, x, y): SpatialPointQuery
       * 返回 elevM、slopeDeg、inWater、inExclusion、nearestRiver（含 riverId/t/distM/bank/centerPoint/bankPoint/tangentDeg）与 nearestCanal。

3. 几何吸附与高层语义操作（V4-3）：
   - 新建 src/ai/geometrySnap.ts：
     - 实现 samplePolylineAtT、sampleRiverWidthAtT、computeSnappedWeir、computeSnappedDock（支持 river 与 waterBody，且 angleDeg 严格指向水面内部！）、computeSnappedWatermill（贴岸平行水流且自动推导面向水体的 wheelSide）、buildRelativePolygon（支持 'rect' | 'octagonal' | 'polygon_13' | 'organic'，精确面积归一化与图幅内夹紧，确定性无 Math.random）、resolveAnchorPoint（坐标 / 河岸 / 选区边 / 实体 / 图幅边界）。
   - 新建 src/ai/semanticOps.ts（及按需拆分的 src/ai/opSchemas.ts，确保每个文件 <= 320 行）：
     - 导出 GeoBootstrapPayloadSchema、AiOpSchema（覆盖规格书第 2.3 节全部 21 种 op）、applySemanticOps(project, ops)；
     - 所有 op 经 Zod 严格校验、按 id 幂等 upsert、末尾统一 normalizeProject + compileSettlementScene，返回 { project, scene, applied, warnings, brief }。

4. 多模态视觉自检渲染器（V4-4）：
   - 新建 src/ai/previewRaster.ts：
     - 导出 renderPreviewPng(project, scene, options): PreviewRenderResult；
     - 复用 SvgStringBackend + paintScene（零重复绘制逻辑！）；
     - 支持全图模式（standard / guided / clean）与局部放大模式（crop: { zoneId } | { entityId } | { bbox }，特写图不叠大图例）；
     - 当 gridOverlay === true 时，在 SVG 顶层追加 <g id="layer-ai-grid">（浅色虚线坐标网 + 顶/左数字刻度）；gridOverlay === false 时严格不包含该层；
     - 通过 @resvg/resvg-js 的 Resvg 渲染 PNG（启用 loadSystemFonts: true 以确保中文标注正常显示）。

5. 单元测试（第 1 棒部分）：
   - 新建 tests/ai-engine-and-mcp.test.ts，覆盖规格书第 5 节的项 1~4 及项 7（选址雷达与陡坡空区归因、snap_weir/snap_dock/snap_watermill/place_zone/connect_road 几何精度、apply_geo_bootstrap、renderPreviewPng 全图/网格/局部裁切 PNG 魔数验证、解耦静态守卫）。

【三、硬性工程护栏（违反任一条即不通过）】
1. src/ 下每一个 .ts / .tsx 文件物理行数严格 <= 320 行；零 any / as any / @ts-ignore / TODO / FIXME；src/core/ 与 src/ai/ 严禁 Math.random()。
2. 解耦红线：src/ai/ 下严禁出现 设定/、地图/、worldbuilding、Losrumura、Lōsrūmūra、长湖、帕隆、server.py 等任何外部仓库路径或世界观专有名词（Op 契约统一使用 geoAnchor，仅在落入既有 MetaSchema 时映射至 meta.terraxAnchor）。
3. 严禁修改 legacy_v1_js/、docs/、projects/ 以及 /Users/wumail/code/TERRAX/settlement_studio/ 以外的任何文件。
4. 严禁破坏既有 175 项测试与前端构建。
5. 完成后依次执行并确认全部退出码为 0：
   - npm run check
   - npm run build
   - 全目录 src/**/*.ts(x) 行数扫描确认最大行数 <= 320。
```

---

## 第 2 棒提示词（阶段二：共享会话层 + 终端 CLI + 6 工具轻量 MCP + 端到端闭环测试）

```text
你是负责实施 Settlement Studio V4.0 AI 赋能层的资深 TypeScript 工具链与 MCP 架构师。
当前执行【V4.0 两棒接力 · 第 2 棒（共享会话 + CLI + 轻量 MCP + 端到端验证 V4-5 ~ V4-7）】。
工作目录严格限定为：/Users/wumail/code/TERRAX/settlement_studio/

【一、开工必读】
写任何代码前，请先完整读取：
1. /Users/wumail/code/TERRAX/settlement_studio/docs/08_V4_AI语义制图引擎与CLI_MCP技术规格书.md（重点精读第 4、5 章）
2. 读取第 1 棒已完成的 src/ai/*.ts 与 tests/ai-engine-and-mcp.test.ts、package.json。

【二、本棒交付目标（V4-5 ~ V4-7）】
1. 共享会话与原子落盘（V4-5）：
   - 新建 src/ai/session.ts：
     - 导出 StudioSession 类（维护 project / scene / sourcePath / 20 步 history 撤销栈，封装 open / inspect / queryPoint / applyOps / renderPreview / save / undo）；
     - 导出 saveProjectAtomic(filePath, project, options?)：同目录临时文件 + fs.renameSync 原子落盘；默认拦截受保护的 3 套基准工程文件名（按 basename 判定），仅在 allowOverwriteProtected: true 时允许覆盖。

2. Agent 终端 CLI（V4-6）：
   - 新建 src/cli/studioCli.ts（保持 <= 320 行，必要时拆参解析辅助模块）：
     - 在 package.json scripts 中新增：
       "studio": "tsx src/cli/studioCli.ts"
       "mcp": "tsx src/mcp/studioMcp.ts"
     - 实现全部 6 个子命令（全部输出纯净 JSON 到 stdout，失败输出 { "ok": false, "error": "..." } 并 process.exit(1)）：
       * init --out <path> [--preset blank|losrumura|changhu|palong] [--world-size 2400] [--name "..."] [--subtitle "..."] [--geo-file <geo.json>]
       * inspect <path>
       * query <path> --x <num> --y <num>
       * apply <path> --ops <ops.json|-> [--out <path>] [--allow-overwrite-protected]
       * render <path> --out <preview.png> [--svg-out <preview.svg>] [--mode standard|guided|clean] [--width 1400] [--grid] [--crop-zone <id>] [--crop-entity <id>] [--crop-bbox x0,y0,x1,y1]
       * export <path> --out-svg <out.svg> [--out-png <out.png>] [--mode standard|guided|clean] [--width 2000]（严格 gridOverlay: false）

3. 6 工具轻量 MCP Server（V4-7）：
   - 新建 src/mcp/studioMcp.ts（保持 <= 320 行，导出 createStudioMcpServer() 供测试直接调用，主入口判定直接执行时连接 StdioServerTransport）：
     - 注册精确 6 个工具（全部薄包装调用 StudioSession）：
       1) studio_open
       2) studio_inspect
       3) studio_query_point
       4) studio_apply_ops
       5) studio_render_preview（同时返回 text 摘要 + 原生 image content block：type: 'image', data: base64Png, mimeType: 'image/png'）
       6) studio_save
     - 注册 2 个只读 MCP Resources：
       1) studio://schema/ops（返回精简 ops 使用指南 JSON/Markdown）
       2) studio://examples/presets（返回内置预设尺度与选区指标摘要）

4. 补齐端到端测试：
   - 扩充 tests/ai-engine-and-mcp.test.ts，补齐规格书第 5 节项 5、6、7：
     - CLI 真实子进程测试（写入 os.tmpdir() 临时目录，测试结束后清理）：init → apply → inspect → render → export 全流程，以及误覆盖受保护文件名拦截；
     - MCP Server 测试：使用 @modelcontextprotocol/sdk 的 InMemoryTransport（或直连 createStudioMcpServer）验证 6 工具列表、studio_open → studio_apply_ops → studio_render_preview 返回 image/png base64 且魔数合法、2 个只读资源可读；
     - 解耦静态守卫覆盖 src/ai/、src/cli/、src/mcp/ 全部文件。

【三、硬性工程护栏】
1. src/ 下每一个 .ts / .tsx 文件物理行数严格 <= 320 行；零 any / as any / @ts-ignore / TODO / FIXME；src/core/ 与 src/ai/ 严禁 Math.random()。
2. 解耦红线：src/ai/、src/cli/、src/mcp/ 严禁硬编码任何外部仓库目录或特定世界观名词。
3. 严禁修改 legacy_v1_js/、docs/、projects/ 以及 /Users/wumail/code/TERRAX/settlement_studio/ 以外的任何文件。
4. 完成后必须依次执行并确认全部退出码为 0：
   - npm run check
   - npm run build
   - 全目录 src/**/*.ts(x) 行数扫描确认最大行数 <= 320
   - 现场运行一条 CLI 冒烟命令把临时目录的预览图渲染出来确认零报错并清理临时文件。
```

---

## 断点返修提示词（按需使用）

```text
请对照 /Users/wumail/code/TERRAX/settlement_studio/docs/08_V4_AI语义制图引擎与CLI_MCP技术规格书.md，针对以下具体问题在 /Users/wumail/code/TERRAX/settlement_studio/ 内做最小化定向修复：
<在此列出审查发现的具体问题与文件>

约束：保持 src/ 所有文件 <= 320 行、零 any、零外部世界观耦合，修完后必须完整通过 npm run check 与 npm run build。
```
