#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Terrax Settlement Studio V2.0 — 全栈后端、生产包托管与仓库零侵入核验脚本（T-6.3）。

运行：
    /Users/jrdamocles/code/TERRAX/worldbuilding/venv/bin/python3 \
        /Users/jrdamocles/code/TERRAX/settlement_studio/tests/verify_backend.py

覆盖：
    1. 空闲端口拉起 server.py 子进程（start_new_session + finally 回收进程组）；
    2. dist/ 首页、JS/CSS 静态资源 200 与 SPA 根路由回退；
    3. GET /api/ping 五键契约；
    4. GET /api/geo/bootstrap 起点城真值（row=913 / col=3708 / |elevM-484.9|<1.0 /
       isLand / owner=6 / R1966）与高纬 cos(lat) 坡向球面修正；
    5. 三套世界观工程读取、六路并发原子保存、路径穿越与后缀拦截、DELETE 写保护；
    6. 测试临时工程与 *.tmp 零残留；
    7. 六大地理数据文件 sha256 + mtime_ns、三套基准工程与 legacy_v1_js/ 归档树前后逐字一致；
    8. worldbuilding git 状态零新增；
    9. 联跑上层三套世界观核验脚本，退出码全为 0。

退出码：全部断言通过为 0，任一失败为 1。
"""

from __future__ import annotations

import concurrent.futures
import hashlib
import json
import os
import re
import signal
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

STUDIO_DIR: Path = Path(__file__).resolve().parent.parent
REPO_ROOT: Path = STUDIO_DIR.parent
DIST_DIR: Path = STUDIO_DIR / "dist"
PROJECTS_DIR: Path = STUDIO_DIR / "projects"
SERVER_PY: Path = STUDIO_DIR / "server.py"
LEGACY_DIR: Path = STUDIO_DIR / "legacy_v1_js"
WORLDBUILDING_DIR: Path = REPO_ROOT / "worldbuilding"
UPPER_WORKSPACE: Path = REPO_ROOT / "候选工作区/20261116_B大陆文化与历史"

BASE_MAP_DIR: Path = REPO_ROOT / "地图/01_地图成品与复现/03_依据与复现"
SOURCE_DATA_DIR: Path = BASE_MAP_DIR / "models/coupled/data"

GEO_FILES: List[Path] = [
    SOURCE_DATA_DIR / "lake_bed_dem.bin",
    BASE_MAP_DIR / "修订数据/20260923_地貌重新推导/global_owner.npz",
    BASE_MAP_DIR / "修订数据/20260926_既定联算同步/map_lake_mask.npz",
    SOURCE_DATA_DIR / "water_vectors/rendered_centerlines.npz",
    SOURCE_DATA_DIR / "water_vectors/centerline_index.json",
]
GEO_AUX_FILES: List[Path] = [
    BASE_MAP_DIR / "修订数据/20260927_对象与分区标注/object_index.json",
]

EXPECTED_PROJECTS: List[str] = [
    "起点城_Losrumura.worldtown.json",
    "长湖_复市镇.worldtown.json",
    "帕隆_峡谷铁寨.worldtown.json",
]

UPPER_SCRIPTS: List[Path] = [
    UPPER_WORKSPACE / "核验候选稿.py",
    UPPER_WORKSPACE / "待定志书集_起点地方志与大国志/核验志书集.py",
    UPPER_WORKSPACE / "待定故事集_候选之候选/核验待定故事集.py",
]

RESOLUTION_DEG: float = 0.06
PLANET_DEG_LAT_M: float = 122466.0
GRID_CELL_M: float = RESOLUTION_DEG * PLANET_DEG_LAT_M

PASSED: int = 0
FAILURES: List[str] = []


# ------------------------------------------------------------------------------------------------
# 一、断言与输出
# ------------------------------------------------------------------------------------------------

def section(title: str) -> None:
    print(f"\n-- {title} " + "-" * max(0, 66 - len(title)))


def ok(condition: bool, message: str, detail: Any = None) -> bool:
    global PASSED
    if condition:
        PASSED += 1
        return True
    extra: str = "" if detail is None else f" — {detail}"
    FAILURES.append(f"{message}{extra}")
    print(f"  x {message}{extra}")
    return False


def note(message: str) -> None:
    print(f"  · {message}")


# ------------------------------------------------------------------------------------------------
# 二、HTTP 工具
# ------------------------------------------------------------------------------------------------

def http_json(
    method: str,
    url: str,
    payload: Optional[Dict[str, Any]] = None,
    timeout: float = 60.0,
) -> Tuple[int, Any]:
    data: Optional[bytes] = None
    headers: Dict[str, str] = {"Accept": "application/json"}
    if payload is not None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body: bytes = response.read()
            status: int = int(response.status)
    except urllib.error.HTTPError as exc:
        body = exc.read() or b""
        status = int(exc.code)
    try:
        parsed: Any = json.loads(body.decode("utf-8")) if body else None
    except (UnicodeDecodeError, json.JSONDecodeError):
        parsed = body.decode("utf-8", "replace")
    return status, parsed


def http_raw(
    method: str,
    url: str,
    body: bytes,
    content_type: str = "application/json",
    timeout: float = 60.0,
) -> Tuple[int, Any]:
    request = urllib.request.Request(
        url,
        data=body,
        method=method,
        headers={"Content-Type": content_type, "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw: bytes = response.read()
            status: int = int(response.status)
    except urllib.error.HTTPError as exc:
        raw = exc.read() or b""
        status = int(exc.code)
    try:
        return status, json.loads(raw.decode("utf-8")) if raw else None
    except (UnicodeDecodeError, json.JSONDecodeError):
        return status, raw.decode("utf-8", "replace")


def http_text(url: str, timeout: float = 60.0) -> Tuple[int, str, str]:
    try:
        with urllib.request.urlopen(url, timeout=timeout) as response:
            body: str = response.read().decode("utf-8", "replace")
            return int(response.status), body, str(response.headers.get("Content-Type") or "")
    except urllib.error.HTTPError as exc:
        return int(exc.code), exc.read().decode("utf-8", "replace"), ""


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def wait_for_ping(base: str, timeout: float = 45.0) -> bool:
    deadline: float = time.time() + timeout
    while time.time() < deadline:
        try:
            status, data = http_json("GET", f"{base}/api/ping", timeout=5.0)
            if status == 200 and isinstance(data, dict) and data.get("ok") is True:
                return True
        except (urllib.error.URLError, ConnectionError, TimeoutError, OSError):
            pass
        time.sleep(0.2)
    return False


# ------------------------------------------------------------------------------------------------
# 三、快照工具（零侵入核验）
# ------------------------------------------------------------------------------------------------

def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def file_snapshot(paths: List[Path]) -> Dict[str, Tuple[str, int]]:
    snapshot: Dict[str, Tuple[str, int]] = {}
    for path in paths:
        if path.exists():
            stat: os.stat_result = path.stat()
            snapshot[str(path)] = (sha256_of(path), int(stat.st_mtime_ns))
        else:
            snapshot[str(path)] = ("<missing>", 0)
    return snapshot


def tree_snapshot(root: Path) -> Dict[str, str]:
    snapshot: Dict[str, str] = {}
    if not root.exists():
        return snapshot
    for path in sorted(root.rglob("*")):
        if path.is_file():
            snapshot[str(path.relative_to(root))] = sha256_of(path)
    return snapshot


def git_status(path: Path) -> Optional[List[str]]:
    try:
        result = subprocess.run(
            ["git", "-C", str(path), "status", "--porcelain"],
            capture_output=True,
            text=True,
            timeout=90,
            check=False,
        )
    except (FileNotFoundError, subprocess.SubprocessError):
        return None
    if result.returncode != 0:
        return None
    return [line for line in result.stdout.splitlines() if line.strip()]


# ------------------------------------------------------------------------------------------------
# 四、球面 cos(lat) 坡向独立复算（只读 memmap，不写回）
# ------------------------------------------------------------------------------------------------

def slope_dirs(dem_path: Path, lon: float, lat: float) -> Tuple[int, int, float, float]:
    """返回 (row, col, 乘 cos 的坡向, 未乘 cos 的坡向)，用于验证球面修正。"""
    import math

    import numpy as np

    dem: Any = np.memmap(dem_path, dtype="<f4", mode="r", shape=(3000, 6000))
    col: int = int(min(max(math.floor((lon + 180.0) / RESOLUTION_DEG), 0), 5999))
    row: int = int(min(max(math.floor((90.0 - lat) / RESOLUTION_DEG), 0), 2999))
    r0: int = max(0, row - 1)
    r1: int = min(2999, row + 1)
    c0: int = max(0, col - 1)
    c1: int = min(5999, col + 1)
    dz_dy: float = (float(dem[r1, col]) - float(dem[r0, col])) / (
        max(1, r1 - r0) * GRID_CELL_M
    )
    cos_lat: float = max(0.15, math.cos(math.radians(lat)))
    dz_dx_cos: float = (float(dem[row, c1]) - float(dem[row, c0])) / (
        max(1, c1 - c0) * GRID_CELL_M * cos_lat
    )
    dz_dx_raw: float = (float(dem[row, c1]) - float(dem[row, c0])) / (
        max(1, c1 - c0) * GRID_CELL_M
    )
    dir_cos: float = round(math.degrees(math.atan2(-dz_dy, -dz_dx_cos)) % 360.0, 1)
    dir_raw: float = round(math.degrees(math.atan2(-dz_dy, -dz_dx_raw)) % 360.0, 1)
    del dem
    return row, col, dir_cos, dir_raw


# ------------------------------------------------------------------------------------------------
# 五、主流程
# ------------------------------------------------------------------------------------------------

def main() -> int:
    print("Terrax Settlement Studio V2.0 · 全栈后端与仓库零侵入核验")
    print(f"  工程目录: {STUDIO_DIR}")
    print(f"  Python  : {sys.executable}")

    section("0. 前置产物与基准资产")
    ok(SERVER_PY.exists(), "server.py 存在")
    ok((DIST_DIR / "index.html").exists(), "dist/index.html 已构建")
    ok((DIST_DIR / "assets").is_dir(), "dist/assets/ 已构建")
    ok(PROJECTS_DIR.is_dir(), "projects/ 目录存在")
    ok(LEGACY_DIR.is_dir(), "legacy_v1_js/ 归档存在")
    legacy_files: List[Path] = [p for p in LEGACY_DIR.rglob("*") if p.is_file()]
    ok(len(legacy_files) == 20, "legacy_v1_js/ 归档文件数为 20", len(legacy_files))
    for filename in EXPECTED_PROJECTS:
        ok(PROJECTS_DIR.joinpath(filename).exists(), f"基准工程存在：{filename}")

    # 清理上次异常退出可能遗留的测试工程
    for stale in PROJECTS_DIR.glob("__verify_*" + ".worldtown.json"):
        try:
            stale.unlink()
        except OSError:
            pass

    geo_before: Dict[str, Tuple[str, int]] = file_snapshot(GEO_FILES + GEO_AUX_FILES)
    project_before: Dict[str, Tuple[str, int]] = file_snapshot(
        [PROJECTS_DIR / name for name in EXPECTED_PROJECTS]
    )
    legacy_before: Dict[str, str] = tree_snapshot(LEGACY_DIR)
    git_before: Optional[List[str]] = git_status(WORLDBUILDING_DIR)
    if git_before is None:
        note(f"跳过 git 状态检查：{WORLDBUILDING_DIR} 不是可用 git 仓库")
    elif git_before:
        note(f"worldbuilding 基线存在 {len(git_before)} 条历史改动（任务前既有，非本工程产生）")
        for line in git_before:
            note(f"    {line}")
    else:
        note("worldbuilding 基线工作区干净")

    port: int = free_port()
    base: str = f"http://127.0.0.1:{port}"
    env: Dict[str, str] = dict(os.environ)
    env["PYTHONUNBUFFERED"] = "1"
    log_fd: int
    log_path_str: str
    log_fd, log_path_str = tempfile.mkstemp(prefix="terrax_verify_", suffix=".log")
    log_path: Path = Path(log_path_str)
    log_handle: Any = os.fdopen(log_fd, "w", encoding="utf-8")
    proc: subprocess.Popen[bytes] = subprocess.Popen(
        [sys.executable, str(SERVER_PY), "--port", str(port), "--host", "127.0.0.1"],
        cwd=str(STUDIO_DIR),
        stdout=log_handle,
        stderr=subprocess.STDOUT,
        env=env,
        start_new_session=True,
    )

    temp_files: List[Path] = []
    try:
        section("1. 服务冷启动与 /api/ping 契约")
        started: bool = wait_for_ping(base)
        ok(started, "server.py 在空闲端口冷启动成功", port)
        if not started:
            log_handle.flush()
            try:
                print(log_path.read_text(encoding="utf-8")[-3000:])
            except OSError:
                pass
            return 1

        status, ping = http_json("GET", f"{base}/api/ping")
        ok(status == 200, "/api/ping 返回 200", status)
        ok(isinstance(ping, dict) and ping.get("ok") is True, "/api/ping ok === true")
        ok((ping or {}).get("service") == "terrax-settlement-studio", "service 名称正确",
           (ping or {}).get("service"))
        ok((ping or {}).get("version") == "2.0.0", "version === 2.0.0", (ping or {}).get("version"))
        ok((ping or {}).get("terraxDataAvailable") is True, "terraxDataAvailable === true",
           (ping or {}).get("terraxDataAvailable"))
        ok((ping or {}).get("distReady") is True, "distReady === true", (ping or {}).get("distReady"))

        section("2. dist/ 生产包托管与 SPA 回退")
        status, html, ctype = http_text(f"{base}/")
        ok(status == 200, "GET / 返回 200", status)
        ok("text/html" in ctype, "GET / Content-Type 为 text/html", ctype)
        ok('id="root"' in html, "首页含 #root 挂载点")
        ok("Terrax Settlement Studio V2.0" in html, "首页标题为 V2.0")

        asset_refs: List[str] = re.findall(r'(?:src|href)="(/assets/[^"]+)"', html)
        ok(len(asset_refs) >= 2, "首页引用至少 2 个 /assets/ 生产资源", asset_refs)
        for ref in asset_refs:
            asset_status, asset_body, asset_type = http_text(f"{base}{ref}")
            ok(asset_status == 200, f"静态资源 200：{ref}", asset_status)
            ok(len(asset_body) > 1000, f"静态资源非空：{ref}", len(asset_body))
            note(f"{ref} · {len(asset_body)} 字符 · {asset_type}")

        css_refs: List[str] = [ref for ref in asset_refs if ref.endswith(".css")]
        js_refs: List[str] = [ref for ref in asset_refs if ref.endswith(".js")]
        ok(len(css_refs) >= 1, "存在 CSS 产物", css_refs)
        ok(len(js_refs) >= 1, "存在 JS 产物", js_refs)
        if css_refs:
            _css_status, css_body, _css_type = http_text(f"{base}{css_refs[0]}")
            ok("#f4f1ea" in css_body, "CSS 含浅色亚麻桌面令牌 #f4f1ea")
            ok("--color-panel" in css_body, "CSS 含 @theme 面板令牌 --color-panel")
        if js_refs:
            _js_status, js_body, _js_type = http_text(f"{base}{js_refs[0]}")
            ok("/api/ping" in js_body, "JS 产物含 /api/ping 探测调用")

        status, spa_body, spa_type = http_text(f"{base}/studio/atelier")
        ok(status == 200, "SPA 根路由回退返回 200", status)
        ok("text/html" in spa_type and 'id="root"' in spa_body, "SPA 回退内容为首页 HTML")
        status, _missing_body, _missing_type = http_text(f"{base}/assets/__missing__.js")
        ok(status == 404, "缺失静态资源返回 404", status)

        section("3. /api/geo/bootstrap 起点城真值与球面 cos(lat)")
        status, ctx = http_json(
            "GET", f"{base}/api/geo/bootstrap?lon=42.51&lat=35.19&span_m=2800"
        )
        ok(status == 200, "geo/bootstrap 返回 200", status)
        ok(isinstance(ctx, dict) and ctx.get("ok") is True, "geo/bootstrap ok === true")
        if isinstance(ctx, dict):
            grid: Dict[str, Any] = ctx.get("grid") or {}
            ok(grid.get("row") == 913, "grid.row === 913", grid.get("row"))
            ok(grid.get("col") == 3708, "grid.col === 3708", grid.get("col"))
            elev: Any = ctx.get("elevM")
            ok(
                isinstance(elev, (int, float)) and abs(float(elev) - 484.9) < 1.0,
                "|elevM - 484.9| < 1.0 m",
                elev,
            )
            ok(ctx.get("isLand") is True, "isLand === true", ctx.get("isLand"))
            ok(ctx.get("lakeId") == 0, "lakeId === 0", ctx.get("lakeId"))
            ok(ctx.get("lakeLabel") == "", "lakeLabel 为空串", ctx.get("lakeLabel"))
            ok(ctx.get("owner") == 6, "owner === 6（B 大陆陆地）", ctx.get("owner"))
            ok(ctx.get("isCoastal") is False, "isCoastal === false", ctx.get("isCoastal"))
            slope_dir: Any = ctx.get("slopeDirDeg")
            ok(
                isinstance(slope_dir, (int, float)) and 0.0 <= float(slope_dir) < 360.0,
                "slopeDirDeg 落在 [0, 360)",
                slope_dir,
            )
            ok(
                isinstance(slope_dir, (int, float)) and abs(float(slope_dir) - 312.9) <= 2.0,
                "经度梯度已乘 cos(lat)（slopeDirDeg ≈ 312.9°）",
                slope_dir,
            )
            ok(
                isinstance(ctx.get("slopeMagM"), (int, float)) and float(ctx["slopeMagM"]) >= 0.0,
                "slopeMagM 为非负数值",
                ctx.get("slopeMagM"),
            )
            ok(abs(float(ctx.get("cellSizeM") or 0.0) - GRID_CELL_M) < 0.01,
               "cellSizeM === 7347.96", ctx.get("cellSizeM"))
            query: Dict[str, Any] = ctx.get("query") or {}
            ok(query.get("spanM") == 2800, "query.spanM 回显 2800", query.get("spanM"))
            ok(abs(float(query.get("lon") or 0.0) - 42.51) < 1e-6, "query.lon 回显正确")
            ok(abs(float(query.get("lat") or 0.0) - 35.19) < 1e-6, "query.lat 回显正确")

            rivers: List[Dict[str, Any]] = ctx.get("nearbyRivers") or []
            ids: List[str] = [str(item.get("id")) for item in rivers]
            labels: List[str] = [str(item.get("label")) for item in rivers]
            ok("1966" in ids or "R1966" in labels, "检出 R1966 河段", ids)
            r1966: Optional[Dict[str, Any]] = next(
                (item for item in rivers if str(item.get("id")) == "1966"), None
            )
            ok(r1966 is not None, "nearbyRivers 含 id=1966 条目")
            if r1966 is not None:
                ok(str(r1966.get("label")) == "R1966", "R1966 标注名正确", r1966.get("label"))
                ok(str(r1966.get("category")) == "secondary", "R1966 制图分类为 secondary",
                   r1966.get("category"))
                ok(float(r1966.get("minDistKm") or 999.0) < 1.0, "R1966 最近距离 < 1 km",
                   r1966.get("minDistKm"))
                local_points: List[Any] = r1966.get("localPoints") or []
                ok(len(local_points) >= 2, "R1966 提供可用局部折线", len(local_points))
                if len(local_points) >= 2:
                    ok(
                        all(
                            isinstance(point, list) and len(point) == 2
                            for point in local_points
                        ),
                        "R1966 局部折线点列结构为 [x, y]",
                    )
            note(
                "elev={} m · owner={} · slopeDir={}° · nearby={}".format(
                    elev, ctx.get("owner"), slope_dir,
                    [(item.get("label"), item.get("minDistKm")) for item in rivers],
                )
            )

        # 高纬独立复算：cos 修正与未修正必须可区分
        try:
            row_h, col_h, dir_cos, dir_raw = slope_dirs(GEO_FILES[0], 42.51, 68.0)
            status, high = http_json(
                "GET", f"{base}/api/geo/bootstrap?lon=42.51&lat=68.0&span_m=2800"
            )
            ok(status == 200, "高纬查询返回 200", status)
            high_dir: Any = (high or {}).get("slopeDirDeg")
            ok(
                isinstance(high_dir, (int, float)) and abs(float(high_dir) - dir_cos) <= 0.2,
                f"高纬 slopeDirDeg === 独立复算 {dir_cos}°",
                high_dir,
            )
            ok(abs(dir_cos - dir_raw) >= 8.0,
               "该高纬点上 cos(lat) 修正前后坡向差异 >= 8°", (dir_cos, dir_raw))
            note(f"高纬 ({row_h},{col_h}) cos={dir_cos}° / 未修正={dir_raw}°")
        except ImportError as exc:
            note(f"跳过高纬复算（numpy 不可用）：{exc}")

        status, alias = http_json(
            "GET", f"{base}/api/terrax-context?lon=42.51&lat=35.19&span_m=2800"
        )
        ok(status == 200 and isinstance(alias, dict) and alias.get("ok") is True,
           "/api/terrax-context 兼容别名返回 200")
        if isinstance(alias, dict) and isinstance(ctx, dict):
            ok(
                (alias.get("grid") or {}) == (ctx.get("grid") or {})
                and alias.get("elevM") == ctx.get("elevM")
                and alias.get("slopeDirDeg") == ctx.get("slopeDirDeg"),
                "兼容别名与 /api/geo/bootstrap 核心字段逐字一致",
            )

        status, clamped = http_json(
            "GET", f"{base}/api/geo/bootstrap?lon=42.51&lat=35.19&span_m=100"
        )
        ok(
            status == 200 and ((clamped or {}).get("query") or {}).get("spanM") == 600,
            "span_m 下限夹紧为 600",
            ((clamped or {}).get("query") or {}).get("spanM"),
        )
        status, _bad = http_json("GET", f"{base}/api/geo/bootstrap?lon=abc&lat=35.19")
        ok(status == 400, "非法 lon 参数返回 400", status)
        status, _bad2 = http_json("GET", f"{base}/api/geo/bootstrap?lon=200&lat=35.19")
        ok(status == 400, "超范围经度返回 400", status)
        status, _bad3 = http_json("GET", f"{base}/api/geo/bootstrap?lon=42.51")
        ok(status == 400, "缺少 lat 返回 400", status)
        status, _bad4 = http_json("GET", f"{base}/api/geo/bootstrap?lon=NaN&lat=35.19")
        ok(status == 400, "NaN 参数返回 400", status)
        status, _unknown = http_json("GET", f"{base}/api/definitely-not-exist")
        ok(status == 404, "未知 API 端点返回 404", status)

        section("4. 工程清单与三套基准工程读取")
        status, listing = http_json("GET", f"{base}/api/projects")
        ok(status == 200 and isinstance(listing, dict) and listing.get("ok") is True,
           "/api/projects 返回 200 且 ok === true")
        entries: List[Dict[str, Any]] = (listing or {}).get("projects") or []
        names: List[str] = [str(entry.get("filename")) for entry in entries]
        ok(len(entries) == 3, "工程清单恰为 3 套", names)
        for filename in EXPECTED_PROJECTS:
            ok(filename in names, f"清单含 {filename}")

        for filename in EXPECTED_PROJECTS:
            status, project = http_json(
                "GET", f"{base}/api/projects/{urllib.parse.quote(filename)}"
            )
            ok(status == 200, f"GET {filename} 返回 200", status)
            if isinstance(project, dict):
                ok(project.get("schemaVersion") == "1.2.0", f"{filename} schemaVersion === 1.2.0")
                meta: Any = project.get("meta")
                ok(isinstance(meta, dict) and bool(meta.get("name")), f"{filename} meta 合法")
                ok(isinstance(project.get("terrain"), dict), f"{filename} terrain 合法")
                zones: Any = project.get("zones")
                ok(isinstance(zones, list) and len(zones) >= 4, f"{filename} 选区数量 >= 4",
                   len(zones or []))
                ok(isinstance(project.get("legend"), dict), f"{filename} legend 合法")
                ok(isinstance(project.get("roads"), list), f"{filename} roads 合法")

        status, _missing = http_json("GET", f"{base}/api/projects/__not_exist__.worldtown.json")
        ok(status == 404, "不存在的工程返回 404", status)
        status, _traversal = http_json("GET", f"{base}/api/projects/..%2F..%2Fetc%2Fpasswd")
        ok(status in (400, 404), "GET 路径穿越被拦截", status)
        status, _bad_suffix_get = http_json("GET", f"{base}/api/projects/evil.json")
        ok(status == 400, "GET 非 .worldtown.json 后缀返回 400", status)

        section("5. POST 原子保存、并发与路径剥离")
        sample_project: Dict[str, Any] = {
            "schemaVersion": "2.0.0",
            "meta": {"id": "proj_verify_tmp", "name": "核验临时工程", "worldSizeM": 1200},
            "terrain": {"baseElev": 480, "slopeMagM": 6, "shapes": []},
            "zones": [],
            "legend": {"items": []},
        }
        temp_name: str = "__verify_tmp__.worldtown.json"
        temp_path: Path = PROJECTS_DIR / temp_name
        temp_files.append(temp_path)
        status, saved = http_json(
            "POST", f"{base}/api/projects", {"filename": temp_name, "project": sample_project}
        )
        ok(status == 200 and isinstance(saved, dict) and saved.get("ok") is True,
           "POST 保存返回 200 且 ok === true", status)
        ok(temp_path.exists(), "临时工程已落盘 projects/")
        if temp_path.exists():
            stored: Any = json.loads(temp_path.read_text(encoding="utf-8"))
            ok(
                isinstance(stored, dict)
                and (stored.get("meta") or {}).get("id") == "proj_verify_tmp",
                "落盘内容与请求一致",
            )
        ok(
            isinstance(saved, dict) and int(saved.get("savedBytes") or 0) > 0,
            "返回 savedBytes > 0",
            (saved or {}).get("savedBytes"),
        )

        escape_name: str = "../../../../tmp/__verify_escape__.worldtown.json"
        escape_path: Path = PROJECTS_DIR / "__verify_escape__.worldtown.json"
        outside_path: Path = Path("/tmp/__verify_escape__.worldtown.json")
        temp_files.append(escape_path)
        if outside_path.exists():
            outside_path.unlink()
        status, escaped = http_json(
            "POST", f"{base}/api/projects", {"filename": escape_name, "project": sample_project}
        )
        ok(
            status == 200
            and (escaped or {}).get("filename") == "__verify_escape__.worldtown.json",
            "POST 路径剥离后收敛为 basename",
            (escaped or {}).get("filename"),
        )
        ok(escape_path.exists(), "剥离后的工程落在 projects/ 内")
        ok(not outside_path.exists(), "未在 /tmp 生成逃逸文件")

        status, _bad_suffix = http_json(
            "POST", f"{base}/api/projects", {"filename": "evil.json", "project": sample_project}
        )
        ok(status == 400, "POST 非 .worldtown.json 后缀被拒绝", status)
        status, _no_project = http_json(
            "POST", f"{base}/api/projects", {"filename": "x.worldtown.json"}
        )
        ok(status == 400, "POST 缺少 project 字段被拒绝", status)
        status, _no_schema = http_json(
            "POST", f"{base}/api/projects",
            {"filename": "x.worldtown.json", "project": {"meta": {}}},
        )
        ok(status == 400, "POST project 缺少 schemaVersion 被拒绝", status)
        status, _bad_json = http_raw("POST", f"{base}/api/projects", b"{not json")
        ok(status == 400, "POST 非法 JSON 返回 400", status)
        status, _empty = http_raw("POST", f"{base}/api/projects", b"")
        ok(status == 400, "POST 空请求体返回 400", status)

        concurrent_name: str = "__verify_concurrent__.worldtown.json"
        concurrent_path: Path = PROJECTS_DIR / concurrent_name
        temp_files.append(concurrent_path)

        def _post_once(index: int) -> int:
            payload: Dict[str, Any] = {
                "schemaVersion": "2.0.0",
                "meta": {
                    "id": f"proj_concurrent_{index}",
                    "name": f"并发{index}",
                    "worldSizeM": 1200,
                },
                "terrain": {"baseElev": 480, "slopeMagM": 6, "shapes": []},
                "zones": [],
                "legend": {"items": []},
            }
            code, _body = http_json(
                "POST", f"{base}/api/projects",
                {"filename": concurrent_name, "project": payload},
            )
            return code

        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
            codes: List[int] = list(pool.map(_post_once, range(6)))
        ok(all(code == 200 for code in codes), "6 路并发保存同名工程全部 200", codes)
        ok(concurrent_path.exists(), "并发保存后工程文件存在")
        if concurrent_path.exists():
            try:
                stored_concurrent: Any = json.loads(
                    concurrent_path.read_text(encoding="utf-8")
                )
                ok(isinstance(stored_concurrent.get("meta"), dict),
                   "并发保存后的工程 JSON 完整可解析")
            except json.JSONDecodeError as exc:
                ok(False, "并发保存后的工程 JSON 完整可解析", str(exc))
        ok(len(list(PROJECTS_DIR.glob("*.tmp"))) == 0, "并发保存后无 .tmp 残留")

        section("6. DELETE 写保护与清理闭环")
        status, deleted = http_json("DELETE", f"{base}/api/projects/{urllib.parse.quote(temp_name)}")
        ok(status == 200 and (deleted or {}).get("deleted") == temp_name,
           "DELETE 临时工程返回 200", status)
        ok(not temp_path.exists(), "临时工程文件已删除")
        for filename in EXPECTED_PROJECTS:
            status, _forbidden = http_json(
                "DELETE", f"{base}/api/projects/{urllib.parse.quote(filename)}"
            )
            ok(status == 403, f"DELETE 受保护工程返回 403：{filename}", status)
            ok((PROJECTS_DIR / filename).exists(), f"受保护工程仍然存在：{filename}")
        status, _missing_delete = http_json(
            "DELETE", f"{base}/api/projects/__not_exist__.worldtown.json"
        )
        ok(status == 404, "DELETE 不存在的工程返回 404", status)
        status, _delete_traversal = http_json(
            "DELETE", f"{base}/api/projects/..%2F..%2Fetc%2Fpasswd"
        )
        ok(status in (400, 404), "DELETE 路径穿越被拦截", status)
        status, deleted2 = http_json(
            "DELETE", f"{base}/api/projects/{urllib.parse.quote(concurrent_name)}"
        )
        ok(status == 200 and (deleted2 or {}).get("deleted") == concurrent_name,
           "DELETE 并发工程返回 200", status)
        status, deleted3 = http_json(
            "DELETE", f"{base}/api/projects/{urllib.parse.quote(escape_path.name)}"
        )
        ok(status == 200, "DELETE 剥离工程返回 200", status)
        ok(len(list(PROJECTS_DIR.glob("__verify_*"))) == 0, "projects/ 无 __verify_* 残留")

    finally:
        section("7. 子进程回收与临时文件清理")
        try:
            if proc.poll() is None:
                os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
                for _ in range(60):
                    if proc.poll() is not None:
                        break
                    time.sleep(0.1)
                if proc.poll() is None:
                    os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
            ok(proc.poll() is not None, "server.py 子进程已回收", f"returncode={proc.poll()}")
        except ProcessLookupError:
            ok(True, "server.py 子进程已退出")
        log_handle.close()

        removed: int = 0
        for path in temp_files:
            try:
                if path.exists():
                    path.unlink()
                    removed += 1
            except OSError:
                pass
        ok(not any(path.exists() for path in temp_files), "测试临时工程文件已清理", removed)
        leftovers: List[str] = [p.name for p in PROJECTS_DIR.glob("*.tmp")]
        ok(len(leftovers) == 0, "projects/ 无 .tmp 残留", leftovers)
        try:
            log_path.unlink()
        except OSError:
            pass

    section("8. 上层三套世界观核验脚本")
    for script in UPPER_SCRIPTS:
        exists: bool = script.exists()
        ok(exists, f"核验脚本存在：{script.name}")
        if not exists:
            continue
        result: subprocess.CompletedProcess[str] = subprocess.run(
            [sys.executable, str(script)],
            cwd=str(script.parent),
            capture_output=True,
            text=True,
            timeout=900,
            check=False,
        )
        ok(result.returncode == 0, f"{script.name} 退出码为 0", result.returncode)
        output_lines: List[str] = (result.stdout or "").strip().splitlines()
        for line in output_lines[-2:]:
            note(line[:240])
        if result.returncode != 0:
            print((result.stderr or "")[-2000:])

    section("9. 地理数据只读与仓库零侵入")
    geo_after: Dict[str, Tuple[str, int]] = file_snapshot(GEO_FILES + GEO_AUX_FILES)
    changed: List[Tuple[str, Any, Any]] = []
    for key, before in geo_before.items():
        after: Optional[Tuple[str, int]] = geo_after.get(key)
        if after != before:
            changed.append((Path(key).name, before, after))
    ok(len(changed) == 0, "六大地理数据文件 sha256 与 mtime_ns 前后完全一致", changed)
    for key in geo_before:
        note(f"{Path(key).name:32s} {geo_before[key][0][:16]}… mtime_ns={geo_before[key][1]}")

    project_after: Dict[str, Tuple[str, int]] = file_snapshot(
        [PROJECTS_DIR / name for name in EXPECTED_PROJECTS]
    )
    project_changed: List[str] = [
        Path(key).name
        for key, before in project_before.items()
        if project_after.get(key) != before
    ]
    ok(len(project_changed) == 0, "三套基准工程 sha256 与 mtime_ns 未被修改", project_changed)

    legacy_after: Dict[str, str] = tree_snapshot(LEGACY_DIR)
    ok(legacy_after == legacy_before, "legacy_v1_js/ 归档树 20 文件 sha256 前后逐字一致")
    if LEGACY_DIR.exists() and (STUDIO_DIR / "package.json").exists():
        newest_legacy: float = max(
            (p.stat().st_mtime for p in LEGACY_DIR.rglob("*") if p.is_file()),
            default=0.0,
        )
        scaffold_mtime: float = (STUDIO_DIR / "package.json").stat().st_mtime
        ok(
            newest_legacy < scaffold_mtime,
            "legacy_v1_js/ 最新 mtime 早于 V2 脚手架，归档未被篡改",
            time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime(newest_legacy)),
        )

    git_after: Optional[List[str]] = git_status(WORLDBUILDING_DIR)
    if git_before is None or git_after is None:
        note("git 状态检查跳过（仓库不可用）")
    else:
        new_entries: List[str] = [line for line in git_after if line not in git_before]
        ok(len(git_after) == len(git_before), "worldbuilding git 状态条目数未增加",
           f"{len(git_before)} → {len(git_after)}")
        ok(len(new_entries) == 0, "worldbuilding 无本次新增改动", new_entries)
        if not git_before:
            ok(len(git_after) == 0, "worldbuilding git status --porcelain 为空", git_after)
        else:
            note("基线既有改动保持原样（历史遗留，本次核验未触碰）")

    section("汇总")
    if FAILURES:
        print(f"\nx verify_backend: {len(FAILURES)} 项失败 / {PASSED} 项通过")
        for item in FAILURES:
            print(f"   - {item}")
        return 1
    print(
        f"\nverify_backend: {PASSED} 项断言全部通过；"
        "dist/ 托管正常、地理数据只读、临时文件已清理、上层核验退出码 0。"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
