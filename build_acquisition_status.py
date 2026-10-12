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
    review_file = ROOT / "product_page_reviews.json"
    review_pending_count = (sum(item.get("reviewStatus") == "needs_manual_shape_and_unit_check"
                                for item in json.loads(review_file.read_text()).get("reviews", []))
                            if review_file.exists() else 0)
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
            "discoverySources": item.get("discoverySources", []),
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
    query_file = ROOT / "discovery_queries.txt"
    planned_queries = [line.strip() for line in query_file.read_text().splitlines()
                       if line.strip() and not line.lstrip().startswith("#")] if query_file.exists() else []
    queued_query_count = sum(query not in research["queries"] for query in planned_queries)
    collected_search_pages = sum(run.get("source") == "Amazon.co.jp search page"
                                 for run in research.get("searchRuns", []))
    snapshot = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "researchFileUpdatedAt": datetime.fromtimestamp(PROGRESS.stat().st_mtime, timezone.utc).isoformat(),
        "predictionsUpdatedAt": datetime.fromtimestamp((ROOT / "predictions.js").stat().st_mtime, timezone.utc).isoformat(),
        "searchedOn": research["searchedOn"],
        "marketplace": research["marketplace"],
        "scope": "Amazon検索結果とKeepa商品データベースで発見した未確認ASINを含みます。単品・袋形状・現行寸法の確認済み件数ではなく、Amazon全体を網羅していません。",
        "accessLimitedSearchCount": len(research.get("accessLimitedSearches", {}).get("queries", [])),
        "queryCount": len(research["queries"]),
        "queuedQueryCount": queued_query_count,
        "collectedSearchPageCount": collected_search_pages,
        "finderRunCount": len(research.get("finderRuns", [])),
        "finderReturnedCount": sum(run.get("returnedAsins", 0) for run in research.get("finderRuns", [])),
        "finderNewCount": sum(run.get("newAsins", 0) for run in research.get("finderRuns", [])),
        "searchStopCount": sum(not stop.get("resolved") for stop in research.get("searchStops", [])),
        "discoveredCount": len(discovered),
        "pageCheckedCount": status_counts["page_fetched_not_added"] + status_counts["added"],
        "notFetchedCount": status_counts["not_fetched"],
        "pageCheckedNotAddedCount": status_counts["page_fetched_not_added"],
        "manualReviewPendingCount": review_pending_count,
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
