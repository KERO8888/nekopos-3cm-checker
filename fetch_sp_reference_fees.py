#!/usr/bin/env python3
"""Estimate MFN fees at an FBA Featured Offer price when no MFN offer exists.

This is a price scenario, not an observed merchant offer or a sale prediction.
Credentials are read by sync_api_dimensions from the local Keychain.
"""

import json
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError

import fetch_sp_fees
import sync_api_dimensions as api


ROOT = Path(__file__).resolve().parent
OUTPUT = ROOT / "reference_fee_estimates.json"


def main():
    offers = json.loads((ROOT / "offer_prices.json").read_text())["items"]
    existing = json.loads(OUTPUT.read_text()).get("items", {}) if OUTPUT.exists() else {}
    pending = [(asin, row.get("featuredOffer") if (row.get("featuredOffer") or {}).get("fulfilledByAmazon") else row.get("lowestAmazonFulfilled")) for asin, row in offers.items()
               if not row.get("lowestMerchant") and ((row.get("featuredOffer") or {}).get("fulfilledByAmazon") or row.get("lowestAmazonFulfilled")) and (
                   asin not in existing
                   or existing[asin].get("listingYen") != (row.get("featuredOffer") if (row.get("featuredOffer") or {}).get("fulfilledByAmazon") else row.get("lowestAmazonFulfilled"))["listingYen"]
                   or existing[asin].get("shippingYen") != (row.get("featuredOffer") if (row.get("featuredOffer") or {}).get("fulfilledByAmazon") else row.get("lowestAmazonFulfilled"))["shippingYen"]
                   or existing[asin].get("status") != "Success")]
    if not pending:
        print(f"Reference MFN fee scenarios: {len(existing)}; nothing pending")
        return
    api.load_existing_keychain()
    token = api.sp_access_token()
    for index, group in enumerate(api.chunks(pending, 20)):
        if index:
            time.sleep(2.2)
        for attempt in range(3):
            try:
                results = fetch_sp_fees.request_batch(group, token)
                break
            except HTTPError as exc:
                if exc.code == 429 and attempt < 2:
                    time.sleep(3 * (attempt + 1))
                    continue
                raise RuntimeError(f"SP-API reference fee HTTP {exc.code}") from None
        source = dict(group)
        for result in results:
            asin = result.get("FeesEstimateIdentifier", {}).get("IdValue")
            if asin not in source:
                continue
            estimate = result.get("FeesEstimate", {})
            total = estimate.get("TotalFeesEstimate", {}).get("Amount")
            existing[asin] = {
                "checkedAt": datetime.now(timezone.utc).isoformat(),
                "status": result.get("Status"),
                "priceBasis": "FBA Featured Offer; hypothetical MFN listing at the same customer price" if (offers[asin].get("featuredOffer") or {}).get("fulfilledByAmazon") else "Lowest returned FBA offer; hypothetical MFN listing at the same customer price",
                "listingYen": source[asin]["listingYen"],
                "shippingYen": source[asin]["shippingYen"],
                "totalFeeYen": round(float(total)) if isinstance(total, (int, float)) else None,
                "errorCode": (result.get("Error") or {}).get("Code"),
            }
        payload = {"checkedAt": datetime.now(timezone.utc).isoformat(),
                   "source": "SP-API Product Fees MFN scenario at FBA Featured Offer price",
                   "scope": "Not an observed MFN offer or guaranteed obtainable selling price.",
                   "items": existing}
        temp = OUTPUT.with_suffix(".json.tmp")
        temp.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")
        temp.replace(OUTPUT)
        print(f"Reference MFN fee scenarios: {len(existing)}/{len(pending)}", flush=True)


if __name__ == "__main__":
    main()
