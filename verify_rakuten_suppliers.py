#!/usr/bin/env python3
"""Check Rakuten leads against the product page before publishing a supplier."""

import argparse
import json
import re
import time
import unicodedata
from datetime import datetime, timezone
from difflib import SequenceMatcher
from pathlib import Path

import requests
from bs4 import BeautifulSoup

from supplier_rules import is_multi_unit


ROOT = Path(__file__).resolve().parent
OUTPUT = ROOT / "supplier_verified_rakuten.json"
HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; NekoposResearch/1.0)"}


def text_norm(value):
    return re.sub(r"\s+", "", unicodedata.normalize("NFKC", value or "")).lower()


def sizes(value):
    normalized = text_norm(value).replace("キログラム", "kg").replace("グラム", "g")
    normalized = normalized.replace("ミリリットル", "ml").replace("リットル", "l")
    return set(re.findall(r"\d+(?:\.\d+)?(?:kg|g|ml|l)(?![a-z])", normalized))


def sizes_match(target, candidate):
    required = sizes(target)
    return not required or required.issubset(sizes(candidate))


def url_jan_conflicts(url, page_jan):
    match = re.search(r"/(\d{13})(?:/|$)", url)
    return bool(match and page_jan and match.group(1) != page_jan)


def page_details(url, session):
    response = session.get(url, headers=HEADERS, timeout=30)
    response.raise_for_status()
    soup = BeautifulSoup(response.text, "html.parser")
    def meta(prop):
        node = soup.select_one(f'[itemprop="{prop}"]')
        return (node.get("content") or node.get_text(" ", strip=True)) if node else None
    name = meta("name") or (soup.title.get_text(" ", strip=True) if soup.title else "")
    store_name = name.rsplit("｜", 1)[-1].strip() if "｜" in name else None
    if store_name:
        name = name.rsplit("｜", 1)[0].strip()
    jan = meta("gtin13")
    if not jan:
        match = re.search(r"JAN(?:コード)?\s*[:：]?\s*(\d{13})", soup.get_text(" ", strip=True))
        jan = match.group(1) if match else None
    price = meta("price")
    return {"name": name, "storeName": store_name, "jan": jan,
            "priceYen": round(float(price)) if price else None,
            "availability": meta("availability") or "",
            "checkedAt": datetime.now(timezone.utc).isoformat()}


def leads_for(item, expected_eans):
    all_leads = {}
    for query in item.get("queries", {}).values():
        if query.get("market") != "rakuten":
            continue
        for lead in query.get("firstPageHits", []):
            if not lead.get("url", "").startswith("https://item.rakuten.co.jp/"):
                continue
            if is_multi_unit(lead["title"]):
                continue
            all_leads[lead["url"]] = lead
    filtered = [lead for lead in all_leads.values() if sizes_match(item.get("title", ""), lead["title"])]
    def rank(lead):
        exact_url = any(ean in lead["url"] for ean in expected_eans)
        similarity = SequenceMatcher(None, text_norm(item["title"])[:100], text_norm(lead["title"])[:100]).ratio()
        return (-int(exact_url), -similarity, lead["priceYen"])
    return sorted(filtered, key=rank)


def save(payload):
    payload["checkedAt"] = datetime.now(timezone.utc).isoformat()
    temp = OUTPUT.with_suffix(".json.tmp")
    temp.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")
    temp.replace(OUTPUT)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--asin", action="append")
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--max-pages", type=int, default=8, help="Maximum product pages per ASIN")
    parser.add_argument("--refresh", action="store_true")
    args = parser.parse_args()
    discovery = json.loads((ROOT / "supplier_discovery.json").read_text())["items"]
    identifier_path = ROOT / "product_identifiers.json"
    identifiers = json.loads(identifier_path.read_text())["items"] if identifier_path.exists() else {}
    payload = json.loads(OUTPUT.read_text()) if OUTPUT.exists() else {
        "scope": "JAN, unit, price and stock checked on direct pages. Shipping is Tokyo search-card display; points/coupons are excluded from profit.", "items": {}}
    selected = [(asin, item) for asin, item in discovery.items() if not args.asin or asin in args.asin]
    if args.limit:
        selected = selected[:args.limit]
    session = requests.Session()
    for asin, item in selected:
        if asin in payload["items"] and not args.refresh:
            continue
        expected = identifiers.get(asin, {}).get("eanList") or []
        verified = []
        candidate_pages = []
        checked = 0
        rejected = {}
        for lead in leads_for(item, expected)[:args.max_pages]:
            checked += 1
            try:
                detail = page_details(lead["url"], session)
            except (requests.RequestException, ValueError, TypeError, AttributeError) as exc:
                rejected[type(exc).__name__] = rejected.get(type(exc).__name__, 0) + 1
                continue
            reason = None
            if is_multi_unit(detail["name"]):
                reason = "multi_unit"
            elif not detail["jan"] or not re.fullmatch(r"\d{13}", detail["jan"]):
                reason = "jan_missing"
            elif expected and detail["jan"] not in expected:
                reason = "jan_mismatch"
            elif url_jan_conflicts(lead["url"], detail["jan"]):
                reason = "url_jan_conflict"
            elif not detail["availability"].endswith("/InStock"):
                reason = "stock_unconfirmed"
            elif detail["priceYen"] != lead["priceYen"]:
                reason = "price_changed"
            elif lead["displayShippingYen"] is None:
                reason = "shipping_unconfirmed"
            elif not sizes_match(item["title"], detail["name"]):
                reason = "size_mismatch"
            if reason:
                rejected[reason] = rejected.get(reason, 0) + 1
            else:
                candidate_pages.append({**detail, "url": lead["url"],
                                        "store": detail.get("storeName") or lead["url"].split("/")[3],
                                        "inboundShippingYen": lead["displayShippingYen"],
                                        "displayPoints": lead.get("displayPoints"),
                                        "couponMentioned": lead.get("couponMentioned", False),
                                        "shippingSource": "Rakuten search card for Tokyo"})
            time.sleep(0.3)
        identifier_source = "Keepa" if expected else "unconfirmed"
        if not expected:
            by_jan = {}
            for candidate in candidate_pages:
                similarity = SequenceMatcher(None, text_norm(item["title"])[:100], text_norm(candidate["name"].split("｜")[0])[:100]).ratio()
                if similarity >= 0.55:
                    by_jan.setdefault(candidate["jan"], set()).add(candidate["store"])
            corroborated = [jan for jan, stores in by_jan.items() if len(stores) >= 2]
            if len(corroborated) == 1:
                expected = corroborated
                identifier_source = "Two independent Rakuten product pages, matching title and size"
        verified = [candidate for candidate in candidate_pages if candidate["jan"] in expected]
        rejected["identifier_unconfirmed"] = len(candidate_pages) - len(verified)
        previous = payload["items"].get(asin, {})
        payload["items"][asin] = {"expectedEans": expected, "checkedPages": checked,
                                  "cumulativeCheckedPages": previous.get("cumulativeCheckedPages", previous.get("checkedPages", 0)) + checked,
                                  "identifierSource": identifier_source,
                                  "eligibleLeads": len(leads_for(item, expected)),
                                  "rejected": rejected,
                                  "suppliers": sorted(verified, key=lambda h: h["priceYen"] + h["inboundShippingYen"])}
        save(payload)
        print(f"{asin}: {checked} pages, {len(verified)} verified", flush=True)


if __name__ == "__main__":
    main()
