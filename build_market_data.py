#!/usr/bin/env python3
"""Publish checked market observations to browser JavaScript without credentials."""

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parent


def read(name):
    path = ROOT / name
    return json.loads(path.read_text()) if path.exists() else {"items": {}}


def main():
    catalog_text = (ROOT / "data.js").read_text()
    catalog = json.loads(catalog_text.split(" = ", 1)[1].strip().removesuffix(";"))
    current_asins = {product["asin"] for product in catalog}
    offer_source = read("offer_prices.json")
    fee_source = read("fee_estimates.json")
    reference_fee_source = read("reference_fee_estimates.json")
    supplier_source = read("supplier_verified.json")
    search_source = read("supplier_search_results.json")
    fallback_source = read("supplier_search_fallback.json")
    offers = {}
    for asin, row in offer_source.get("items", {}).items():
        if asin not in current_asins:
            continue
        offers[asin] = {key: row.get(key) for key in (
            "checkedAt", "status", "returnedOffers", "lowestMerchant",
            "lowestAmazonFulfilled", "featuredOffer")}
    fees = {}
    for asin, row in fee_source.get("items", {}).items():
        if asin not in current_asins:
            continue
        merchant = offers.get(asin, {}).get("lowestMerchant")
        if not merchant or row.get("listingYen") != merchant.get("listingYen") or row.get("shippingYen") != merchant.get("shippingYen"):
            continue
        fees[asin] = {key: row.get(key) for key in (
            "checkedAt", "status", "listingYen", "shippingYen", "totalFeeYen")}
    reference_fees = {}
    for asin, row in reference_fee_source.get("items", {}).items():
        if asin not in current_asins:
            continue
        offer = offers.get(asin, {})
        featured = offer.get("featuredOffer")
        reference = featured if featured and featured.get("fulfilledByAmazon") else offer.get("lowestAmazonFulfilled")
        if offer.get("lowestMerchant") or not reference:
            continue
        if row.get("listingYen") != reference.get("listingYen") or row.get("shippingYen") != reference.get("shippingYen"):
            continue
        reference_fees[asin] = {key: row.get(key) for key in (
            "checkedAt", "status", "priceBasis", "listingYen", "shippingYen", "totalFeeYen")}
    suppliers = {}
    for asin, row in supplier_source.get("items", {}).items():
        if asin not in current_asins:
            continue
        suppliers[asin] = [{
            "name": value["store"], "url": value["url"],
            "priceYen": value["priceYen"],
            "inboundShippingYen": value["inboundShippingYen"],
            "checkedOn": value["checkedAt"][:10],
            "identity": f"JAN {value['jan']} / {value['name']}",
            "note": "Yahoo!ショッピング商品ページの東京都向け単品表示。価格・在庫・送料は仕入時に再確認。",
        } for value in row.get("suppliers", [])]
    search_status = {}
    for asin in current_asins:
        row = search_source.get("items", {}).get(asin, {})
        search_status[asin] = {
            "status": row.get("status", "not_searched"),
            "primaryHits": row.get("hitCount", 0),
            "fallbackHits": fallback_source.get("items", {}).get(asin, {}).get("hitCount", 0),
            "checkedPages": supplier_source.get("items", {}).get(asin, {}).get("checkedPages", 0),
            "verified": bool(supplier_source.get("items", {}).get(asin, {}).get("suppliers")),
        }
    payload = {"checkedAt": offer_source.get("checkedAt"), "source": "Amazon SP-API Product Pricing / Product Fees and direct Yahoo Shopping pages",
               "offers": offers, "fees": fees, "referenceFees": reference_fees,
               "suppliers": suppliers, "supplierSearch": search_status}
    output = ROOT / "market_data.js"
    output.write_text("window.NEKOPOST_MARKET = " + json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + ";\n")
    print(f"market data: {len(offers)} offers, {len(fees)} fee estimates, {len(reference_fees)} reference fee scenarios, {sum(bool(v) for v in suppliers.values())} verified suppliers, {len(search_status)} searches")


if __name__ == "__main__":
    main()
