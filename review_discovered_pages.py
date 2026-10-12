#!/usr/bin/env python3
"""Fetch unreviewed Amazon product pages for human eligibility review.

The output is evidence, not a shipping verdict. This script never adds a product
to the catalog or infers a measured, flattened thickness from listed dimensions.
Run it separately from discover_amazon_search.py because both update progress.
"""

import argparse
import html
import json
import re
import time
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import requests
from bs4 import BeautifulSoup


ROOT = Path(__file__).resolve().parent
PROGRESS = ROOT / "research_progress.json"
REVIEWS = ROOT / "product_page_reviews.json"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124.0 Safari/537.36",
    "Accept-Language": "ja-JP,ja;q=0.9",
}
DIMENSION = re.compile(
    r"(\d+(?:\.\d+)?)\s*[×xX*]\s*(\d+(?:\.\d+)?)\s*[×xX*]\s*(\d+(?:\.\d+)?)\s*(cm|mm)",
    re.I,
)


def save_json(path, payload):
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")
    temp.replace(path)


def collect_dimensions(soup):
    found = []
    for selector in ("#detailBullets_feature_div", "#prodDetails", "#productDetails_detailBullets_sections1"):
        section = soup.select_one(selector)
        if not section:
            continue
        text = section.get_text(" ", strip=True)
        for match in DIMENSION.finditer(text):
            context = text[max(0, match.start() - 55):min(len(text), match.end() + 35)]
            item = {"value": match.group(0), "context": context}
            if item not in found:
                found.append(item)
    return found


def fetch_page(session, asin):
    response = session.get(f"https://www.amazon.co.jp/dp/{asin}", headers=HEADERS, timeout=30)
    response.raise_for_status()
    soup = BeautifulSoup(response.text, "html.parser")
    if soup.select_one('form[action*="validateCaptcha"]'):
        raise RuntimeError("Amazon CAPTCHA: 商品ページの照合を停止")
    title_element = soup.select_one("#productTitle")
    if not title_element:
        raise RuntimeError("商品ページと確認できない応答: 照合を停止")
    title = title_element.get_text(" ", strip=True)
    image_element = soup.select_one("#landingImage")
    image_url = ""
    if image_element:
        image_url = html.unescape(image_element.get("data-old-hires") or image_element.get("src") or "")
        if not image_url.startswith("https://m.media-amazon.com/images/I/"):
            image_url = ""
    return {
        "asin": asin,
        "checkedOn": datetime.now(ZoneInfo("Asia/Tokyo")).date().isoformat(),
        "source": f"https://www.amazon.co.jp/dp/{asin}",
        "title": title,
        "dimensions": collect_dimensions(soup),
        "primaryImageUrl": image_url,
        "reviewStatus": "needs_manual_shape_and_unit_check",
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--query-contains", default="", help="照合するAmazon検索語に含まれる文字列")
    parser.add_argument("--finder-contains", default="", help="照合するKeepa Finder検索語に含まれる文字列")
    parser.add_argument("--title-regex", default="", help="保存済み検索結果タイトルが一致するASINだけ照合")
    parser.add_argument("--exclude-title-regex", default="", help="保存済み検索結果タイトルが一致するASINを除外")
    parser.add_argument("--require-metadata", action="store_true", help="Keepaの商品名と寸法を取得済みのASINだけ照合")
    parser.add_argument("--min-triage-score", type=int, default=None, help="Keepaの商品情報に基づく優先度の下限")
    parser.add_argument("--limit", type=int, default=30)
    parser.add_argument("--pause", type=float, default=1.5)
    args = parser.parse_args()
    if not args.query_contains and not args.finder_contains:
        parser.error("query-contains または finder-contains が必要")
    if args.limit < 1 or args.pause < 1:
        parser.error("limit は1以上、pause は1秒以上")
    title_pattern = re.compile(args.title_regex, re.I) if args.title_regex else None
    exclude_pattern = re.compile(args.exclude_title_regex, re.I) if args.exclude_title_regex else None
    progress = json.loads(PROGRESS.read_text())
    reviews = json.loads(REVIEWS.read_text()) if REVIEWS.exists() else {"reviews": []}
    reviewed = {row["asin"] for row in reviews["reviews"]}
    selected = [row for row in progress["discovered"]
                if row["status"] == "not_fetched" and row["asin"] not in reviewed
                and ((args.query_contains and any(args.query_contains in query for query in row["queries"]))
                     or (args.finder_contains and any(args.finder_contains in source for source in row.get("discoverySources", []))))
                and (not args.require_metadata or row.get("keepaMetadataCheckedAt"))
                and (args.min_triage_score is None or row.get("triageScore", -999) >= args.min_triage_score)
                and (not title_pattern or title_pattern.search(row.get("keepaTitle") or row.get("searchTitle", "")))
                and (not exclude_pattern or not exclude_pattern.search(row.get("keepaTitle") or row.get("searchTitle", "")))]
    selected.sort(key=lambda row: row.get("triageScore", -999), reverse=True)
    selected = selected[:args.limit]
    if not selected:
        print("対象の未確認ASINはありません")
        return 0
    checked = []
    stopped = False
    with requests.Session() as session:
        for row in selected:
            asin = row["asin"]
            try:
                review = fetch_page(session, asin)
            except (requests.RequestException, RuntimeError) as exc:
                progress.setdefault("reviewStops", []).append({
                    "checkedOn": datetime.now(ZoneInfo("Asia/Tokyo")).date().isoformat(),
                    "asin": asin,
                    "reason": str(exc) if isinstance(exc, RuntimeError) else type(exc).__name__,
                })
                save_json(PROGRESS, progress)
                print(f"停止: {asin}: {type(exc).__name__}: {exc}", flush=True)
                stopped = True
                break
            reviews["reviews"].append(review)
            save_json(REVIEWS, reviews)
            row["status"] = "page_fetched_not_added"
            progress["fetchedProductPageCount"] = sum(
                x["status"] != "not_fetched" for x in progress["discovered"])
            save_json(PROGRESS, progress)
            checked.append(asin)
            print(f"{len(checked)}/{len(selected)} {asin} {review['title'][:75]} | 寸法 {len(review['dimensions'])}件", flush=True)
            time.sleep(args.pause)
    if checked:
        progress.setdefault("reviewRuns", []).append({
            "reviewedOn": datetime.now(ZoneInfo("Asia/Tokyo")).date().isoformat(),
            "scope": f"Amazon.co.jp商品ページ: {args.query_contains or args.finder_contains}由来の未確認ASINのタイトル・掲載寸法・主画像URLを取得",
            "asinsChecked": checked,
            "pagesChecked": len(checked),
            "added": 0,
            "unverifiedRange": "単品・柔らかい袋・付属品・平置き後厚さは未判定。商品写真と掲載寸法の出典を個別確認する必要がある。",
        })
        save_json(PROGRESS, progress)
    print(f"商品ページ照合 {len(checked)} 件。登録は未実施。")
    return 1 if stopped else 0


if __name__ == "__main__":
    raise SystemExit(main())
