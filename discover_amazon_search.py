#!/usr/bin/env python3
"""Collect unverified ASIN leads from Amazon.co.jp search pages.

This only expands the research queue. It never adds an ASIN to the product catalog.
Each successful search page is recorded immediately so the run can be resumed.
"""

import argparse
import json
import re
import time
from datetime import datetime
from pathlib import Path
from urllib.parse import urlencode
from zoneinfo import ZoneInfo

import requests
from bs4 import BeautifulSoup


ROOT = Path(__file__).resolve().parent
PROGRESS = ROOT / "research_progress.json"
QUERIES = ROOT / "discovery_queries.txt"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124.0 Safari/537.36",
    "Accept-Language": "ja-JP,ja;q=0.9",
}
ASIN = re.compile(r"B[0-9A-Z]{9}\Z")


def query_lines():
    return [line.strip() for line in QUERIES.read_text().splitlines()
            if line.strip() and not line.lstrip().startswith("#")]


def search_page(session, query, page):
    url = "https://www.amazon.co.jp/s?" + urlencode({"k": query, "page": page})
    response = session.get(url, headers=HEADERS, timeout=30)
    response.raise_for_status()
    soup = BeautifulSoup(response.text, "html.parser")
    if soup.select_one('form[action*="validateCaptcha"]') or "ロボットではない" in soup.get_text(" ", strip=True)[:300]:
        raise RuntimeError("Amazon CAPTCHA: 検索を停止")
    title = soup.title.get_text(" ", strip=True) if soup.title else ""
    if not title.startswith("Amazon.co.jp"):
        raise RuntimeError("Amazon検索結果と確認できないページ: 検索を停止")
    found = []
    for element in soup.select("[data-asin]"):
        asin = element.get("data-asin", "")
        if ASIN.fullmatch(asin) and asin not in found:
            found.append(asin)
    if not found and "検索クエリに一致する結果はありません" not in soup.get_text(" ", strip=True):
        raise RuntimeError("ASINが0件の検索ページ: 制限やページ構造変更を確認するため停止")
    return found


def save(progress):
    progress["discoveredCount"] = len(progress["discovered"])
    progress["searchedOn"] = datetime.now(ZoneInfo("Asia/Tokyo")).date().isoformat()
    temp = PROGRESS.with_suffix(".json.tmp")
    temp.write_text(json.dumps(progress, ensure_ascii=False, indent=2) + "\n")
    temp.replace(PROGRESS)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pages", type=int, default=3, help="各検索語で調べるページ数")
    parser.add_argument("--max-requests", type=int, default=60, help="今回の最大検索ページ数")
    parser.add_argument("--pause", type=float, default=1.5, help="検索ページ間の待機秒数")
    args = parser.parse_args()
    if args.pages < 1 or args.max_requests < 1 or args.pause < 1:
        parser.error("pages / max-requests / pause は正の値（pause は1秒以上）")

    progress = json.loads(PROGRESS.read_text())
    by_asin = {item["asin"]: item for item in progress["discovered"]}
    done = {(run.get("query"), run.get("searchPage")) for run in progress.get("searchRuns", [])
            if run.get("searchPage") and run.get("source") == "Amazon.co.jp search page"}
    requests_made = 0
    new_asins = 0
    with requests.Session() as session:
        for query in query_lines():
            for page in range(1, args.pages + 1):
                if (query, page) in done:
                    continue
                if requests_made >= args.max_requests:
                    print(f"今回 {requests_made} 検索ページ、調査候補 {new_asins} ASIN追加。後続ページは未確認。")
                    return 0
                try:
                    asins = search_page(session, query, page)
                except (requests.RequestException, RuntimeError) as exc:
                    progress.setdefault("searchStops", []).append({
                        "searchedOn": datetime.now(ZoneInfo("Asia/Tokyo")).date().isoformat(),
                        "query": query,
                        "searchPage": page,
                        "reason": str(exc) if isinstance(exc, RuntimeError) else type(exc).__name__,
                    })
                    save(progress)
                    print(f"停止: {query} / {page}ページ: {type(exc).__name__}: {exc}")
                    return 1
                for asin in asins:
                    if asin in by_asin:
                        if query not in by_asin[asin]["queries"]:
                            by_asin[asin]["queries"].append(query)
                    else:
                        item = {"asin": asin, "queries": [query], "status": "not_fetched"}
                        progress["discovered"].append(item)
                        by_asin[asin] = item
                        new_asins += 1
                if query not in progress["queries"]:
                    progress["queries"].append(query)
                progress["searchRuns"].append({
                    "searchedOn": datetime.now(ZoneInfo("Asia/Tokyo")).date().isoformat(),
                    "query": query,
                    "source": "Amazon.co.jp search page",
                    "searchPage": page,
                    "mainResultCountShown": None,
                    "asinsVisibleIncludingSponsored": len(asins),
                    "pagesChecked": 0,
                    "laterPagesChecked": page > 1,
                    "note": ("検索結果0件。" if not asins else "検索結果からASINを収集したのみ。")
                    + "商品ページ・単品・袋形状・掲載寸法・仕入先・利益は未確認。",
                })
                progress["method"] = "Amazon.co.jp検索結果の確認済みページからASINを収集し、商品ページは別途個別照合。"
                progress["coverageNote"] = "確認済みの検索語・ページ以外と、未確認ASINは残る。Amazon全商品を網羅していない。"
                save(progress)
                requests_made += 1
                print(f"検索 {requests_made}: {query} / {page}ページ、表示 {len(asins)}、新規 {new_asins}、累計 {len(by_asin)}", flush=True)
                time.sleep(args.pause)
                if not asins:
                    break
    print(f"今回 {requests_made} 検索ページ、調査候補 {new_asins} ASIN追加。商品登録は0件。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
