#!/usr/bin/env python3
"""Build the small file://-compatible research snapshot used by acquisition.html."""

import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parent
PROGRESS = ROOT / "research_progress.json"
OUTPUT = ROOT / "acquisition_status.js"
CATALOG_OUTPUT = ROOT / "discovered_asins.js"


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
    reviews = json.loads(review_file.read_text()).get("reviews", []) if review_file.exists() else []
    review_pending_count = sum(item.get("reviewStatus") == "needs_manual_shape_and_unit_check"
                               for item in reviews)
    review_titles = {item["asin"]: item["title"] for item in reviews if item.get("title")}
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
    query_counts = Counter()
    query_checked = Counter()
    query_added = Counter()
    for item in discovered:
        for query in item["queries"]:
            query_counts[query] += 1
            if item["status"] != "not_fetched":
                query_checked[query] += 1
            if item["status"] == "added":
                query_added[query] += 1
    queries = [{"query": query, "discovered": query_counts[query],
                "pageChecked": query_checked[query], "added": query_added[query]}
               for query in research["queries"]]
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
        "scope": "Amazon検索結果とKeepa商品データベースで発見した未確認ASINを含みます。商品名を取得しただけでも単品・形状・現行寸法は未確認です。Amazon全体は網羅していません。",
        "accessLimitedSearchCount": len(research.get("accessLimitedSearches", {}).get("queries", [])),
        "queryCount": len(research["queries"]),
        "queuedQueryCount": queued_query_count,
        "collectedSearchPageCount": collected_search_pages,
        "finderRunCount": len(research.get("finderRuns", [])),
        "finderReturnedCount": sum(run.get("returnedAsins", 0) for run in research.get("finderRuns", [])),
        "finderNewCount": sum(run.get("newAsins", 0) for run in research.get("finderRuns", [])),
        "finderRuns": [{"selection": run.get("selection", {}),
                         "returnedAsins": run.get("returnedAsins", 0),
                         "newAsins": run.get("newAsins", 0),
                         "totalResultsEstimate": run.get("totalResultsEstimate")}
                        for run in research.get("finderRuns", [])],
        "metadataCheckedCount": sum(bool(item.get("keepaMetadataCheckedAt")) for item in discovered),
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
    # Keep discovery records separate from the screened product catalog. Query
    # strings are interned so the full list remains practical on a static site.
    query_ids = {query: index for index, query in enumerate(query_counts)}
    catalog = {
        "queries": list(query_ids),
        "rows": [[item["asin"], {"not_fetched": 0, "page_fetched_not_added": 1, "added": 2}[item["status"]],
                  [query_ids[query] for query in item["queries"] if query in query_ids],
                  products.get(item["asin"], {}).get("title")
                  or review_titles.get(item["asin"])
                  or item.get("keepaTitle") or ""] for item in discovered],
    }
    catalog["rows"].sort(key=lambda row: not bool(row[3]))
    CATALOG_OUTPUT.write_text("window.NEKOPOST_DISCOVERED_ASINS = " + json.dumps(catalog, ensure_ascii=False, separators=(",", ":")) + ";\n")
    print(f"Saved {OUTPUT.name}: {snapshot['queryCount']} searches, {snapshot['discoveredCount']} found, {snapshot['pageCheckedCount']} checked, {snapshot['addedCount']} added")
    print(f"Saved {CATALOG_OUTPUT.name}: {len(catalog['rows'])} ASINs")


if __name__ == "__main__":
    build()
