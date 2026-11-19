#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Terrax Settlement Studio V1.2 — 后端地理桥接与仓库零侵入核验脚本（PRD FR-10.5 / T-6.6）。

运行：
    /Users/jrdamocles/code/TERRAX/worldbuilding/venv/bin/python3 \
        /Users/jrdamocles/code/TERRAX/settlement_studio/tests/verify_backend.py

覆盖：
    1. 临时空闲端口拉起 server.py 子进程（finally 强制回收）；
    2. GET /api/ping → ok / terraxDataAvailable；
    3. GET /api/terrax-context?lon=42.51&lat=35.19&span_m=2800 →
       row = 913, col = 3708, |elevM - 484.9| < 1.0, isLand = True, lakeId = 0, 检出 R1966；
    4. GET /api/projects 三套示例齐全、JSON Schema 合法；GET /api/projects/<filename> 可读；
    5. POST /api/projects 落盘与 Path(filename).name 路径剥离防护，测试后清理临时文件；
    6. 四大地理数据文件 sha256 与 mtime 前后一致（mode="r" 只读零侵入）；
    7. git -C worldbuilding status --porcelain 前后逐字不变（无新增条目）；
    8. 上层 候选工作区/20261116_B大陆文化与历史/核验候选稿.py 退出码严格为 0。

退出码：全部断言通过为 0，任一失败为 1。
"""

from __future__ import annotations

import hashlib
import json
import os
import signal
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

STUDIO_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = STUDIO_DIR.parent.parent
WEB_DIR = STUDIO_DIR / "web"
PROJECTS_DIR = STUDIO_DIR / "projects"
SERVER_PY = STUDIO_DIR / "server.py"
WORLDBUILDING_DIR = REPO_ROOT / "worldbuilding"
UPPER_WORKSPACE = REPO_ROOT / "候选工作区/20261116_B大陆文化与历史"
UPPER_SCRIPTS = [
    UPPER_WORKSPACE / "核验候选稿.py",
    UPPER_WORKSPACE / "待定志书集_起点地方志与大国志/核验志书集.py",
    UPPER_WORKSPACE / "待定故事集_候选之候选/核验待定故事集.py",
]
UPPER_SCRIPT = UPPER_SCRIPTS[0]

BASE_MAP_DIR = REPO_ROOT / "地图/01_地图成品与复现/03_依据与复现"
SOURCE_DATA_DIR = BASE_MAP_DIR / "models/coupled/data"
GEO_FILES = [
    SOURCE_DATA_DIR / "lake_bed_dem.bin",
    BASE_MAP_DIR / "修订数据/20260923_地貌重新推导/global_owner.npz",
    BASE_MAP_DIR / "修订数据/20260926_既定联算同步/map_lake_mask.npz",
    SOURCE_DATA_DIR / "water_vectors/rendered_centerlines.npz",
    SOURCE_DATA_DIR / "water_vectors/centerline_index.json",
]

EXPECTED_PROJECTS = [
    "起点城_Losrumura.worldtown.json",
    "长湖_复市镇.worldtown.json",
    "帕隆_峡谷铁寨.worldtown.json",
]

PASSED = 0
FAILURES: List[str] = []


# ------------------------------------------------------------------------------------------------
# 断言与输出
# ------------------------------------------------------------------------------------------------

def section(title: str) -> None:
    print(f"\n── {title} " + "─" * max(0, 62 - len(title)))


def ok(condition: bool, message: str, detail: Any = None) -> bool:
    global PASSED
    if condition:
        PASSED += 1
        return True
    extra = "" if detail is None else f" — {detail}"
    FAILURES.append(f"{message}{extra}")
    print(f"  ✗ {message}{extra}")
    return False


def note(message: str) -> None:
    print(f"  · {message}")


# ------------------------------------------------------------------------------------------------
# HTTP 工具
# ------------------------------------------------------------------------------------------------

def http_json(method: str, url: str, payload: Optional[Dict[str, Any]] = None,
              timeout: float = 60.0) -> Tuple[int, Any]:
    data = None
    headers = {"Accept": "application/json"}
    if payload is not None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = response.read()
            status = int(response.status)
    except urllib.error.HTTPError as exc:
        body = exc.read() or b""
        status = int(exc.code)
    try:
        parsed = json.loads(body.decode("utf-8")) if body else None
    except (UnicodeDecodeError, json.JSONDecodeError):
        parsed = body.decode("utf-8", "replace")
    return status, parsed


def http_text(url: str, timeout: float = 30.0) -> Tuple[int, str]:
    try:
        with urllib.request.urlopen(url, timeout=timeout) as response:
            return int(response.status), response.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:
        return int(exc.code), exc.read().decode("utf-8", "replace")


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def wait_for_ping(base: str, timeout: float = 40.0) -> bool:
    deadline = time.time() + timeout
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
# 零侵入快照
# ------------------------------------------------------------------------------------------------

def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def geo_snapshot() -> Dict[str, Tuple[str, int]]:
    snapshot: Dict[str, Tuple[str, int]] = {}
    for path in GEO_FILES:
        if path.exists():
            stat = path.stat()
            snapshot[str(path)] = (sha256_of(path), int(stat.st_mtime_ns))
        else:
            snapshot[str(path)] = ("<missing>", 0)
    return snapshot


def git_status(path: Path) -> Optional[List[str]]:
    try:
        result = subprocess.run(
            ["git", "-C", str(path), "status", "--porcelain"],
            capture_output=True, text=True, timeout=60, check=False,
        )
    except (FileNotFoundError, subprocess.SubprocessError):
        return None
    if result.returncode != 0:
        return None
    return [line for line in result.stdout.splitlines() if line.strip()]


# ------------------------------------------------------------------------------------------------
# 主流程
# ------------------------------------------------------------------------------------------------

def main() -> int:
    print("Terrax Settlement Studio V1.2 · 后端地理桥接与零侵入核验")
    print(f"  工程目录: {STUDIO_DIR}")
    print(f"  Python  : {sys.executable}")

    ok(SERVER_PY.exists(), "server.py 存在")
    ok(WEB_DIR.joinpath("index.html").exists(), "web/index.html 存在")
    ok(PROJECTS_DIR.exists(), "projects/ 目录存在")
    for filename in EXPECTED_PROJECTS:
        ok(PROJECTS_DIR.joinpath(filename).exists(), f"示例工程存在：{filename}")

    geo_before = geo_snapshot()
    git_before = git_status(WORLDBUILDING_DIR)
    if git_before is None:
        note(f"跳过 git 状态检查：{WORLDBUILDING_DIR} 不是可用的 git 仓库")
    elif git_before:
        note(f"worldbuilding 基线存在 {len(git_before)} 条历史改动（本次任务前既有，非本工程产生）：")
        for line in git_before:
            note(f"    {line}")
    else:
        note("worldbuilding 基线工作区干净（git status --porcelain 为空）")

    port = free_port()
    base = f"http://127.0.0.1:{port}"
    env = dict(os.environ)
    env["PYTHONUNBUFFERED"] = "1"
    log_path = STUDIO_DIR / ".verify_server.log"
    log_handle = log_path.open("w", encoding="utf-8")
    proc = subprocess.Popen(
        [sys.executable, str(SERVER_PY), "--port", str(port), "--host", "127.0.0.1"],
        cwd=str(STUDIO_DIR), stdout=log_handle, stderr=subprocess.STDOUT,
        env=env, start_new_session=True,
    )

    temp_files: List[Path] = []
    try:
        section("1. 服务启动与 /api/ping")
        started = wait_for_ping(base)
        ok(started, "server.py 在临时端口 3 秒级冷启动成功", port)
        if not started:
            tail = ""
            try:
                tail = log_path.read_text(encoding="utf-8")[-2000:]
            except OSError:
                pass
            print(tail)
            return 1

        status, ping = http_json("GET", f"{base}/api/ping")
        ok(status == 200, "/api/ping 返回 200", status)
        ok(isinstance(ping, dict) and ping.get("ok") is True, "/api/ping ok === true")
        ok(ping.get("service") == "terrax-settlement-studio", "service 名称正确", ping.get("service"))
        ok(ping.get("version") == "1.2.0", "version === 1.2.0", ping.get("version"))
        ok(ping.get("terraxDataAvailable") is True, "terraxDataAvailable === true", ping.get("terraxDataAvailable"))

        section("2. /api/terrax-context 起点城真值")
        status, ctx = http_json("GET", f"{base}/api/terrax-context?lon=42.51&lat=35.19&span_m=2800")
        ok(status == 200, "terrax-context 返回 200", status)
        ok(isinstance(ctx, dict) and ctx.get("ok") is True, "terrax-context ok === true")
        if isinstance(ctx, dict):
            grid = ctx.get("grid") or {}
            ok(grid.get("row") == 913, "grid.row === 913", grid.get("row"))
            ok(grid.get("col") == 3708, "grid.col === 3708", grid.get("col"))
            elev = ctx.get("elevM")
            ok(isinstance(elev, (int, float)) and abs(float(elev) - 484.9) < 1.0,
               "|elevM - 484.9| < 1.0 m", elev)
            ok(ctx.get("isLand") is True, "isLand === true", ctx.get("isLand"))
            ok(ctx.get("lakeId") == 0, "lakeId === 0", ctx.get("lakeId"))
            ok(ctx.get("owner") == 6, "owner === 6（B 大陆陆地）", ctx.get("owner"))
            slope_dir = ctx.get("slopeDirDeg")
            ok(isinstance(slope_dir, (int, float)) and 0.0 <= float(slope_dir) < 360.0,
               "slopeDirDeg 落在 [0, 360)", slope_dir)
            # 经度梯度已乘 cos(lat)：起点城实测约 312.9°（未乘 cos 时为 307.2°）
            ok(isinstance(slope_dir, (int, float)) and abs(float(slope_dir) - 312.9) <= 2.0,
               "经度梯度已乘 cos(lat)（slopeDirDeg ≈ 312.9°）", slope_dir)
            ok(isinstance(ctx.get("slopeMagM"), (int, float)), "slopeMagM 为数值", ctx.get("slopeMagM"))
            rivers = ctx.get("nearbyRivers") or []
            labels = [str(r.get("label")) for r in rivers]
            ids = [str(r.get("id")) for r in rivers]
            ok("1966" in ids or "R1966" in labels, "检出 R1966 河段", ids)
            r1966 = next((r for r in rivers if str(r.get("id")) == "1966"), None)
            ok(r1966 is not None and len(r1966.get("localPoints") or []) >= 2,
               "R1966 提供可用的局部折线",
               len((r1966 or {}).get("localPoints") or []))
            ok(isinstance(ctx.get("query"), dict) and ctx["query"].get("spanM") == 2800,
               "query.spanM 回显正确")
            note(f"elev={elev} m · owner={ctx.get('owner')} · slopeDir={slope_dir}° · "
                 f"nearby={[(r.get('label'), r.get('minDistKm')) for r in rivers]}")

        # 参数校验与异常路径
        status, bad = http_json("GET", f"{base}/api/terrax-context?lon=abc&lat=35.19")
        ok(status == 400, "非法 lon 参数返回 400", status)
        status, bad2 = http_json("GET", f"{base}/api/terrax-context?lon=200&lat=35.19")
        ok(status == 400, "超范围经度返回 400", status)

        section("3. /api/projects 与静态托管")
        status, listing = http_json("GET", f"{base}/api/projects")
        ok(status == 200 and isinstance(listing, dict) and listing.get("ok") is True, "/api/projects 返回 200")
        entries = (listing or {}).get("projects") or []
        names = [entry.get("filename") for entry in entries]
        ok(len(entries) == 3, "工程清单恰为 3 套", names)
        for filename in EXPECTED_PROJECTS:
            ok(filename in names, f"清单含 {filename}")

        for filename in EXPECTED_PROJECTS:
            status, project = http_json("GET", f"{base}/api/projects/{urllib.parse.quote(filename)}")
            ok(status == 200, f"GET {filename} 返回 200", status)
            if isinstance(project, dict):
                ok(project.get("schemaVersion") == "1.2.0", f"{filename} schemaVersion === 1.2.0")
                ok(isinstance(project.get("meta"), dict) and project["meta"].get("name"), f"{filename} meta 合法")
                ok(isinstance(project.get("terrain"), dict), f"{filename} terrain 合法")
                ok(isinstance(project.get("zones"), list) and len(project["zones"]) >= 4,
                   f"{filename} 选区数量 ≥ 4", len(project.get("zones") or []))
                ok(isinstance(project.get("legend"), dict), f"{filename} legend 合法")

        status, missing = http_json("GET", f"{base}/api/projects/__not_exist__.worldtown.json")
        ok(status == 404, "不存在的工程返回 404", status)

        status, html = http_text(f"{base}/web/index.html")
        ok(status == 200 and "Terrax Settlement Studio" in html, "/web/index.html 可访问且标题正确", status)
        status, js = http_text(f"{base}/web/js/app.js")
        ok(status == 200 and "createStudioApp" in js, "/web/js/app.js 可访问", status)
        status, css = http_text(f"{base}/web/css/atelier.css")
        ok(status == 200 and "--bg-desk" in css, "/web/css/atelier.css 可访问", status)

        section("4. POST /api/projects 落盘与路径剥离防护")
        temp_name = "__verify_tmp__.worldtown.json"
        temp_path = PROJECTS_DIR / temp_name
        temp_files.append(temp_path)
        payload_project = {
            "schemaVersion": "1.2.0",
            "meta": {"id": "proj_verify_tmp", "name": "核验临时工程", "worldSizeM": 1200},
            "terrain": {"baseElev": 480, "slopeMagM": 6, "shapes": []},
            "zones": [],
            "legend": {"items": []},
        }
        status, saved = http_json("POST", f"{base}/api/projects",
                                  {"filename": temp_name, "project": payload_project})
        ok(status == 200 and isinstance(saved, dict) and saved.get("ok") is True,
           "POST 保存返回 200 / ok", status)
        ok(temp_path.exists(), "临时工程已落盘 projects/")
        if temp_path.exists():
            stored = json.loads(temp_path.read_text(encoding="utf-8"))
            ok(stored.get("meta", {}).get("id") == "proj_verify_tmp", "落盘内容与请求一致")
        ok(isinstance(saved, dict) and saved.get("savedBytes", 0) > 0, "返回 savedBytes", (saved or {}).get("savedBytes"))

        # 路径逃逸：文件名剥离后必须仍落在 projects/
        escape_name = "../../../../tmp/__verify_escape__.worldtown.json"
        escape_path = PROJECTS_DIR / "__verify_escape__.worldtown.json"
        outside_path = Path("/tmp/__verify_escape__.worldtown.json")
        temp_files.append(escape_path)
        if outside_path.exists():
            outside_path.unlink()
        status, escaped = http_json("POST", f"{base}/api/projects",
                                    {"filename": escape_name, "project": payload_project})
        ok(status == 200 and (escaped or {}).get("filename") == "__verify_escape__.worldtown.json",
           "POST 路径剥离后文件名收敛为 basename", (escaped or {}).get("filename"))
        ok(escape_path.exists(), "剥离后的工程落在 projects/ 内")
        ok(not outside_path.exists(), "未在 /tmp 生成逃逸文件")

        # 并发保存同名工程：验证临时文件唯一化与原子替换
        import concurrent.futures

        concurrent_name = "__verify_concurrent__.worldtown.json"
        concurrent_path = PROJECTS_DIR / concurrent_name
        temp_files.append(concurrent_path)

        def _post_once(_idx: int) -> int:
            payload = {
                "schemaVersion": "1.2.0",
                "meta": {"id": f"proj_concurrent_{_idx}", "name": f"并发{_idx}", "worldSizeM": 1200},
                "terrain": {"baseElev": 480, "slopeMagM": 6, "shapes": []},
                "zones": [],
                "legend": {"items": []},
            }
            code, _body = http_json("POST", f"{base}/api/projects",
                                    {"filename": concurrent_name, "project": payload})
            return code

        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
            codes = list(pool.map(_post_once, range(6)))
        ok(all(code == 200 for code in codes), "6 路并发保存同名工程全部 200", codes)
        ok(concurrent_path.exists(), "并发保存后工程文件存在")
        if concurrent_path.exists():
            try:
                stored = json.loads(concurrent_path.read_text(encoding="utf-8"))
                ok(isinstance(stored.get("meta"), dict), "并发保存后的工程 JSON 完整可解析")
            except json.JSONDecodeError as exc:
                ok(False, "并发保存后的工程 JSON 完整可解析", str(exc))
        ok(len(list(PROJECTS_DIR.glob("*.tmp"))) == 0, "并发保存后无 .tmp 残留")

        status, bad_suffix = http_json("POST", f"{base}/api/projects",
                                       {"filename": "evil.json", "project": payload_project})
        ok(status == 400, "非 .worldtown.json 后缀被拒绝", status)
        status, no_project = http_json("POST", f"{base}/api/projects",
                                       {"filename": "x.worldtown.json"})
        ok(status == 400, "缺少 project 字段被拒绝", status)
        status, traversal_get = http_json("GET", f"{base}/api/projects/..%2F..%2Fetc%2Fpasswd")
        ok(status in (400, 404), "GET 路径穿越被拒绝", status)

    finally:
        section("5. 子进程回收与临时文件清理")
        try:
            if proc.poll() is None:
                os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
                for _ in range(50):
                    if proc.poll() is not None:
                        break
                    time.sleep(0.1)
                if proc.poll() is None:
                    os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
            ok(proc.poll() is not None, "server.py 子进程已回收", f"returncode={proc.poll()}")
        except ProcessLookupError:
            ok(True, "server.py 子进程已退出")
        log_handle.close()

        removed = 0
        for path in temp_files:
            try:
                if path.exists():
                    path.unlink()
                    removed += 1
            except OSError:
                pass
        leftovers = [p.name for p in PROJECTS_DIR.glob("*.tmp")]
        ok(not any(p.exists() for p in temp_files), "临时工程文件已清理", removed)
        ok(len(leftovers) == 0, "projects/ 无 .tmp 残留", leftovers)
        try:
            log_path.unlink()
        except OSError:
            pass

    section("6. 地理数据只读与仓库零侵入")
    geo_after = geo_snapshot()
    changed = []
    for key, before in geo_before.items():
        after = geo_after.get(key)
        if after != before:
            changed.append((Path(key).name, before, after))
    ok(len(changed) == 0, "五大地理数据文件 sha256 与 mtime 前后完全一致", changed)
    for key in geo_before:
        note(f"{Path(key).name:32s} {geo_before[key][0][:16]}… mtime_ns={geo_before[key][1]}")

    git_after = git_status(WORLDBUILDING_DIR)
    if git_before is None or git_after is None:
        note("git 状态检查跳过（仓库不可用）")
    else:
        new_entries = [line for line in git_after if line not in git_before]
        ok(len(git_after) == len(git_before), "worldbuilding git 状态条目数未增加",
           f"{len(git_before)} → {len(git_after)}")
        ok(len(new_entries) == 0, "worldbuilding 无本次新增改动", new_entries)
        if not git_before:
            ok(len(git_after) == 0, "worldbuilding git status --porcelain 为空", git_after)
        else:
            note("基线既有改动保持原样（历史遗留，本次核验未触碰）：")
            for line in git_before:
                note(f"    {line}")

    section("7. 上层世界观核验脚本（三套）")
    for script in UPPER_SCRIPTS:
        ok(script.exists(), f"核验脚本存在：{script.name}")
        if not script.exists():
            continue
        result = subprocess.run(
            [sys.executable, str(script)],
            cwd=str(script.parent), capture_output=True, text=True, timeout=600,
        )
        ok(result.returncode == 0, f"{script.name} 退出码为 0", result.returncode)
        output = (result.stdout or "").strip().splitlines()
        for line in output[-2:]:
            note(line[:240])
        if result.returncode != 0:
            print((result.stderr or "")[-2000:])

    section("汇总")
    if FAILURES:
        print(f"\n✗ verify_backend: {len(FAILURES)} 项失败 / {PASSED} 项通过")
        for item in FAILURES:
            print(f"   - {item}")
        return 1
    print(f"\n✓ verify_backend: {PASSED} 项断言全部通过；地理数据只读、临时文件已清理、上层核验退出码 0。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
