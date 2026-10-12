#!/usr/bin/env python3
"""Batch-check discovered ASIN titles and catalog dimensions with Amazon SP-API.

The append-only output is a resumable research cache, not an eligibility verdict.
Catalog dimensions do not prove the unopened item can be mailed at 3 cm.
"""

import argparse
import json
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode

import sync_api_dimensions as api
from triage_keepa_leads import score_product


ROOT = Path(__file__).resolve().parent
PROGRESS = ROOT / "research_progress.json"
OUTPUT = ROOT / "sp_catalog_triage.jsonl"
ENDPOINT = "https://sellingpartnerapi-fe.amazon.com/catalog/2022-04-01/items"


def checked_asins():
    found = set()
    if OUTPUT.exists():
        with OUTPUT.open() as handle:
            for line in handle:
                try:
                    found.add(json.loads(line)["asin"])
                except (ValueError, KeyError):
                    continue
    return found


def compact(product, asin):
    summary = next((item for item in product.get("summaries", [])
                    if item.get("marketplaceId") == api.MARKETPLACE), {})
    dimensions = next((item for item in product.get("dimensions", [])
                       if item.get("marketplaceId") == api.MARKETPLACE), {})
    package = api.sp_triplet(dimensions.get("package"))
    item = api.sp_triplet(dimensions.get("item"))
    title = summary.get("itemName") or ""
    score_input = {"title": title}
    if package:
        for axis, cm in zip(("Length", "Width", "Height"), package["cm"]):
            score_input[f"package{axis}"] = cm * 10
    score, tags = score_product(score_input)
    return {
        "asin": asin,
        "checkedAt": datetime.now(timezone.utc).isoformat(),
        "status": "found" if product else "missing",
        "title": title,
        "packageCm": package["cm"] if package else None,
        "itemCm": item["cm"] if item else None,
        "score": score,
        "tags": tags,
        "source": "Amazon SP-API Catalog Items; metadata only",
    }


def request_batch(asins, headers):
    query = urlencode({"identifiers": ",".join(asins), "identifiersType": "ASIN",
                       "marketplaceIds": api.MARKETPLACE,
                       "includedData": "summaries,dimensions", "pageSize": 20})
    for attempt in range(4):
        try:
            return api.request_json(f"{ENDPOINT}?{query}", headers=headers)
        except RuntimeError as exc:
            if str(exc) == "API HTTP 429" and attempt < 3:
                time.sleep(2 ** (attempt + 1))
                continue
            raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-contains", default="", help="発見経路の部分一致。空欄なら全候補")
    parser.add_argument("--limit", type=int, default=200, help="今回の最大照会ASIN数")
    parser.add_argument("--pause", type=float, default=.6, help="20件照会の間隔（秒）")
    args = parser.parse_args()
    if not 1 <= args.limit <= 20000 or args.pause < .5:
        parser.error("limit は1〜20000、pause は0.5秒以上")
    progress = json.loads(PROGRESS.read_text())
    checked = checked_asins()
    selected = [row["asin"] for row in progress["discovered"]
                if row["asin"] not in checked and row["status"] == "not_fetched"
                and (not args.source_contains or any(args.source_contains in source
                     for source in row.get("discoverySources", [])))][:args.limit]
    if not selected:
        print("新たに照会するASINはありません")
        return 0
    api.load_existing_keychain()
    token = api.sp_access_token()
    headers = {"x-amz-access-token": token,
               "x-amz-date": datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ"),
               "User-Agent": "NekoposResearch/1.0 (Language=Python)",
               "Accept": "application/json"}
    done = 0
    try:
        with OUTPUT.open("a") as output:
            for group in api.chunks(selected, 20):
                response = request_batch(group, headers)
                products = {item.get("asin"): item for item in response.get("items", [])}
                if response.get("pagination", {}).get("nextToken"):
                    raise RuntimeError("SP-APIの20件照会に未取得ページがありました。照会を停止。")
                for asin in group:
                    output.write(json.dumps(compact(products.get(asin, {}), asin), ensure_ascii=False,
                                            separators=(",", ":")) + "\n")
                output.flush()
                done += len(group)
                print(f"SP-API商品情報 {done}/{len(selected)}", flush=True)
                if done < len(selected):
                    time.sleep(args.pause)
    except RuntimeError as exc:
        print(f"SP-API商品情報の照会を停止: {exc}")
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
