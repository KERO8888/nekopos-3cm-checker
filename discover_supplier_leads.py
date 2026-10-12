#!/usr/bin/env python3
"""Find supplier leads on Rakuten and Yahoo without calling them verified stock.

Both JAN and title searches matter: marketplace search indexes often omit JANs.
Only the visible first result page is searched; product-page checks are separate.
"""

import argparse
import json
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode

import requests
from bs4 import BeautifulSoup

from supplier_rules import is_multi_unit


ROOT = Path(__file__).resolve().parent
OUTPUT = ROOT / "supplier_discovery.json"
HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; NekoposResearch/1.0)"}


def yen(text):
    match = re.search(r"([\d,]+)\s*円", text)
    return int(match.group(1).replace(",", "")) if match else None


def clean_title(title):
    title = re.sub(r"[【\[].*?[】\]]", " ", title)
    return re.sub(r"\s+", " ", title).strip()[:80]


def planned_queries(product, identifiers):
    title = clean_title(product["title"])
    eans = identifiers.get(product["asin"], {}).get("eanList") or []
    return [(market, query) for market in ("rakuten", "yahoo")
            for query in dict.fromkeys([title] + eans[:2]) if query]


def rakuten_hits(html):
    soup = BeautifulSoup(html, "html.parser")
    hits = []
    for card in soup.select("div.searchresultitem"):
        link = card.select_one('a[class*="title-link"][href^="https://item.rakuten.co.jp/"]')
        title = link.get_text(" ", strip=True) if link else ""
        if not link or not title or is_multi_unit(title):
            continue
        price = card.get("data-track-price")
        price = int(price) if price and price.isdigit() else None
        if price is None:
            continue
        text = card.get_text(" ", strip=True)
        price_wrapper = card.select_one('div[class*="price-wrapper"]')
        shipping_text = price_wrapper.get_text(" ", strip=True) if price_wrapper else ""
        shipping = re.search(r"\+送料\s*([\d,]+)\s*円", shipping_text)
        shipping_yen = int(shipping.group(1).replace(",", "")) if shipping else (0 if "送料無料" in shipping_text else None)
        points = re.search(r"([\d,]+)\s*ポイント", text)
        hits.append({
            "title": title, "url": link["href"].split("?")[0],
            "priceYen": price, "displayShippingYen": shipping_yen,
            "displayPoints": int(points.group(1).replace(",", "")) if points else None,
            "couponMentioned": "クーポン" in text,
            "source": "Rakuten search card; product/JAN/stock/shipping not verified",
        })
    return hits


def yahoo_hits(html):
    soup = BeautifulSoup(html, "html.parser")
    hits = []
    for card in soup.select('div[class*="SearchResult_SearchResultItem__mJ7vY"]'):
        link = next((a for a in card.select('a[href*="store.shopping.yahoo.co.jp/"]')
                     if a.get_text(" ", strip=True) and "/" in a.get("href", "")), None)
        price = card.select_one('p[class*="ItemPrice_PriceInfo__"]')
        if not link or not price:
            continue
        title = link.get_text(" ", strip=True)
        amount = yen(price.get_text(" ", strip=True))
        if amount is None or is_multi_unit(title):
            continue
        text = card.get_text(" ", strip=True)
        hits.append({
            "title": title, "url": link["href"].split("?")[0],
            "priceYen": amount, "displayShippingYen": None,
            "displayPoints": None, "couponMentioned": "クーポン" in text,
            "source": "Yahoo search card; product/JAN/stock/shipping not verified",
        })
    return hits


def search(market, query, session):
    if market == "rakuten":
        url = "https://search.rakuten.co.jp/search/mall/" + requests.utils.quote(query, safe="") + "/"
        parser = rakuten_hits
    else:
        url = "https://shopping.yahoo.co.jp/search?" + urlencode({"p": query})
        parser = yahoo_hits
    response = session.get(url, headers=HEADERS, timeout=25)
    response.raise_for_status()
    return {"url": url, "status": "searched", "firstPageHits": parser(response.text)}


def save(payload):
    payload["checkedAt"] = datetime.now(timezone.utc).isoformat()
    temp = OUTPUT.with_suffix(".json.tmp")
    temp.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")
    temp.replace(OUTPUT)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--asin", action="append", help="Research these ASINs only")
    parser.add_argument("--limit", type=int, default=0, help="Maximum products this run; 0 means all")
    parser.add_argument("--max-new", type=int, default=0, help="Process the next N products with unsaved queries")
    parser.add_argument("--refresh", action="store_true", help="Recheck saved queries")
    args = parser.parse_args()
    catalog = json.loads((ROOT / "data.js").read_text().split(" = ", 1)[1].strip().removesuffix(";"))
    identifier_path = ROOT / "product_identifiers.json"
    identifiers = json.loads(identifier_path.read_text())["items"] if identifier_path.exists() else {}
    learned_path = ROOT / "supplier_verified_rakuten.json"
    if learned_path.exists():
        for asin, row in json.loads(learned_path.read_text()).get("items", {}).items():
            if row.get("identifierSource") != "Keepa" and row.get("expectedEans"):
                current = identifiers.setdefault(asin, {"eanList": []})
                current["eanList"] = list(dict.fromkeys((current.get("eanList") or []) + row["expectedEans"]))
    payload = json.loads(OUTPUT.read_text()) if OUTPUT.exists() else {
        "scope": "First search-result pages only. Leads are not verified sources or profit inputs.", "items": {}}
    selected = [p for p in catalog if not args.asin or p["asin"] in args.asin]
    if args.max_new:
        selected = [p for p in selected if args.refresh or any(
            f"{market}:{query}" not in payload["items"].get(p["asin"], {}).get("queries", {})
            for market, query in planned_queries(p, identifiers))][:args.max_new]
    if args.limit:
        selected = selected[:args.limit]
    session = requests.Session()
    for product in selected:
        asin = product["asin"]
        queries = planned_queries(product, identifiers)
        item = payload["items"].setdefault(asin, {"title": product["title"], "queries": {}})
        for market, query in queries:
            key = f"{market}:{query}"
            if key in item["queries"] and not args.refresh:
                continue
            try:
                result = search(market, query, session)
            except (requests.RequestException, ValueError) as exc:
                result = {"status": "error", "error": type(exc).__name__, "firstPageHits": []}
            item["queries"][key] = {"market": market, "query": query,
                                    "checkedAt": datetime.now(timezone.utc).isoformat(), **result}
            save(payload)
            time.sleep(0.6)
        unique = {h["url"] for q in item["queries"].values() for h in q["firstPageHits"]}
        print(f"{asin}: {len(item['queries'])} queries, {len(unique)} unique unverified leads", flush=True)
    print(f"Researched {len(selected)} products. Results are leads only.")


if __name__ == "__main__":
    main()
