#!/usr/bin/env python3
"""Collect unverified Amazon.co.jp ASIN leads using Keepa Product Finder.

Keepa's catalog and package dimensions are discovery filters only. Every product
still needs a live Amazon page, unit/shape check and measured shipping parcel.
"""

import argparse
import getpass
import json
import os
import re
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import requests

ROOT = Path(__file__).resolve().parent
PROGRESS = ROOT / "research_progress.json"
VALID_ASIN = re.compile(r"B[0-9A-Z]{9}\Z")


def keepa_key():
    key = os.environ.get("KEEPA_API_KEY")
    if key:
        return key
    if sys.platform == "darwin":
        try:
            result = subprocess.run(
                ["security", "find-generic-password", "-w", "-a", getpass.getuser(),
                 "-s", "kojima-profit-keepa-api"],
                capture_output=True, text=True, timeout=10, check=False,
            )
            if result.returncode == 0:
                return result.stdout.strip()
        except (OSError, subprocess.SubprocessError):
            pass
    return ""


def save(progress):
    progress["discoveredCount"] = len(progress["discovered"])
    progress["searchedOn"] = datetime.now(ZoneInfo("Asia/Tokyo")).date().isoformat()
    temp = PROGRESS.with_suffix(".json.tmp")
    temp.write_text(json.dumps(progress, ensure_ascii=False, indent=2) + "\n")
    temp.replace(PROGRESS)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--title", default="", help="Keepaのタイトル検索語。カテゴリ検索時は省略可")
    parser.add_argument("--root-category", type=int, default=0, help="Amazon.co.jpのルートカテゴリID")
    parser.add_argument("--category-include", type=int, default=0, help="Amazon.co.jpの下位カテゴリID")
    parser.add_argument("--min-package-side-mm", type=int, default=31, help="掲載パッケージ3辺の下限。0で寸法フィルタなし")
    parser.add_argument("--per-page", type=int, default=4000, help="1回の取得上限。50〜10000")
    parser.add_argument("--page", type=int, default=0)
    parser.add_argument("--min-package-weight-g", type=int, default=0, help="掲載パッケージ重量の下限。0は指定なし")
    parser.add_argument("--max-package-weight-g", type=int, default=0, help="Keepa掲載パッケージ重量の上限。0は指定なし")
    parser.add_argument("--single-item", action="store_true", help="Keepa掲載の商品入り数が1のみ")
    args = parser.parse_args()
    if not (args.title or args.root_category or args.category_include):
        parser.error("title、root-category、category-include のいずれかが必要")
    if not 50 <= args.per_page <= 10000 or args.page < 0:
        parser.error("per-page は50〜10000、page は0以上")
    if args.page and (args.page + 1) * args.per_page > 10000:
        parser.error("Keepaの同一検索で参照できる上限は10,000 ASIN")
    if min(args.min_package_side_mm, args.min_package_weight_g, args.max_package_weight_g,
           args.root_category, args.category_include) < 0:
        parser.error("寸法・重量・カテゴリIDは0以上")
    if args.max_package_weight_g and args.min_package_weight_g > args.max_package_weight_g:
        parser.error("重量の上限は下限以上")

    selection = {"perPage": args.per_page, "page": args.page}
    if args.title:
        selection["title"] = args.title
    if args.root_category:
        selection["rootCategory"] = [args.root_category]
    if args.category_include:
        selection["categories_include"] = [args.category_include]
    if args.min_package_side_mm:
        for field in ("packageHeight_gte", "packageLength_gte", "packageWidth_gte"):
            selection[field] = args.min_package_side_mm
    if args.min_package_weight_g:
        selection["packageWeight_gte"] = args.min_package_weight_g
    if args.max_package_weight_g:
        selection["packageWeight_lte"] = args.max_package_weight_g
    if args.single_item:
        selection["numberOfItems_gte"] = 1
        selection["numberOfItems_lte"] = 1
    progress = json.loads(PROGRESS.read_text())
    if any(run.get("selection") == selection for run in progress.get("finderRuns", [])):
        print("同じKeepa検索条件は取得済み")
        return 0
    key = keepa_key()
    if not key:
        raise RuntimeError("Keepa API key unavailable")
    try:
        response = requests.post(
            "https://api.keepa.com/query", params={"domain": 5, "key": key},
            json=selection, timeout=90,
        )
    except requests.RequestException as exc:
        raise RuntimeError(f"Keepa request failed: {type(exc).__name__}") from None
    if response.status_code != 200:
        raise RuntimeError(f"Keepa HTTP {response.status_code}")
    payload = response.json()
    if payload.get("error") or not isinstance(payload.get("asinList"), list):
        raise RuntimeError(f"Keepa Product Finder error: {payload.get('error', 'missing asinList')}")
    asins = [asin for asin in payload["asinList"] if isinstance(asin, str) and VALID_ASIN.fullmatch(asin)]
    by_asin = {row["asin"]: row for row in progress["discovered"]}
    new_count = 0
    label_parts = [f"title={args.title}"] if args.title else []
    if args.root_category:
        label_parts.append(f"root={args.root_category}")
    if args.category_include:
        label_parts.append(f"category={args.category_include}")
    if args.min_package_weight_g or args.max_package_weight_g:
        label_parts.append(f"weight={args.min_package_weight_g}-{args.max_package_weight_g or '*'}g")
    if args.min_package_side_mm != 31:
        label_parts.append(f"side>={args.min_package_side_mm}mm")
    label = "Keepa " + " ".join(label_parts)
    for asin in asins:
        if asin in by_asin:
            row = by_asin[asin]
        else:
            row = {"asin": asin, "queries": [], "status": "not_fetched"}
            progress["discovered"].append(row)
            by_asin[asin] = row
            new_count += 1
        sources = row.setdefault("discoverySources", [])
        if label not in sources:
            sources.append(label)
    progress.setdefault("finderRuns", []).append({
        "searchedOn": datetime.now(ZoneInfo("Asia/Tokyo")).date().isoformat(),
        "queriedAt": datetime.now(ZoneInfo("Asia/Tokyo")).isoformat(),
        "source": "Keepa Product Finder (Amazon.co.jp database)",
        "selection": selection,
        "returnedAsins": len(asins),
        "newAsins": new_count,
        "totalResultsEstimate": payload.get("totalResults"),
        "tokensConsumed": payload.get("tokensConsumed"),
        "tokensLeft": payload.get("tokensLeft"),
        "refillRate": payload.get("refillRate"),
        "note": "Keepa登録値によるASIN発見のみ。現行Amazonページ・単品・柔らかさ・発送時の厚みは未確認。",
    })
    progress["method"] = "Amazon.co.jp検索結果とKeepa Product Finderから未確認ASINを収集し、商品ページは別途個別照合。"
    progress["coverageNote"] = "Keepaデータベースと確認済みAmazon検索語・ページ以外のASINは残る。Amazon全商品を網羅していない。"
    save(progress)
    print(f"{label}: 返却 {len(asins)} / 推定一致 {payload.get('totalResults')} / 新規 {new_count} / 累計 {len(by_asin)} / 消費 {payload.get('tokensConsumed')} トークン / 残 {payload.get('tokensLeft')}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
