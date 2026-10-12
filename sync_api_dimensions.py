#!/usr/bin/env python3
"""Fetch JP catalog item/package dimensions without exposing API credentials to the UI.

Credentials may be set as environment variables or read from --env-file. The generated
api_dimensions.js contains only public catalog measurements, never API keys/tokens.
"""

import argparse
import getpass
import gzip
import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parent
OUTPUT = ROOT / "api_dimensions.js"
MARKETPLACE = "A1VC38T7YXB528"
ASINS = sorted(set(re.findall(r"\bB[0-9A-Z]{9}\b", (ROOT / "data.js").read_text())))
KEYCHAIN_BUNDLE_HELPER = Path(os.environ.get(
    "SP_API_FEES_KEYCHAIN_HELPER",
    "/Users/ni/Documents/Codex/2026-10-02/ama/outputs/sp-api-fees/keychain-bundle",
))


def keychain_secret(service):
    if sys.platform != "darwin":
        return ""
    try:
        result = subprocess.run(
            ["security", "find-generic-password", "-w", "-a", getpass.getuser(), "-s", service],
            capture_output=True, text=True, timeout=10, check=False,
        )
        return result.stdout.strip() if result.returncode == 0 else ""
    except (OSError, subprocess.SubprocessError):
        return ""


def load_existing_keychain():
    """Reuse the credential entries already configured by the Kojima research tool."""
    if KEYCHAIN_BUNDLE_HELPER.exists():
        try:
            result = subprocess.run(
                [str(KEYCHAIN_BUNDLE_HELPER), "read", "sp-api-fees-credentials"],
                capture_output=True, text=True, timeout=10, check=False,
            )
            bundle = json.loads(result.stdout) if result.returncode == 0 else {}
            if isinstance(bundle, dict):
                for target, source in (("SP_API_CLIENT_ID", "client_id"),
                                       ("SP_API_CLIENT_SECRET", "client_secret"),
                                       ("SP_API_REFRESH_TOKEN", "refresh_token")):
                    if bundle.get(source):
                        os.environ.setdefault(target, bundle[source])
        except (OSError, subprocess.SubprocessError, json.JSONDecodeError):
            pass
    services = {
        "KEEPA_API_KEY": "kojima-profit-keepa-api",
        "SP_API_CLIENT_ID": "sp-api-fees-lwa-client-id",
        "SP_API_CLIENT_SECRET": "sp-api-fees-lwa-client-secret",
        "SP_API_REFRESH_TOKEN": "sp-api-fees-refresh-token",
    }
    for name, service in services.items():
        if not os.environ.get(name):
            value = keychain_secret(service)
            if value:
                os.environ[name] = value


def read_env_file(path):
    if not path:
        return
    for line in Path(path).read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        if key.strip() in {"KEEPA_API_KEY", "SP_API_CLIENT_ID", "SP_API_CLIENT_SECRET", "SP_API_REFRESH_TOKEN"}:
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def request_json(url, *, form=None, headers=None):
    body = urlencode(form).encode() if form else None
    req = Request(url, data=body, headers=headers or {})
    try:
        with urlopen(req, timeout=35) as response:
            raw = response.read()
            if response.headers.get("Content-Encoding", "").lower() == "gzip":
                raw = gzip.decompress(raw)
            return json.loads(raw)
    except HTTPError as exc:
        # URLs and response bodies may contain secrets, so never include them in errors.
        raise RuntimeError(f"API HTTP {exc.code}") from None
    except URLError:
        raise RuntimeError("APIに接続できませんでした") from None


def cm_dimension(value):
    if not isinstance(value, dict):
        return None
    try:
        number = float(value["value"])
    except (ValueError, TypeError, KeyError):
        return None
    factors = {"centimeters": 1, "centimetres": 1, "cm": 1,
               "millimeters": .1, "millimetres": .1, "mm": .1,
               "meters": 100, "metres": 100, "m": 100,
               "inches": 2.54, "inch": 2.54, "feet": 30.48, "ft": 30.48}
    factor = factors.get(str(value.get("unit", "")).lower())
    return round(number * factor, 2) if factor and number > 0 else None


def sp_triplet(value):
    if not isinstance(value, dict):
        return None
    dims = [cm_dimension(value.get(axis)) for axis in ("length", "width", "height")]
    return {"cm": dims} if all(dim is not None for dim in dims) else None


def keepa_triplet(value, kind):
    dims = [value.get(f"{kind}{axis}") for axis in ("Length", "Width", "Height")]
    if not all(isinstance(dim, (int, float)) and dim > 0 for dim in dims):
        return None
    return {"cm": [round(dim / 10, 2) for dim in dims]}


def sp_access_token():
    data = request_json("https://api.amazon.com/auth/o2/token", form={
        "grant_type": "refresh_token",
        "refresh_token": os.environ["SP_API_REFRESH_TOKEN"],
        "client_id": os.environ["SP_API_CLIENT_ID"],
        "client_secret": os.environ["SP_API_CLIENT_SECRET"],
    }, headers={"Content-Type": "application/x-www-form-urlencoded"})
    if not data.get("access_token"):
        raise RuntimeError("SP-APIのアクセストークンを取得できませんでした")
    return data["access_token"]


def chunks(values, size):
    for start in range(0, len(values), size):
        yield values[start:start + size]


def fetch_sp(asins, result):
    token = sp_access_token()
    headers = {"x-amz-access-token": token,
               "x-amz-date": datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ"),
               "User-Agent": "NekoposResearch/1.0 (Language=Python)",
               "Accept": "application/json"}
    count = 0
    for group in chunks(asins, 20):
        query = urlencode({"identifiers": ",".join(group), "identifiersType": "ASIN",
                           "marketplaceIds": MARKETPLACE, "includedData": "dimensions", "pageSize": 20})
        data = request_json(f"https://sellingpartnerapi-fe.amazon.com/catalog/2022-04-01/items?{query}", headers=headers)
        for product in data.get("items", []):
            asin = product.get("asin")
            if asin not in group:
                continue
            marketplace_dims = next((entry for entry in product.get("dimensions", [])
                                     if entry.get("marketplaceId") == MARKETPLACE), {})
            result.setdefault(asin, {})["spApi"] = {
                "item": sp_triplet(marketplace_dims.get("item")),
                "package": sp_triplet(marketplace_dims.get("package")),
            }
            count += 1
        time.sleep(.55)  # Default searchCatalogItems limit is 2 requests/second.
    return count


def fetch_keepa(asins, result):
    count = 0
    for group in chunks(asins, 10):
        query = urlencode({"key": os.environ["KEEPA_API_KEY"], "domain": 5,
                           "asin": ",".join(group)})
        data = request_json(f"https://api.keepa.com/product?{query}",
                            headers={"Accept-Encoding": "gzip"})
        if data.get("error"):
            raise RuntimeError("Keepa APIからエラーが返されました（残トークン・契約を確認）")
        for product in data.get("products", []):
            asin = product.get("asin")
            if asin not in group:
                continue
            result.setdefault(asin, {})["keepa"] = {
                "item": keepa_triplet(product, "item"),
                "package": keepa_triplet(product, "package"),
            }
            count += 1
    return count


def existing_items():
    if not OUTPUT.exists():
        return {}
    raw = OUTPUT.read_text().strip()
    prefix = "window.NEKOPOST_API_DIMENSIONS = "
    if not raw.startswith(prefix):
        return {}
    try:
        return json.loads(raw[len(prefix):].rstrip(";"))["items"]
    except (ValueError, KeyError, TypeError):
        return {}


def existing_source_status():
    if not OUTPUT.exists():
        return {}
    raw = OUTPUT.read_text().strip()
    prefix = "window.NEKOPOST_API_DIMENSIONS = "
    try:
        status = json.loads(raw[len(prefix):].rstrip(";")).get("sourceStatus", {}) if raw.startswith(prefix) else {}
        return status if isinstance(status, dict) else {}
    except (ValueError, TypeError):
        return {}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", help="API認証情報を含むローカルファイル（画面には出力しません）")
    choice = parser.add_mutually_exclusive_group()
    choice.add_argument("--sp-only", action="store_true", help="SP-APIだけ再取得し、Keepaの保存値を維持")
    choice.add_argument("--keepa-only", action="store_true", help="Keepa APIだけ再取得し、SP-APIの保存値を維持")
    args = parser.parse_args()
    read_env_file(args.env_file)
    load_existing_keychain()
    required = (("SP_API_CLIENT_ID", "SP_API_CLIENT_SECRET", "SP_API_REFRESH_TOKEN") if args.sp_only else
                ("KEEPA_API_KEY",) if args.keepa_only else
                ("KEEPA_API_KEY", "SP_API_CLIENT_ID", "SP_API_CLIENT_SECRET", "SP_API_REFRESH_TOKEN"))
    missing = [name for name in required if not os.environ.get(name)]
    if missing:
        print("API認証情報が未設定: " + ", ".join(missing), file=sys.stderr)
        return 2
    if not ASINS:
        print("ASINが登録されていません", file=sys.stderr)
        return 2
    items = existing_items()
    source_status = existing_source_status()
    errors = []
    sp_count = keepa_count = 0
    if not args.keepa_only:
        try:
            sp_count = fetch_sp([asin for asin in ASINS if not items.get(asin, {}).get("spApi")], items)
            source_status["spApi"] = {"status": "available", "checkedAt": datetime.now(timezone.utc).isoformat()}
        except RuntimeError as exc:
            errors.append(f"SP-API: {exc}（手数料APIとは別にCatalog ItemsのProduct Listing権限・認可を確認）")
            source_status["spApi"] = {"status": "http_403" if "HTTP 403" in str(exc) else "error", "checkedAt": datetime.now(timezone.utc).isoformat()}
    if not args.sp_only:
        try:
            keepa_count = fetch_keepa([asin for asin in ASINS if not items.get(asin, {}).get("keepa")], items)
            source_status["keepa"] = {"status": "available", "checkedAt": datetime.now(timezone.utc).isoformat()}
        except RuntimeError as exc:
            errors.append(f"Keepa API: {exc}")
            source_status["keepa"] = {"status": "error", "checkedAt": datetime.now(timezone.utc).isoformat()}
    if "keepa" not in source_status and all(items.get(asin, {}).get("keepa") for asin in ASINS):
        source_status["keepa"] = {"status": "available", "checkedAt": datetime.now(timezone.utc).isoformat()}
    payload = {"updatedAt": datetime.now(timezone.utc).isoformat(), "sourceStatus": source_status, "items": items}
    content = "window.NEKOPOST_API_DIMENSIONS = " + json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + ";\n"
    temp = OUTPUT.with_suffix(".js.tmp")
    temp.write_text(content)
    temp.replace(OUTPUT)
    print(f"今回取得: SP-API {sp_count}件、Keepa API {keepa_count}件。対象 {len(ASINS)}件。")
    for error in errors:
        print(error, file=sys.stderr)
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
