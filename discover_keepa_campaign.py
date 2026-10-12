#!/usr/bin/env python3
"""Run a restartable, category-diverse Keepa ASIN discovery campaign.

Each Finder request saves its own ASINs and cursor in research_progress.json. A
Finder hit is only an unverified lead; the script never adds catalog products.
"""

import argparse
import json
import math
import subprocess
import sys
import time
from datetime import datetime

from discover_keepa_finder import PROGRESS, ROOT


# Prefer categories and titles whose contents can plausibly be sent flat.
# The broad queries are intentionally split from title queries to expose what
# still lies beyond Keepa's 10,000-result window for each selection.
SEEDS = [
    {"category": 1153734051, "title": ""},  # flat files
    {"category": 16391872051, "title": ""},  # document pockets
    {"category": 89154051, "title": ""},  # document files
    {"category": 71250051, "title": ""},  # retort foods
    {"root": 86731051, "title": "封筒"},
    {"root": 86731051, "title": "クリアファイル"},
    {"root": 86731051, "title": "フラットファイル"},
    {"root": 86731051, "title": "ファイルポケット"},
    {"root": 86731051, "title": "書類ケース"},
    {"root": 86731051, "title": "書類ホルダー"},
    {"root": 86731051, "title": "クリアポケット"},
    {"root": 86731051, "title": "レターパッド"},
    {"root": 86731051, "title": "コピー用紙"},
    {"root": 86731051, "title": "ラベルシール"},
    {"root": 86731051, "title": "ノート"},
    {"root": 86731051, "title": "便箋"},
    {"root": 57239051, "title": "レトルト"},
    {"root": 57239051, "title": "ふりかけ"},
    {"root": 57239051, "title": "粉末"},
    {"root": 57239051, "title": "パウチ"},
    {"root": 57239051, "title": "個包装"},
    {"root": 57239051, "title": "ドライフルーツ"},
    {"root": 57239051, "title": "スープ"},
    {"root": 160384011, "title": "入浴剤"},
    {"root": 160384011, "title": "マスク"},
    {"root": 160384011, "title": "ウェットティッシュ"},
    {"root": 160384011, "title": "掃除シート"},
    {"root": 160384011, "title": "詰め替え"},
    {"root": 160384011, "title": "洗剤"},
    {"root": 160384011, "title": "歯磨き粉"},
    {"root": 3828871, "title": "タオル"},
    {"root": 3828871, "title": "ハンカチ"},
    {"root": 3828871, "title": "収納袋"},
    {"root": 3828871, "title": "圧縮袋"},
    {"root": 3828871, "title": "キッチンシート"},
    {"root": 3828871, "title": "エコバッグ"},
    {"root": 3828871, "title": "洗濯ネット"},
    {"root": 3828871, "title": "ふきん"},
    {"root": 3828871, "title": "ジッパーバッグ"},
    {"root": 3828871, "title": "キッチンスポンジ"},
    {"root": 2229202051, "title": "靴下"},
    {"root": 2229202051, "title": "ハンカチ"},
    {"root": 2229202051, "title": "Tシャツ"},
    {"root": 2229202051, "title": "インナー"},
    {"root": 2229202051, "title": "ストッキング"},
    {"root": 2229202051, "title": "手袋"},
]


def selection_for(seed, page=0, per_page=1000):
    result = {"perPage": per_page, "page": page}
    if seed.get("title"):
        result["title"] = seed["title"]
    if seed.get("root"):
        result["rootCategory"] = [seed["root"]]
    if seed.get("category"):
        result["categories_include"] = [seed["category"]]
    # Missing Keepa weight, dimensions or item count must remain discoverable.
    # Those fields are checked later, after a lead has been found.
    return result


def pending(progress):
    runs = {json.dumps(row.get("selection"), sort_keys=True): row
            for row in progress.get("finderRuns", [])}
    # Sample every promising family before walking deeper into a large result set.
    for seed in SEEDS:
        selection = selection_for(seed)
        if json.dumps(selection, sort_keys=True) not in runs:
            yield seed, 0
    for seed in SEEDS:
        for page in range(1, 10):
            selection = selection_for(seed, page)
            key = json.dumps(selection, sort_keys=True)
            if key not in runs:
                previous = runs.get(json.dumps(selection_for(seed, page - 1), sort_keys=True))
                if previous and (previous.get("totalResultsEstimate") or 0) > page * selection["perPage"]:
                    yield seed, page
                break


def available_tokens(progress):
    runs = [row for row in progress.get("finderRuns", [])
            if isinstance(row.get("tokensLeft"), (int, float)) and row.get("queriedAt")]
    if not runs:
        return 0
    last = runs[-1]
    elapsed = max(0, (datetime.now().astimezone() - datetime.fromisoformat(last["queriedAt"])).total_seconds())
    return min(100, last["tokensLeft"] + math.floor(elapsed * (last.get("refillRate") or 5) / 60))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--max-runs", type=int, default=3)
    parser.add_argument("--wait-for-tokens", action="store_true", help="トークン補充まで待って次の条件を続行")
    args = parser.parse_args()
    if not 1 <= args.max_runs <= 100:
        parser.error("max-runs は1〜100")
    completed = 0
    for _ in range(args.max_runs):
        progress = json.loads(PROGRESS.read_text())
        todo = list(pending(progress))
        if not todo:
            print("設定済みの探索条件はすべて照会済み。より細かいカテゴリの追加が必要。")
            break
        # A 1,000-ASIN Finder page costs at most 20 tokens. Keep a reserve so
        # this campaign does not consume the entire shared account bucket.
        while available_tokens(progress) < 30:
            if not args.wait_for_tokens:
                print(f"補充待ち: 推定残 {available_tokens(progress)} トークン。次回再開可能。")
                return 0
            time.sleep(60)
            progress = json.loads(PROGRESS.read_text())
        seed, page = todo[0]
        command = [sys.executable, str(ROOT / "discover_keepa_finder.py"),
                   "--per-page", "1000", "--page", str(page),
                   "--min-package-side-mm", "0"]
        if seed.get("title"):
            command += ["--title", seed["title"]]
        if seed.get("root"):
            command += ["--root-category", str(seed["root"])]
        if seed.get("category"):
            command += ["--category-include", str(seed["category"])]
        result = subprocess.run(command, check=False)
        if result.returncode:
            print(f"探索停止: 条件 {seed} の page {page}、終了コード {result.returncode}")
            return result.returncode
        completed += 1
    print(f"今回の探索条件 {completed} 件。残りの範囲は次回のキャンペーン実行で再開。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
