---
name: settlement-studio-mapper
description: >-
  Design and author plausible settlement maps in Settlement Studio from detailed lore,
  sparse geographic briefs, or requests for constrained random variation. Guides spatial
  planning, semantic CLI/MCP operations, local generation, and lightweight map review.
---

# Settlement Studio Mapper

使用现有 Studio 把一个连贯的地方构想做成地图。输入可以是故事、城市资料，也可以只有地点、气候、地貌和聚落等级；没有故事时同样适用。

## 先设计，再操作

开始新图或实质重做前，阅读 [references/settlement-design.md](references/settlement-design.md)。用一份短简报明确地方身份、生计/水源/对外联系、空间骨架，以及需要保留和允许变化的选择。少量缺失信息可以自主推定，不要求用户先写完整设定。

抽卡分两层：先在环境与用途允许的范围内选择布局方案，再用 zone seed 变化建筑、田地、林木等细节。局部重抽时保持主方案；用户要求换方案时才改变主骨架。

- 普通城市不默认有城墙、中心堡寨、港口或复杂水工；这些设施应有用途依据。
- 地形、道路、功能区的位置相互支持；先确定关系，再确定坐标和选区。
- 生产用地与使用者的居住空间一起安排。田地可由镇边居民、邻近小村或散居农户耕作；根据距离、地形和地方生活方式选择，不给每片田机械地配一个村。明确农居主要服务哪些田片，并结合田径和高差考虑日常往返。
- 同幅地图中的建筑、道路、营地和农田使用一致的尺度。尺寸建议是起点，不是每图必须凑齐的指标。
- 保护既有基准工程；对照迭代使用新文件。

## 工具与参考

命令在 `settlement_studio/` 运行。CLI 适合批次操作，MCP 适合会话交互。

| 用途 | CLI (`npm run studio -- ...`) | MCP |
| --- | --- | --- |
| 新建 | `init --out <file> [--preset blank] [--world-size 3600] [--geo-file <geo.json>]` | `studio_open` |
| 地形/产出概览 | `inspect <file>` | `studio_inspect` |
| 点高程/坡度/最近水线 | `query <file> --x <m> --y <m>` | `studio_query_point` |
| 语义批次 | `apply <file> --ops <ops.json或-> [--out <file>]` | `studio_apply_ops` |
| 预览 | `render <file> --out <p.png> [--grid] [--crop-zone <id>]` | `studio_render_preview` |
| 成图 | `export <file> --out-svg <m.svg> [--out-png <m.png>] [--mode standard或guided]` | `studio_save` |

参数见 [references/ops-cheatsheet.md](references/ops-cheatsheet.md)。选择尺寸和查看成图时参照 [references/cartography-standards.md](references/cartography-standards.md)，结合当前环境和用途取舍，不照抄一整套设施。

工具边界会影响设计：
- `inspect` 的 8×8 雷达是选址辅助；没有告警不等于空间已经合理。
- `connect_road` 连接锚点并平滑，不会替模型选顺坡路线。需要绕行时明确给 `via`。
- 道路穿过围墙边界才派生门；需要入口时把道路延伸到院内。`entityId` 通常指建筑中心，通路终点应留在建筑外的入口空地。
- `snap_weir/dock/watermill` 用来贴水对齐；吸附不代替供水和用途判断，水线后改时需重新考虑位置。
- `place_zone` 支持自定义 `points`，也支持 `relative` 的相对形状。地形限制明显时使用适合场地的轮廓，不强套规则多边形。

## 制作顺序

### 1. 环境与主要通路

按简报设置图幅，初始化并 `inspect`。图幅要容纳目标距离和地方结构，不因“城镇模板”就固定跨度。

用语义操作建立坡地、山谷、水源/水线和对外通路。大尺度地理引导不足以确定本地微地形，设计时保留其证据边界。对关键高差和明显可疑的路线做少量点查询；不必逐点采样全图。

预览这一阶段：能否认出预期的谷口、河阶、山坡、海湾等结构？道路的目的地是否清楚？有矛盾先调整，再放聚落。

### 2. 核心与功能空间

从水源、路口、市场、公共院落、作坊或其他形成原因安排核心。依据用途选择 `town_blocks/village/walled_city/citadel/market` 等 primitive；primitive 的名称不是必须添加该设施的理由。

先给重要公共/生产空间留位置与通路，再安排住宅、关厢和田地。对外围生产区同时安排使用者的住处、必要的院场和接近路线；让住宅边缘、菜园与田地有适当过渡。使用道路和适当留白组织街区；特别建筑用 `upsert_structure`。需要水工时用 `snap_*` 对齐。

### 3. 局部生成

按确定的骨架生成房屋、耕地、林带等。观察生成结果与原构想的关系，必要时改选区、主路或密度；骨架不合适时，换 seed 通常解决不了。

使用 `reroll_zone` 做局部变体，满意后保持其种子。不同区块不必密度相同；留白可以是活动场地、缓坡、荒地或尚未开发区域。

### 4. 按活动检查实际地图

选少量典型活动，对照预览和已生成对象走一遍：居民取水/出行、货物进市、生产空间使用，以及本任务特有路线。检查是否存在显然缺少的入口、目的地或空间冲突，并做针对性修改。

查看现有碰撞与空区诊断，处理实际问题；不要为了消除告警就盲目抬高坡度阈值。看全图和关键局部，至少完成一次有具体发现的复查；若初稿已符合构想，说明观察依据即可，不为了满足次数而改图。

### 5. 导出与说明

导出无 AI 网格的标准 PNG/SVG，按需要增加导览版。简要交代地方构想、主要设计选择、种子/变体、复查后的改动及剩余限制。不要把生成数量、零碰撞或零告警当成“真实合理”的证明。
