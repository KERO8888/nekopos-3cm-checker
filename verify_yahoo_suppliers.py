#!/usr/bin/env python3
"""Verify Yahoo supplier leads against EAN, single-unit form, price and shipping.

Records are Tokyo-address snapshots. Search hits and pages without matching EAN
are never promoted to a verified supplier.
"""

import argparse
import json
import re
import time
from datetime import datetime, timezone
from pathlib import Path

import requests
from bs4 import BeautifulSoup
from supplier_rules import is_multi_unit
from verify_rakuten_suppliers import sizes


ROOT = Path(__file__).resolve().parent
OUTPUT = ROOT / "supplier_verified.json"
HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; NekoposResearch/1.0)"}


def page_details(url):
    response = requests.get(url, headers=HEADERS, timeout=25)
    response.raise_for_status()
    soup = BeautifulSoup(response.text, "html.parser")
    text = soup.get_text(" ", strip=True)
    product = {}
    for script in soup.find_all("script", type="application/ld+json"):
        try:
            value = json.loads(script.get_text())
        except ValueError:
            continue
        if isinstance(value, dict) and value.get("@type") == "Product":
            product = value
            break
    name = product.get("name", "")
    raw_price = (product.get("offers") or {}).get("price")
    try:
        price = round(float(raw_price))
    except (ValueError, TypeError):
        price = None
    jan = re.search(r"JAN/ISBNコード\s*(\d{13})", text)
    price_text = text[text.find("価格"):text.find("価格") + 180] if "価格" in text else ""
    shipping_match = re.search(r"\+\s*送料\s*([\d,]+)\s*円", price_text)
    if shipping_match:
        shipping = int(shipping_match.group(1).replace(",", ""))
    elif re.search(r"^価格\s*[\d,]+\s*円\s*送料無料", price_text):
        shipping = 0
    else:
        shipping = None
    availability = (product.get("offers") or {}).get("availability", "")
    store = soup.title.get_text(" ", strip=True).split(" : ")[-1].split(" - 通販")[0] if soup.title else "Yahoo!ショッピング"
    displayed_points = re.search(r"獲得\s*[\d.]+\s*%\s*[（(]\s*([\d,]+)\s*pt", text)
    return {"name": name, "store": store, "url": url, "jan": jan.group(1) if jan else None,
            "priceYen": price, "inboundShippingYen": shipping, "availability": availability,
            "displayPoints": int(displayed_points.group(1).replace(",", "")) if displayed_points else None,
            "couponMentioned": "この商品のクーポン" in text or "商品限定クーポン" in text,
            "checkedAt": datetime.now(timezone.utc).isoformat()}


def save(items):
    payload = {"checkedAt": datetime.now(timezone.utc).isoformat(),
               "source": "Yahoo Shopping direct product pages, displayed Tokyo shipping",
               "scope": "Only pages with matching JAN and single-unit wording are verified; availability and prices can change.",
               "items": items}
    temp = OUTPUT.with_suffix(".json.tmp")
    temp.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")
    temp.replace(OUTPUT)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--fallback", action="store_true", help="Verify title-search leads not matched in the first pass")
    parser.add_argument("--discovery", action="store_true", help="Verify Yahoo leads from the title/JAN multisource search")
    parser.add_argument("--asin", action="append")
    parser.add_argument("--max-pages", type=int, default=12)
    args = parser.parse_args()
    source_name = "supplier_discovery.json" if args.discovery else "supplier_search_fallback.json" if args.fallback else "supplier_search_results.json"
    sources = json.loads((ROOT / source_name).read_text())["items"]
    identifier_path = ROOT / "product_identifiers.json"
    identifiers = json.loads(identifier_path.read_text())["items"] if identifier_path.exists() else {}
    learned_path = ROOT / "supplier_verified_rakuten.json"
    learned = json.loads(learned_path.read_text()).get("items", {}) if learned_path.exists() else {}
    items = json.loads(OUTPUT.read_text())["items"] if OUTPUT.exists() else {}
    total = sum(not args.asin or asin in args.asin for asin in sources)
    processed = 0
    for index, (asin, record) in enumerate(sources.items()):
        if args.asin and asin not in args.asin:
            continue
        if not args.discovery and asin in items and (not args.fallback or items[asin].get("suppliers")):
            continue
        searched_eans = [query.get("query") for query in record.get("queries", {}).values()
                         if re.fullmatch(r"\d{13}", query.get("query", ""))] if args.discovery else []
        eans = list(dict.fromkeys((identifiers.get(asin, {}).get("eanList") or [])
                                  + (learned.get(asin, {}).get("expectedEans") or []) + searched_eans))
        previous = items.get(asin, {}).get("suppliers", []) if args.discovery else []
        verified = list(previous)
        checked = []
        if args.discovery:
            leads = {hit["url"]: hit for query in record.get("queries", {}).values()
                     if query.get("market") == "yahoo" for hit in query.get("firstPageHits", [])}
            target_sizes = sizes(record.get("title", ""))
            leads = sorted(leads.values(), key=lambda row: (not bool(target_sizes & sizes(row["title"])), row["priceYen"]))
        else:
            leads = sorted(record.get("hits", []), key=lambda row: row["priceYen"])
        for lead in leads:
            if len(checked) >= (args.max_pages if args.discovery else 6) or (not args.discovery and len(verified) >= 2):
                break
            if not lead.get("url", "").startswith("https://store.shopping.yahoo.co.jp/"):
                continue
            if is_multi_unit(lead["title"]):
                continue
            if lead["url"] in checked:
                continue
            if any(value["url"] == lead["url"] for value in previous):
                continue
            checked.append(lead["url"])
            try:
                detail = page_details(lead["url"])
            except (requests.RequestException, ValueError, TypeError, AttributeError):
                continue
            if not eans or detail["jan"] not in eans or is_multi_unit(detail["name"]):
                continue
            if not detail["availability"].endswith("/InStock") or detail["priceYen"] is None:
                continue
            verified.append(detail)
            time.sleep(0.3)
        previous_pages = items.get(asin, {}).get("checkedPages", 0) if args.fallback or args.discovery else 0
        items[asin] = {"expectedEans": eans, "checkedPages": previous_pages + len(checked),
                       "status": "verified" if verified else "unverified",
                       "suppliers": sorted(verified, key=lambda x: x["priceYen"] + (x["inboundShippingYen"] if x["inboundShippingYen"] is not None else 9999))}
        save(items)
        processed += 1
        if (index + 1) % 10 == 0:
            print(f"Verified supplier items in this run: {processed}/{total}", flush=True)
        time.sleep(0.5)
    print(f"Verified supplier items in this run: {processed}/{total}", flush=True)


if __name__ == "__main__":
    main()
