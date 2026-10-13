#!/usr/bin/env python3
"""Prioritize unverified Finder ASINs using batch Keepa metadata.

Scores order manual review only. They never reject an ASIN, establish that a
product is flexible, or establish its packed shipping dimensions.
"""

import argparse
import json
import re
from datetime import datetime
from zoneinfo import ZoneInfo

import requests

from discover_keepa_finder import PROGRESS, keepa_key, save


POSITIVE = (
    (r"パウチ|スタンドパック|ソフトパック|アルミ袋|レトルト", 5, "柔らかい袋を示す語"),
    (r"詰め替え|つめかえ|詰替|レフィル|リフィル", 4, "詰め替えを示す語"),
    (r"フラットファイル|クリアファイル|ポケットファイル|封筒|ラベルシール|シート|ハンカチ|タオル|靴下", 3, "薄く並べられる可能性のある品目"),
    (r"1袋|1個|単品|\(x 1\)", 1, "単品を示す語"),
)
NEGATIVE = (
    (r"ペット|犬用|猫用|ドッグ|キャット|観賞魚|肥料|培養土|園芸", -12, "対象外用途の可能性"),
    (r"空ボトル|詰替ボトル|ディスペンサー|専用容器|ポンプ|カートリッジ|プラスチックケース|瓶|缶", -7, "硬い容器の可能性"),
    (r"本体\s*[+＋＆&]\s*詰|本体.{0,12}詰め替え|詰め替え.{0,12}本体|専用ケース付|容器付|計量スプーン付", -12, "硬い本体・付属品を含む可能性"),
    (r"(?:専用ボトル|専用空容器).{0,20}(?:詰め替え|パウチ)|(?:詰め替え|パウチ).{0,20}(?:専用ボトル|専用空容器)", -16, "詰め替え袋と硬い容器のセットの可能性"),
    (r"セット|まとめ買い|\d+個組|\d+足組|\d+個セット|\d+袋セット|[×xX]\s*[2-9]\d*|[2-9]\d*\s*(?:袋|本|個|食)", -6, "複数単位の可能性"),
    (r"[2-9]\d*\s*枚|[2-9]\d*\s*色組|[2-9]\d*\s*P\b|アソート", -6, "複数枚・詰め合わせの可能性"),
    (r"リングファイル|リングバインダー|パイプ式ファイル|レバー式ファイル|バインダー|クリップボード|ファイルボックス|ドキュメントボックス|ドキュメントスタンド|ジャバラ", -6, "厚い留め具・硬い部材の可能性"),
    (r"タオルハンガー|タオル掛け|ハンガーバー|マグネット収納|ノズル付き|キャップ付き", -7, "硬い部材・注ぎ口の可能性"),
    (r"\d+ポケット|拡張式|スナップ式", -3, "複数仕切りや硬い留め具の可能性"),
    (r"両面テープ|マスキングテープ|セロハンテープ|ガムテープ|養生テープ", -4, "巻き芯やロールの厚みが残る可能性"),
)


def score_product(product):
    title = product.get("title") or ""
    score = 0
    tags = []
    for pattern, points, tag in POSITIVE + NEGATIVE:
        if re.search(pattern, title, re.I):
            score += points
            tags.append(tag)
    package_mm = [product.get(f"package{axis}") for axis in ("Height", "Width", "Length")]
    if all(isinstance(value, (int, float)) and value > 0 for value in package_mm):
        if min(package_mm) > 30:
            score += 2
            tags.append("Keepa掲載の最小辺が3cm超")
        elif min(package_mm) <= 30:
            tags.append("Keepa掲載の最小辺が3cm以下")
    if product.get("numberOfItems") == 1:
        score += 1
        tags.append("Keepaの商品入り数1")
    if isinstance(product.get("packageWeight"), (int, float)) and product["packageWeight"] > 1000:
        score -= 3
        tags.append("掲載重量1kg超")
    return score, tags


def batches(items, size):
    for offset in range(0, len(items), size):
        yield items[offset:offset + size]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-contains", help="発見経路の一部。例: category=1153734051")
    parser.add_argument("--limit", type=int, default=20, help="この実行で商品情報を取得するASIN数")
    parser.add_argument("--rescore-cached", action="store_true", help="取得済みの商品名・寸法だけで確認順を再計算する。APIは使わない")
    args = parser.parse_args()
    if args.rescore_cached:
        progress = json.loads(PROGRESS.read_text())
        updated = 0
        for row in progress["discovered"]:
            if not row.get("keepaMetadataCheckedAt"):
                continue
            dimensions = row.get("keepaPackageMm") or []
            product = {
                "title": row.get("keepaTitle") or "",
                "packageWeight": row.get("keepaPackageWeightG"),
                "numberOfItems": row.get("keepaNumberOfItems"),
            }
            for axis, value in zip(("Height", "Width", "Length"), dimensions):
                product[f"package{axis}"] = value
            score, tags = score_product(product)
            if row.get("triageScore") != score or row.get("triageTags") != tags:
                row["triageScore"], row["triageTags"] = score, tags
                updated += 1
        if updated:
            save(progress)
        print(f"取得済み商品情報の確認順を再計算: {updated}件更新")
        return 0
    if not args.source_contains:
        parser.error("source-contains を指定してください")
    if not 1 <= args.limit <= 300:
        parser.error("limit は1〜300")
    key = keepa_key()
    if not key:
        raise RuntimeError("Keepa API key unavailable")
    progress = json.loads(PROGRESS.read_text())
    selected = [row for row in progress["discovered"]
                if row["status"] == "not_fetched" and not row.get("keepaMetadataCheckedAt")
                and any(args.source_contains in source for source in row.get("discoverySources", []))][:args.limit]
    if not selected:
        print("対象の未確認ASINはありません")
        return 0
    by_asin = {row["asin"]: row for row in selected}
    checked = 0
    with requests.Session() as session:
        for group in batches(selected, 20):
            try:
                response = session.get("https://api.keepa.com/product", params={
                    "key": key, "domain": 5, "asin": ",".join(row["asin"] for row in group),
                    "history": 0, "update": -1,
                }, timeout=60)
            except requests.RequestException as exc:
                print(f"Keepa取得停止: {type(exc).__name__}")
                break
            if response.status_code != 200:
                print(f"Keepa取得停止: HTTP {response.status_code}")
                break
            try:
                payload = response.json()
            except requests.exceptions.JSONDecodeError:
                print("Keepa取得停止: JSONを読み取れません")
                break
            if payload.get("error") or not isinstance(payload.get("products"), list):
                print("Keepa取得停止: 商品応答が不正")
                break
            products = {item.get("asin"): item for item in payload["products"]}
            now = datetime.now(ZoneInfo("Asia/Tokyo")).isoformat()
            for requested in group:
                asin = requested["asin"]
                product = products.get(asin, {})
                score, tags = score_product(product)
                row = by_asin[asin]
                row["keepaMetadataCheckedAt"] = now
                row["keepaTitle"] = product.get("title") or ""
                row["triageScore"] = score
                row["triageTags"] = tags
                row["keepaPackageMm"] = [product.get(f"package{axis}") for axis in ("Height", "Width", "Length")]
                row["keepaPackageWeightG"] = product.get("packageWeight")
                row["keepaNumberOfItems"] = product.get("numberOfItems")
                checked += 1
            save(progress)
            print(f"Keepa商品情報 {checked}/{len(selected)}、残トークン {payload.get('tokensLeft')}", flush=True)
    ranked = sorted(selected[:checked], key=lambda row: row["triageScore"], reverse=True)
    for row in ranked[:15]:
        print(f"{row['asin']} score={row['triageScore']:+d} {row['keepaTitle'][:85]}")
    return 0 if checked == len(selected) else 1


if __name__ == "__main__":
    raise SystemExit(main())
