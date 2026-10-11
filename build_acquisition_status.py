#!/usr/bin/env python3
"""Build the small file://-compatible research snapshot used by acquisition.html."""

import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parent
PROGRESS = ROOT / "research_progress.json"
OUTPUT = ROOT / "acquisition_status.js"


def read_js(name):
    text = (ROOT / name).read_text()
    return json.loads(text.split(" = ", 1)[1].strip().removesuffix(";"))


def build():
    research = json.loads(PROGRESS.read_text())
    products = {item["asin"]: item for item in read_js("data.js")}
    excluded_file = ROOT / "excluded_products.json"
    excluded = {item["asin"]: item for item in json.loads(excluded_file.read_text()).get("items", [])} if excluded_file.exists() else {}
    discovered = research["discovered"]
    status_counts = Counter(item["status"] for item in discovered)
    additions = []
    for item in discovered:
        if item["status"] != "added":
            continue
        product = products.get(item["asin"]) or excluded.get(item["asin"])
        additions.append({
            "asin": item["asin"],
            "title": product["title"] if product else "商品一覧に未登録",
            "category": product["category"] if product else "未登録",
            "queries": item["queries"],
            "inCatalog": item["asin"] in products,
        })
    queries = []
    for query in research["queries"]:
        matches = [item for item in discovered if query in item["queries"]]
        queries.append({
            "query": query,
            "discovered": len(matches),
            "pageChecked": sum(item["status"] != "not_fetched" for item in matches),
            "added": sum(item["status"] == "added" for item in matches),
        })
    snapshot = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "researchFileUpdatedAt": datetime.fromtimestamp(PROGRESS.stat().st_mtime, timezone.utc).isoformat(),
        "predictionsUpdatedAt": datetime.fromtimestamp((ROOT / "predictions.js").stat().st_mtime, timezone.utc).isoformat(),
        "searchedOn": research["searchedOn"],
        "marketplace": research["marketplace"],
        "scope": "各検索語の検索結果1ページ目。Amazon全体の網羅調査ではありません。",
        "accessLimitedSearchCount": len(research.get("accessLimitedSearches", {}).get("queries", [])),
        "queryCount": len(research["queries"]),
        "discoveredCount": len(discovered),
        "pageCheckedCount": status_counts["page_fetched_not_added"] + status_counts["added"],
        "notFetchedCount": status_counts["not_fetched"],
        "pageCheckedNotAddedCount": status_counts["page_fetched_not_added"],
        "addedCount": status_counts["added"],
        "reportedPageCheckedCount": research.get("fetchedProductPageCount"),
        "reportedAddedCount": research.get("addedCount"),
        "queries": queries,
        "additions": additions,
    }
    OUTPUT.write_text("window.NEKOPOST_RESEARCH_STATUS = " + json.dumps(snapshot, ensure_ascii=False, separators=(",", ":")) + ";\n")
    print(f"Saved {OUTPUT.name}: {snapshot['queryCount']} searches, {snapshot['discoveredCount']} found, {snapshot['pageCheckedCount']} checked, {snapshot['addedCount']} added")


if __name__ == "__main__":
    build()
