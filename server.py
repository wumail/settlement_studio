#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Terrax Settlement Studio V2.0 — 本地静态服务与 TERRAX 球面地理数据只读桥接器。

启动方式（02_PRD_V2 第 8.3 节）：
    /Users/jrdamocles/code/TERRAX/worldbuilding/venv/bin/python3 server.py --port 8765

端点：
    GET    /api/ping
    GET    /api/geo/bootstrap?lon=&lat=&span_m=      （兼容别名 /api/terrax-context）
    GET    /api/projects
    GET    /api/projects/<filename>
    POST   /api/projects
    DELETE /api/projects/<filename>

只读铁律（V2-BG-10）：本文件对 REPO_ROOT / "地图" 下的全部 .bin / .npz / .json 数据
仅以 numpy 的 mode="r"（只读）打开，不写入、不修改时间戳、不创建任何缓存文件。
工程写盘一律使用同目录 tempfile.mkstemp + os.replace 原子替换，并由进程内线程锁串行化；
文件名先经 Path(name).name 剥离路径分隔符，落盘位置恒定为 projects/*.worldtown.json。
"""

from __future__ import annotations

import argparse
import datetime as _datetime
import json
import math
import mimetypes
import os
import sys
import tempfile
import threading
import traceback
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import parse_qs, unquote, urlparse

# ------------------------------------------------------------------------------------------------
# 零、常量与路径
# ------------------------------------------------------------------------------------------------

SERVICE_NAME = "terrax-settlement-studio"
SERVICE_VERSION = "2.0.0"

STUDIO_DIR: Path = Path(__file__).resolve().parent
REPO_ROOT: Path = STUDIO_DIR.parent
DIST_DIR: Path = STUDIO_DIR / "dist"
PROJECTS_DIR: Path = STUDIO_DIR / "projects"

# —— TERRAX 四大底层地理数据源精确路径（02_PRD_V2 第 8.3 节） ——
BASE_MAP_DIR: Path = REPO_ROOT / "地图/01_地图成品与复现/03_依据与复现"
SOURCE_DATA_DIR: Path = BASE_MAP_DIR / "models/coupled/data"

DEM_BIN_PATH: Path = SOURCE_DATA_DIR / "lake_bed_dem.bin"
OWNER_NPZ_PATH: Path = BASE_MAP_DIR / "修订数据/20260923_地貌重新推导/global_owner.npz"
LAKE_NPZ_PATH: Path = BASE_MAP_DIR / "修订数据/20260926_既定联算同步/map_lake_mask.npz"
CENTERLINES_NPZ_PATH: Path = SOURCE_DATA_DIR / "water_vectors/rendered_centerlines.npz"
CENTERLINE_IDX_PATH: Path = SOURCE_DATA_DIR / "water_vectors/centerline_index.json"
OBJECT_IDX_PATH: Path = BASE_MAP_DIR / "修订数据/20260927_对象与分区标注/object_index.json"

RESOLUTION_DEG: float = 0.06
PLANET_DEG_LAT_M: float = 122466.0  # 母星 R = 7016.8 km，1° 纬度弧长
PLANET_GRID_ROWS: int = 3000
PLANET_GRID_COLS: int = 6000
LAND_OWNERS: Tuple[int, int] = (6, 7)
GRID_CELL_M: float = RESOLUTION_DEG * PLANET_DEG_LAT_M  # ≈ 7347.96 m

MAX_BODY_BYTES: int = 16 * 1024 * 1024
MAX_PROJECT_BYTES: int = 8 * 1024 * 1024
MAX_FILENAME_CHARS: int = 180
RIVER_SEARCH_PAD_DEG: float = 0.25
MAX_NEARBY_RIVERS: int = 3

PROJECT_SUFFIX: str = ".worldtown.json"
PROTECTED_PROJECTS: Tuple[str, ...] = (
    "起点城_Losrumura.worldtown.json",
    "长湖_复市镇.worldtown.json",
    "帕隆_峡谷铁寨.worldtown.json",
)


# ------------------------------------------------------------------------------------------------
# 一、地理真值只读加载
# ------------------------------------------------------------------------------------------------

class GeoDataError(RuntimeError):
    """地理数据不可用（文件缺失、numpy 缺失或数据形状不符）。"""


class GeoBundle:
    """一次性只读装载四大数据源，并预计算河流包围盒与制图分类标签。"""

    def __init__(self) -> None:
        import numpy as np  # 延迟导入：numpy 缺失时由 /api/ping 汇报 terraxDataAvailable=False

        self.np: Any = np
        required: Tuple[Path, ...] = (
            DEM_BIN_PATH,
            OWNER_NPZ_PATH,
            LAKE_NPZ_PATH,
            CENTERLINES_NPZ_PATH,
            CENTERLINE_IDX_PATH,
        )
        missing: List[str] = [str(p.relative_to(REPO_ROOT)) for p in required if not p.exists()]
        if missing:
            raise GeoDataError("缺失地理数据文件：" + "；".join(missing))

        # 1. 高程场：只读内存映射，shape=(3000, 6000)，dtype="<f4"（米制海拔）
        self.dem: Any = np.memmap(
            DEM_BIN_PATH,
            dtype="<f4",
            mode="r",
            shape=(PLANET_GRID_ROWS, PLANET_GRID_COLS),
        )

        # 2. 海陆板块归属：owner ∈ (6, 7) 为 B 大陆陆地，owner == 0 为大洋
        with np.load(OWNER_NPZ_PATH, allow_pickle=False) as owner_npz:
            self.owner: Any = owner_npz["owner"]

        # 3. 湖泊与冰盖掩码：mean_id > 0 表示常年湖泊格点
        with np.load(LAKE_NPZ_PATH, allow_pickle=False) as lake_npz:
            self.lake_id: Any = lake_npz["mean_id"]
            self.ice: Any = lake_npz["ice"] if "ice" in lake_npz.files else None

        # 4. 全球河流矢量中心线：points[:, 0] 为浮点列号，points[:, 1] 为浮点行号
        with np.load(CENTERLINES_NPZ_PATH, allow_pickle=False) as cl_npz:
            self.centerline_points: Any = cl_npz["points"]

        with CENTERLINE_IDX_PATH.open("r", encoding="utf-8") as fp:
            raw_index: Any = json.load(fp)

        self.rivers: List[Dict[str, Any]] = []
        for rec in raw_index:
            try:
                start: int = int(rec["start"])
                count: int = int(rec["count"])
            except (KeyError, TypeError, ValueError):
                continue
            if count <= 0 or start < 0 or start + count > len(self.centerline_points):
                continue
            seg: Any = self.centerline_points[start:start + count]
            cols: Any = seg[:, 0]
            rows: Any = seg[:, 1]
            self.rivers.append({
                "id": str(rec.get("id")),
                "start": start,
                "count": count,
                "lon_min": float(cols.min()) * RESOLUTION_DEG - 180.0,
                "lon_max": float(cols.max()) * RESOLUTION_DEG - 180.0,
                "lat_min": 90.0 - float(rows.max()) * RESOLUTION_DEG,
                "lat_max": 90.0 - float(rows.min()) * RESOLUTION_DEG,
            })

        # 5. 河名 / 湖名与制图分类（只读标注索引，缺省时降级为 minor）
        self.river_labels: Dict[str, str] = {}
        self.river_categories: Dict[str, str] = {}
        self.lake_labels: Dict[str, str] = {}
        if OBJECT_IDX_PATH.exists():
            with OBJECT_IDX_PATH.open("r", encoding="utf-8") as fp:
                object_index: Any = json.load(fp)
            for item in object_index.get("rivers", []):
                rid: str = str(item.get("id", ""))
                if not rid:
                    continue
                self.river_labels[rid] = str(item.get("label_text") or f"R{rid}")
                self.river_categories[rid] = str(item.get("retained_display_category") or "minor")
            for item in object_index.get("lakes", []):
                lid: str = str(item.get("id", ""))
                if lid:
                    self.lake_labels[lid] = str(item.get("label_text") or f"L{lid}")

        self.shape: Tuple[int, int] = (int(self.dem.shape[0]), int(self.dem.shape[1]))
        if self.shape != (PLANET_GRID_ROWS, PLANET_GRID_COLS):
            raise GeoDataError(
                f"高程场形状异常：期望 {(PLANET_GRID_ROWS, PLANET_GRID_COLS)}，实际 {self.shape}"
            )

    # —— 坐标换算（2 度网格中心对齐） ——
    @staticmethod
    def lonlat_to_rowcol(lon: float, lat: float) -> Tuple[int, int]:
        col: int = int(min(max(math.floor((lon + 180.0) / RESOLUTION_DEG), 0), PLANET_GRID_COLS - 1))
        row: int = int(min(max(math.floor((90.0 - lat) / RESOLUTION_DEG), 0), PLANET_GRID_ROWS - 1))
        return row, col

    @staticmethod
    def rowcol_to_lonlat(row: int, col: int) -> Tuple[float, float]:
        lon: float = (col + 0.5) * RESOLUTION_DEG - 180.0
        lat: float = 90.0 - (row + 0.5) * RESOLUTION_DEG
        return lon, lat

    def river_label(self, rid: str) -> str:
        return self.river_labels.get(rid, f"R{rid}")

    def river_category(self, rid: str) -> str:
        return self.river_categories.get(rid, "minor")


_geo_lock: threading.Lock = threading.Lock()
_geo_bundle: Optional[GeoBundle] = None
_geo_error: Optional[str] = None


def get_geo_bundle() -> Optional[GeoBundle]:
    """线程安全懒加载；失败后不反复重试，直接把原因缓存给 /api/ping 汇报。"""
    global _geo_bundle, _geo_error
    if _geo_bundle is not None:
        return _geo_bundle
    with _geo_lock:
        if _geo_bundle is not None:
            return _geo_bundle
        if _geo_error is not None:
            return None
        try:
            _geo_bundle = GeoBundle()
        except Exception as exc:  # noqa: BLE001 — 任何装载失败都要转成可报告的可用性状态
            _geo_error = f"{type(exc).__name__}: {exc}"
            traceback.print_exc(file=sys.stderr)
            return None
    return _geo_bundle


# ------------------------------------------------------------------------------------------------
# 二、局部窗口上下文计算（球面 cos(lat) 梯度修正）
# ------------------------------------------------------------------------------------------------

def _clamp(value: float, lo: float, hi: float) -> float:
    return lo if value < lo else (hi if value > hi else value)


def _round(value: float, digits: int = 1) -> float:
    return float(round(float(value), digits))


def _local_river_polyline(
    east_m: Any,
    south_m: Any,
    half: float,
    span_m: float,
    filter_band: bool = True,
) -> List[List[float]]:
    """把河段按米制弧长重采样为局部图幅坐标折线（严格保持上游→下游顺序）。

    原始中心线在宏观格网上平均每 6 km 才有一个顶点，直接投影会导致图幅内一个点都没有；
    此处按约 span/40（且不小于 90 m）的步长线性加密，保证斜穿全图。
    """
    n: int = len(east_m)
    if n == 0:
        return []
    if n == 1:
        return [[_round(half + float(east_m[0])), _round(half + float(south_m[0]))]]

    seg_len: List[float] = [0.0] * (n - 1)
    for i in range(n - 1):
        seg_len[i] = math.hypot(
            float(east_m[i + 1]) - float(east_m[i]),
            float(south_m[i + 1]) - float(south_m[i]),
        )
    cum: List[float] = [0.0] * n
    for i in range(1, n):
        cum[i] = cum[i - 1] + seg_len[i - 1]
    total: float = cum[-1]

    dist2: List[float] = [float(east_m[i]) ** 2 + float(south_m[i]) ** 2 for i in range(n)]
    nearest: int = min(range(n), key=lambda i: dist2[i])

    reach: float = span_m * 1.35
    lo: float = cum[nearest] - reach
    hi: float = cum[nearest] + reach
    step: float = max(90.0, span_m / 40.0)
    band_lo: float = -half - span_m * 0.25
    band_hi: float = span_m * 1.25

    out: List[List[float]] = []
    seg_idx: int = 0
    t: float = max(0.0, lo)
    end: float = min(total, hi)
    guard: int = 0
    while t <= end + 1e-6 and guard < 4000:
        guard += 1
        while seg_idx < n - 2 and cum[seg_idx + 1] < t:
            seg_idx += 1
        local_t: float = t - cum[seg_idx]
        seg: float = seg_len[seg_idx]
        ratio: float = 0.0 if seg <= 1e-9 else max(0.0, min(1.0, local_t / seg))
        ex: float = float(east_m[seg_idx]) + (float(east_m[seg_idx + 1]) - float(east_m[seg_idx])) * ratio
        sy: float = float(south_m[seg_idx]) + (float(south_m[seg_idx + 1]) - float(south_m[seg_idx])) * ratio
        x: float = half + ex
        y: float = half + sy
        if (not filter_band) or (band_lo <= x <= band_hi and band_lo <= y <= band_hi):
            out.append([_round(x), _round(y)])
        t += step
    if len(out) < 2:
        return []
    return out


def compute_terrax_context(lon: float, lat: float, span_m: float) -> Dict[str, Any]:
    """返回单点局部测绘引导上下文（真值海拔、海陆、坡向与邻近河流）。

    东西向物理格距随纬度按 cos(lat) 收缩，dz_dx 分母必须乘以球面修正因子；
    遗漏 cos(lat) 会使中高纬坡向角系统性偏转（起点城 312.9° → 307.2°）。
    """
    geo: Optional[GeoBundle] = get_geo_bundle()
    if geo is None:
        raise GeoDataError(_geo_error or "TERRAX 地理数据不可用")

    np: Any = geo.np
    span_m = float(_clamp(span_m, 600.0, 8000.0))
    lon = float(_clamp(lon, -180.0, 179.999999))
    lat = float(_clamp(lat, -89.999999, 89.999999))

    row, col = geo.lonlat_to_rowcol(lon, lat)
    center_elev: float = float(geo.dem[row, col])
    owner: int = int(geo.owner[row, col])
    lake_id: int = int(geo.lake_id[row, col])
    is_land: bool = owner in LAND_OWNERS

    # —— 3×3 邻域中心差分：宏观背景坡向与图幅内高差 ——
    r0: int = max(0, row - 1)
    r1: int = min(PLANET_GRID_ROWS - 1, row + 1)
    c0: int = max(0, col - 1)
    c1: int = min(PLANET_GRID_COLS - 1, col + 1)
    cos_lat_grad: float = max(0.15, math.cos(math.radians(lat)))
    dz_dx: float = (float(geo.dem[row, c1]) - float(geo.dem[row, c0])) / (
        max(1, c1 - c0) * GRID_CELL_M * cos_lat_grad
    )
    dz_dy: float = (float(geo.dem[r1, col]) - float(geo.dem[r0, col])) / (
        max(1, r1 - r0) * GRID_CELL_M
    )
    grad_mag: float = math.hypot(dz_dx, dz_dy)
    # 制图语义：slopeDirDeg 为下坡方向（+X 正东 0°，顺时针，+Y 正南 +90°）
    slope_dir: float = math.degrees(math.atan2(-dz_dy, -dz_dx)) % 360.0
    slope_mag_m: float = grad_mag * span_m

    # —— 沿海判定：中心为陆地且 7×7 邻域内出现大洋格点 ——
    rr0: int = max(0, row - 3)
    rr1: int = min(PLANET_GRID_ROWS, row + 4)
    cc0: int = max(0, col - 3)
    cc1: int = min(PLANET_GRID_COLS, col + 4)
    window: Any = geo.owner[rr0:rr1, cc0:cc1]
    is_coastal: bool = bool(is_land and np.any(window == 0))

    # —— 邻近河流：先按经纬包围盒筛选，再按米制最近距离排序 ——
    cos_lat: float = math.cos(math.radians(lat))
    lon_pad: float = min(0.45, RIVER_SEARCH_PAD_DEG / max(0.15, cos_lat))
    lat_pad: float = RIVER_SEARCH_PAD_DEG
    candidates: List[Dict[str, Any]] = []
    for rec in geo.rivers:
        if rec["lon_max"] < lon - lon_pad or rec["lon_min"] > lon + lon_pad:
            continue
        if rec["lat_max"] < lat - lat_pad or rec["lat_min"] > lat + lat_pad:
            continue
        seg: Any = geo.centerline_points[rec["start"]:rec["start"] + rec["count"]]
        seg_lon: Any = seg[:, 0] * RESOLUTION_DEG - 180.0
        seg_lat: Any = 90.0 - seg[:, 1] * RESOLUTION_DEG
        east_m: Any = (seg_lon - lon) * cos_lat * PLANET_DEG_LAT_M
        south_m: Any = -(seg_lat - lat) * PLANET_DEG_LAT_M
        dist_m: Any = np.hypot(east_m, south_m)
        nearest: int = int(dist_m.argmin())
        min_dist_m: float = float(dist_m[nearest])
        candidates.append({
            "id": rec["id"],
            "count": rec["count"],
            "minDistM": min_dist_m,
            "nearest": nearest,
            "east": east_m,
            "south": south_m,
        })

    candidates.sort(key=lambda item: item["minDistM"])
    nearby: List[Dict[str, Any]] = []
    suggested: List[Dict[str, Any]] = []
    half: float = span_m * 0.5

    for cand in candidates[:MAX_NEARBY_RIVERS]:
        in_map: bool = bool(cand["minDistM"] <= span_m * 0.9)
        local_points: List[List[float]] = _local_river_polyline(
            cand["east"], cand["south"], half, span_m, in_map
        )

        nearby.append({
            "id": cand["id"],
            "label": geo.river_label(cand["id"]),
            "category": geo.river_category(cand["id"]),
            "minDistKm": _round(cand["minDistM"] / 1000.0, 2),
            "localPoints": local_points if in_map else [],
        })

        # 最近大河在宏观格网上明显偏离图幅时，另给出贴合北缘的平移建议（顺序不变）
        if not in_map and len(local_points) >= 2:
            xs: List[float] = [p[0] for p in local_points]
            ys: List[float] = [p[1] for p in local_points]
            shift_x: float = span_m * 0.5 - (min(xs) + max(xs)) * 0.5
            shift_y: float = span_m * 0.16 - min(ys)
            shifted: List[List[float]] = [
                [_round(p[0] + shift_x), _round(p[1] + shift_y)]
                for p in local_points
                if -span_m * 0.2 <= p[0] + shift_x <= span_m * 1.2
            ]
            if len(shifted) >= 2:
                suggested.append({
                    "id": cand["id"],
                    "label": geo.river_label(cand["id"]),
                    "category": geo.river_category(cand["id"]),
                    "minDistKm": _round(cand["minDistM"] / 1000.0, 2),
                    "translateM": [_round(shift_x), _round(shift_y)],
                    "localPoints": shifted,
                })

    return {
        "ok": True,
        "query": {"lon": _round(lon, 6), "lat": _round(lat, 6), "spanM": int(round(span_m))},
        "grid": {"row": row, "col": col},
        "elevM": _round(center_elev, 1),
        "owner": owner,
        "isLand": bool(is_land),
        "lakeId": lake_id,
        "lakeLabel": geo.lake_labels.get(str(lake_id), "") if lake_id > 0 else "",
        "isCoastal": is_coastal,
        "slopeDirDeg": _round(slope_dir, 1),
        "slopeMagM": _round(slope_mag_m, 1),
        "cellSizeM": _round(GRID_CELL_M, 2),
        "nearbyRivers": nearby,
        "suggestedRivers": suggested,
    }


# ------------------------------------------------------------------------------------------------
# 三、工程仓库读写（projects/ 之外的路径一律拒绝）
# ------------------------------------------------------------------------------------------------

def _safe_project_filename(raw: Any) -> Optional[str]:
    """剥离路径分隔符并强制校验后缀；非法时返回 None。"""
    if not isinstance(raw, str) or not raw:
        return None
    # 同时兼容 Windows 分隔符：先归一再取 basename，剥离一切路径前缀
    name: str = Path(raw.replace("\\", "/")).name
    if name in (".", ".."):
        return None
    if "/" in name or "\\" in name or "\x00" in name:
        return None
    if not name.lower().endswith(PROJECT_SUFFIX):
        return None
    if len(name) > MAX_FILENAME_CHARS:
        return None
    return name


def _reject_path_escape(raw: str) -> bool:
    """GET / DELETE 侧额外闸门：任何分隔符或 `..` 片段一律判为非法。"""
    if "/" in raw or "\\" in raw or "\x00" in raw:
        return True
    return ".." in raw


def list_projects() -> List[Dict[str, Any]]:
    """列出 projects/*.worldtown.json 的元数据清单（单文件损坏不影响整体）。"""
    PROJECTS_DIR.mkdir(parents=True, exist_ok=True)
    items: List[Dict[str, Any]] = []
    for path in sorted(PROJECTS_DIR.glob("*" + PROJECT_SUFFIX)):
        name: str = path.name
        display: str = name[: -len(PROJECT_SUFFIX)]
        entry: Dict[str, Any] = {
            "filename": name,
            "name": display,
            "updatedAt": "",
            "bytes": 0,
        }
        try:
            stat: os.stat_result = path.stat()
            entry["bytes"] = int(stat.st_size)
            entry["updatedAt"] = _datetime.datetime.fromtimestamp(
                stat.st_mtime
            ).astimezone().isoformat(timespec="seconds")
            if stat.st_size <= MAX_PROJECT_BYTES:
                with path.open("r", encoding="utf-8") as fp:
                    parsed: Any = json.load(fp)
            else:
                parsed = None
            meta: Any = parsed.get("meta") if isinstance(parsed, dict) else None
            if isinstance(meta, dict):
                entry["name"] = str(meta.get("name") or display)
                entry["id"] = str(meta.get("id") or "")
                entry["worldSizeM"] = meta.get("worldSizeM")
                if meta.get("updatedAt"):
                    entry["projectUpdatedAt"] = str(meta.get("updatedAt"))
        except (OSError, ValueError, TypeError):
            # 单文件损坏属可容忍状态：保留基础元数据，绝不影响整个清单
            pass
        items.append(entry)
    return items


def read_project_file(name: str) -> Optional[Dict[str, Any]]:
    """读取单个工程；不存在、超限或非对象时返回 None。"""
    path: Path = PROJECTS_DIR / name
    if not path.exists() or not path.is_file():
        return None
    if path.stat().st_size > MAX_PROJECT_BYTES:
        return None
    with path.open("r", encoding="utf-8") as fp:
        parsed: Any = json.load(fp)
    if not isinstance(parsed, dict):
        return None
    return parsed


_write_lock: threading.Lock = threading.Lock()


def write_project_atomic(name: str, project: Dict[str, Any]) -> int:
    """同目录 mkstemp + fsync + os.replace 原子落盘；返回写入字节数。"""
    PROJECTS_DIR.mkdir(parents=True, exist_ok=True)
    target: Path = PROJECTS_DIR / name
    text: str = json.dumps(project, ensure_ascii=False, indent=2)
    raw: bytes = text.encode("utf-8")
    if len(raw) > MAX_PROJECT_BYTES:
        raise ValueError("工程序列化后超过 8 MB 上限")
    with _write_lock:
        fd: int
        tmp_name: str
        fd, tmp_name = tempfile.mkstemp(prefix=f".{name}.", suffix=".tmp", dir=str(PROJECTS_DIR))
        tmp_path: Path = Path(tmp_name)
        try:
            with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as fp:
                fp.write(text)
                fp.write("\n")
                fp.flush()
                os.fsync(fp.fileno())
            os.replace(tmp_path, target)
        except BaseException:
            try:
                tmp_path.unlink()
            except OSError:
                pass
            raise
    return len(raw) + 1


def delete_project_file(name: str) -> bool:
    """删除工程；不存在返回 False。受保护基准工程由调用方先行拦截。"""
    path: Path = PROJECTS_DIR / name
    with _write_lock:
        if not path.is_file():
            return False
        path.unlink()
    return True


# ------------------------------------------------------------------------------------------------
# 四、HTTP 处理器
# ------------------------------------------------------------------------------------------------

class StudioHandler(SimpleHTTPRequestHandler):
    """静态资源托管 dist/ + /api/* REST 路由的统一处理器。"""

    server_version = "TerraxSettlementStudio/2.0.0"
    protocol_version = "HTTP/1.1"

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, directory=str(DIST_DIR), **kwargs)

    # —— 日志：精简为单行，便于验收脚本采集 ——
    def log_message(self, fmt: str, *args: Any) -> None:  # noqa: A003
        sys.stderr.write("[studio] %s - %s\n" % (self.address_string(), fmt % args))

    # —— 通用响应 ——
    def _send_json(self, payload: Any, status: int = HTTPStatus.OK) -> None:
        body: bytes = json.dumps(
            payload, ensure_ascii=False, indent=None, separators=(",", ":")
        ).encode("utf-8")
        self.send_response(int(status))
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _send_error_json(self, status: int, message: str, **extra: Any) -> None:
        payload: Dict[str, Any] = {"ok": False, "error": message, "status": int(status)}
        payload.update(extra)
        self._send_json(payload, status)

    def _dispatch_static(self) -> None:
        """按请求方法分发静态资源：HEAD 只回响应头，绝不写出响应体。"""
        if self.command == "HEAD":
            super().do_HEAD()
        else:
            super().do_GET()

    # —— 静态资源：dist/ 生产产物 + SPA 回退 ——
    def _serve_static(self, path: str) -> None:
        if not DIST_DIR.exists():
            if path in ("", "/"):
                self._send_json({
                    "ok": True,
                    "service": SERVICE_NAME,
                    "version": SERVICE_VERSION,
                    "distReady": False,
                    "hint": "尚未执行 npm run build；/api/* 全部可用，前端请用 Vite 开发服务器 :5173。",
                })
                return
            self._send_error_json(
                HTTPStatus.NOT_FOUND,
                f"dist/ 尚未构建，无法托管静态资源：{path}",
                distReady=False,
            )
            return

        rel: str = path.lstrip("/")
        target: Path = (DIST_DIR / rel).resolve() if rel else DIST_DIR
        try:
            target.relative_to(DIST_DIR.resolve())
        except ValueError:
            self._send_error_json(HTTPStatus.NOT_FOUND, "静态资源路径越界")
            return

        if target.is_file():
            self.path = "/" + str(target.relative_to(DIST_DIR.resolve())).replace(os.sep, "/")
            self._dispatch_static()
            return
        if target.is_dir() and (target / "index.html").is_file() and rel:
            self.path = "/" + str(
                (target / "index.html").relative_to(DIST_DIR.resolve())
            ).replace(os.sep, "/")
            self._dispatch_static()
            return
        # SPA 根路由：无扩展名的前端路由一律回退 index.html
        if not Path(rel).suffix and (DIST_DIR / "index.html").is_file():
            self.path = "/index.html"
            self._dispatch_static()
            return
        self._send_error_json(HTTPStatus.NOT_FOUND, f"静态资源不存在：{path}")

    # —— 路由 ——
    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        path: str = unquote(parsed.path)
        try:
            if path == "/api/ping":
                geo: Optional[GeoBundle] = get_geo_bundle()
                self._send_json({
                    "ok": True,
                    "service": SERVICE_NAME,
                    "version": SERVICE_VERSION,
                    "terraxDataAvailable": geo is not None,
                    "distReady": DIST_DIR.exists(),
                })
                return

            if path in ("/api/geo/bootstrap", "/api/terrax-context"):
                self._handle_terrax_context(parse_qs(parsed.query))
                return

            if path == "/api/projects":
                self._send_json({"ok": True, "projects": list_projects()})
                return

            if path.startswith("/api/projects/"):
                raw: str = path[len("/api/projects/"):]
                if _reject_path_escape(raw):
                    self._send_error_json(HTTPStatus.BAD_REQUEST, "非法工程文件名（禁止路径分隔符）")
                    return
                name: Optional[str] = _safe_project_filename(raw)
                if name is None:
                    self._send_error_json(HTTPStatus.BAD_REQUEST, "非法工程文件名")
                    return
                project: Optional[Dict[str, Any]] = read_project_file(name)
                if project is None:
                    self._send_error_json(HTTPStatus.NOT_FOUND, f"工程不存在：{name}")
                    return
                self._send_json(project)
                return

            if path.startswith("/api/"):
                self._send_error_json(HTTPStatus.NOT_FOUND, f"未知 API 端点：{path}")
                return

            self._serve_static(path)
        except BrokenPipeError:
            return
        except Exception as exc:  # noqa: BLE001
            traceback.print_exc(file=sys.stderr)
            self._send_error_json(HTTPStatus.INTERNAL_SERVER_ERROR, f"{type(exc).__name__}: {exc}")

    def do_HEAD(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        path: str = unquote(parsed.path)
        if path.startswith("/api/"):
            self.do_GET()
            return
        self._serve_static(path)

    def do_POST(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        path: str = unquote(parsed.path)
        try:
            if path != "/api/projects":
                self._send_error_json(HTTPStatus.NOT_FOUND, f"未知 API 端点：{path}")
                return

            length: int = int(self.headers.get("Content-Length") or 0)
            if length <= 0:
                self._send_error_json(HTTPStatus.BAD_REQUEST, "请求体为空")
                return
            if length > MAX_BODY_BYTES:
                self._send_error_json(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, "请求体超过 16 MB 上限")
                return
            raw_body: bytes = self.rfile.read(length)
            try:
                payload: Any = json.loads(raw_body.decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError) as exc:
                self._send_error_json(HTTPStatus.BAD_REQUEST, f"JSON 解析失败：{exc}")
                return
            if not isinstance(payload, dict):
                self._send_error_json(HTTPStatus.BAD_REQUEST, "请求体必须为 JSON 对象")
                return

            name: Optional[str] = _safe_project_filename(payload.get("filename"))
            if name is None:
                self._send_error_json(
                    HTTPStatus.BAD_REQUEST,
                    "filename 必须为 *.worldtown.json 且不得含路径分隔符",
                )
                return
            project: Any = payload.get("project")
            if not isinstance(project, dict):
                self._send_error_json(HTTPStatus.BAD_REQUEST, "project 字段必须为对象")
                return
            if "schemaVersion" not in project:
                self._send_error_json(HTTPStatus.BAD_REQUEST, "project 缺少 schemaVersion")
                return

            try:
                saved_bytes: int = write_project_atomic(name, project)
            except ValueError as exc:
                self._send_error_json(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, str(exc))
                return

            self._send_json({
                "ok": True,
                "filename": name,
                "savedBytes": saved_bytes,
                "path": str((PROJECTS_DIR / name).relative_to(STUDIO_DIR)),
            })
        except BrokenPipeError:
            return
        except Exception as exc:  # noqa: BLE001
            traceback.print_exc(file=sys.stderr)
            self._send_error_json(HTTPStatus.INTERNAL_SERVER_ERROR, f"{type(exc).__name__}: {exc}")

    def do_DELETE(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        path: str = unquote(parsed.path)
        try:
            if not path.startswith("/api/projects/"):
                self._send_error_json(HTTPStatus.NOT_FOUND, f"未知 API 端点：{path}")
                return
            raw: str = path[len("/api/projects/"):]
            if _reject_path_escape(raw):
                self._send_error_json(HTTPStatus.BAD_REQUEST, "非法工程文件名（禁止路径分隔符）")
                return
            name: Optional[str] = _safe_project_filename(raw)
            if name is None:
                self._send_error_json(HTTPStatus.BAD_REQUEST, "非法工程文件名")
                return
            if name in PROTECTED_PROJECTS:
                self._send_error_json(
                    HTTPStatus.FORBIDDEN,
                    "内置世界观基准工程受写保护，禁止删除",
                    filename=name,
                )
                return
            if not delete_project_file(name):
                self._send_error_json(HTTPStatus.NOT_FOUND, f"工程不存在：{name}")
                return
            self._send_json({"ok": True, "deleted": name})
        except BrokenPipeError:
            return
        except Exception as exc:  # noqa: BLE001
            traceback.print_exc(file=sys.stderr)
            self._send_error_json(HTTPStatus.INTERNAL_SERVER_ERROR, f"{type(exc).__name__}: {exc}")

    # —— /api/geo/bootstrap 参数解析 ——
    def _handle_terrax_context(self, query: Dict[str, List[str]]) -> None:
        def pick(*keys: str, default: Optional[float]) -> Optional[float]:
            for key in keys:
                values: Optional[List[str]] = query.get(key)
                if not values:
                    continue
                try:
                    return float(values[0])
                except (TypeError, ValueError):
                    return None
            return default

        lon: Optional[float] = pick("lon", default=None)
        lat: Optional[float] = pick("lat", default=None)
        span: Optional[float] = pick("span_m", "spanM", default=2800.0)
        if lon is None or lat is None or span is None:
            self._send_error_json(HTTPStatus.BAD_REQUEST, "lon / lat / span_m 必须为数值")
            return
        if not math.isfinite(lon) or not math.isfinite(lat) or not math.isfinite(span):
            self._send_error_json(HTTPStatus.BAD_REQUEST, "参数不得为 NaN / Infinity")
            return
        if lon < -180.0 or lon > 180.0 or lat < -90.0 or lat > 90.0:
            self._send_error_json(HTTPStatus.BAD_REQUEST, "经纬度超出有效范围")
            return
        try:
            payload: Dict[str, Any] = compute_terrax_context(lon, lat, span)
        except GeoDataError as exc:
            self._send_error_json(HTTPStatus.SERVICE_UNAVAILABLE, str(exc))
            return
        self._send_json(payload)


# ------------------------------------------------------------------------------------------------
# 五、启动入口
# ------------------------------------------------------------------------------------------------

def build_server(host: str, port: int) -> ThreadingHTTPServer:
    mimetypes.add_type("application/javascript", ".js")
    mimetypes.add_type("text/css", ".css")
    mimetypes.add_type("image/svg+xml", ".svg")
    mimetypes.add_type("application/json", ".json")
    mimetypes.add_type("application/wasm", ".wasm")
    mimetypes.add_type("font/woff2", ".woff2")
    httpd: ThreadingHTTPServer = ThreadingHTTPServer((host, port), StudioHandler)
    httpd.daemon_threads = True
    return httpd


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description="Terrax Settlement Studio V2.0 — 本地服务与 TERRAX 地理数据只读桥接",
    )
    parser.add_argument("--port", type=int, default=8765, help="监听端口（默认 8765）")
    parser.add_argument("--host", type=str, default="127.0.0.1", help="监听地址（默认 127.0.0.1）")
    parser.add_argument(
        "--warm-geo",
        action="store_true",
        help="启动时立即装载地理数据（默认首次 API 请求时懒加载）",
    )
    args: argparse.Namespace = parser.parse_args(argv)

    PROJECTS_DIR.mkdir(parents=True, exist_ok=True)
    if not DIST_DIR.exists():
        sys.stderr.write(
            f"[studio] dist/ 尚未构建（{DIST_DIR}）：/api/* 全部可用，静态托管降级为 JSON 提示。\n"
        )

    if args.warm_geo:
        geo: Optional[GeoBundle] = get_geo_bundle()
        sys.stderr.write(
            "[studio] 地理数据装载：%s\n" % ("成功" if geo is not None else f"失败 — {_geo_error}")
        )

    httpd: ThreadingHTTPServer = build_server(args.host, args.port)
    sys.stderr.write(
        "[studio] Terrax Settlement Studio V2.0 已启动 → http://%s:%d/\n"
        "[studio] API: /api/ping · /api/geo/bootstrap · /api/projects\n"
        % (args.host, args.port)
    )
    try:
        httpd.serve_forever(poll_interval=0.25)
    except KeyboardInterrupt:
        sys.stderr.write("\n[studio] 收到中断，正在关闭…\n")
    finally:
        httpd.shutdown()
        httpd.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
