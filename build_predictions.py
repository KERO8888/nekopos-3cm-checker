"""Create transparent, conservative 3 cm estimates for the 100 candidate ASINs.

This is a screening model, not a measured thickness.  Inputs and exceptions are
kept here so the assumptions can be audited and revised.
"""

import json
import math
import re
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).parent
products = json.loads((ROOT / 'data.js').read_text().removeprefix('window.NEKOPOST_PRODUCTS = ').removesuffix(';\n'))

SOURCES = {
    'fish_density': 'https://eprints.lmu.edu.ng/3377/',
    'sinking_density': 'https://pure.ug.edu.gh/en/publications/effects-of-oilseed-meals-on-pellet-characteristics-faecal-matter-/',
    'dog_density': 'https://www.frontiersin.org/journals/animal-science/articles/10.3389/fanim.2025.1571097/full',
    'instant_density': 'https://agris.fao.org/search/ar/records/65df40d10f3e94b9e5d695ac',
    'bean_density': 'https://journals.itb.ac.id/index.php/jets/article/download/18279/6114',
    'salt_density': 'https://www.univarsolutions.com/mag-sulfate-epsom-salt-usp-kshr-501784',
    'magnesium_chloride_density': 'https://www.praannaturals.com/downloads/specsheets/SPEC_Magnesium_Chloride_Flakes_OTHMAGNFLKTB930.pdf',
    'peat_density': 'https://www.mdpi.com/2071-1050/13/11/6354',
    'gex_200': 'https://product.gex-fp.co.jp/fish/?cid=373&id=1749&m=ProductListDetail',
    'gex_care': 'https://product.gex-fp.co.jp/fish/?cid=373&id=2628&m=ProductListDetail',
    'agf_80': 'https://agf.ajinomoto.co.jp/product/detail/59595',
    'kikiyu': 'https://www.earth.jp/products/kikiyu-fineheat-kae-deep-refresh/index.html',
    'coffee_bag': 'https://www.kalita.co.jp/products/electricmill/2152',
}

FISH_SINKING = set('B07BBMLGVJ B01GTF98OS B00KPASQ3S B0CVKL9BVN B0H9PFGNS3 B003YKUI32 B078YW4HYG B01FJ2IYN8 B01FEUZPUK B01FEULQK8'.split())
FISH_FLOATING = set('B005H7H1JE B06XYGJCHS B086T7WH8Q B004WI1VAE B06XC6NL22 B08W1P5WG7 B01GTF9EME B0H99J2F9T B0FK9XZKH1'.split())
SMALL_ANIMAL = set('B06XBXLPQ1 B06XCCFDCG B006MIWJT4 B005748T16 B07K57K361'.split())
DOG_CAT = set('B003VIIAFK B079L4T8BS B07RTLRY22 B079L56FM7 B00ADX5DGA B0GHWC8Z78 B0GHX45K1B B0GHXF9WHG B06VT8GPRW'.split())
INSTANT = set('B07NLBWGTJ B0983G1QTC B08VT9LBLW B0DVSBJMXM B0D9VBNTKL B0DWD4994X B0DWCX87GS B0DWD6ZBM7 B0DVPN4BS3 B0FMDXP9M7 B0DVSDCYCB B09S3MFR1K B0DWCSLNBY B0F99DFCHJ B0B6BGV9R1'.split())
BEANS = set('B07CNRNKT5 B07CPSSL44 B0G3PJK8K5'.split())
GROUND = set('B0GTQCZ9V3 B00I59U9G8'.split())
KIKIYU = set('B0HB4CZY87 B0HB4FNC4B B08GC3ZF2M B08GCBL7BD B0DQDTBXJ7 B0DCBVNGNB B09DXRGTS8 B093DGHBXC B08Y8C5YDY B08GBYFFDQ'.split())
SUPPLEMENTS = set('B0CGWZ5J6H B007BJAY6I B08YFP2BVH B0CW8GQS1G B07GSDJ6T2'.split())

DENSITIES = {
    '沈下性の魚用粒': (0.37, 0.65, 'sinking_density'),
    '浮上性の魚用粒': (0.27, 0.40, 'fish_density'),
    '魚用粒（浮沈不明）': (0.30, 0.55, 'fish_density'),
    '小動物用の粒・穀類': (0.35, 0.60, 'dog_density'),
    '犬猫用ドライフード': (0.35, 0.50, 'dog_density'),
    'インスタントコーヒー': (0.25, 0.40, 'instant_density'),
    '焙煎コーヒー豆': (0.28, 0.42, 'bean_density'),
    '挽いたコーヒー': (0.32, 0.48, 'bean_density'),
    '甘味入り飲料粉末': (0.45, 0.70, 'instant_density'),
    '入浴剤の粒': (0.80, 1.10, 'salt_density'),
    'エプソムソルト・バスソルト': (0.85, 1.10, 'salt_density'),
    '塩化マグネシウムのフレーク': (0.80, 0.90, 'magnesium_chloride_density'),
    'クレイ入り入浴粉末': (0.55, 0.90, None),
    'ペット用細切りおやつ': (0.20, 0.50, None),
    '錠剤・カプセル': (0.45, 0.75, None),
    '食品粉末': (0.35, 0.65, None),
    '紅茶葉': (0.25, 0.40, None),
    'ピートモス': (0.15, 0.40, 'peat_density'),
    '液体詰め替え': (0.95, 1.05, None),
}

MASS_OVERRIDES = {
    'B0H99J2F9T': 200, 'B0G3PJK8K5': 200, 'B07ND8DBVG': 100,
    'B0H2YF6S9D': 500, 'B08GBYFFDQ': 500, 'B0997R1575': 800,
    'B0FPR27KT7': 400, 'B0CGWZ5J6H': 250, 'B007BJAY6I': 140,
    'B08YFP2BVH': 210, 'B0CW8GQS1G': 180, 'B07GSDJ6T2': 60,
    'B0H8MNXGKP': 40, 'B077PTNJ29': 400,
}

# Width and height of the likely pouch face, not necessarily Amazon's shipped-box dimensions.
GEOMETRY_OVERRIDES = {
    **{asin: (11.0, 21.3, '同シリーズの詰め替えパウチ約11×21.3cm', 'kikiyu') for asin in KIKIYU},
    'B07BBMLGVJ': (15.0, 24.0, 'GEXメーカー公表の同商品寸法', 'gex_200'),
    'B0DVSBJMXM': (11.0, 15.0, 'AGFメーカー公表の同商品寸法', 'agf_80'),
    'B07CNRNKT5': (14.0, 23.0, '画像と一般的な200g用コーヒー袋から推定', 'coffee_bag'),
    'B07CPSSL44': (14.0, 23.0, '画像と一般的な200g用コーヒー袋から推定', 'coffee_bag'),
    'B0G3PJK8K5': (13.5, 24.0, '画像から1袋の平面を推定', 'coffee_bag'),
    'B0CVKL9BVN': (15.0, 24.0, 'GEXメーカー公表の同商品寸法', 'gex_care'),
    'B0H9PFGNS3': (12.5, 23.0, '同容量の魚餌パウチから仮定', None),
    'B003YKUI32': (12.5, 23.0, '同容量の魚餌パウチから仮定', None),
    'B0FKB49RQZ': (15.0, 24.0, '同シリーズの200g袋から仮定', None),
    'B0FK9YMG6Q': (15.0, 24.0, '同シリーズの200g袋から仮定', None),
    'B0FK9XZKH1': (15.0, 24.0, '同シリーズの200g袋から仮定', None),
    'B0GVG983YB': (15.0, 24.0, '300g用アルミ袋の大きさを仮定', None),
    'B07K57K361': (15.0, 24.5, '300g用小動物フード袋の大きさを仮定', None),
    'B078YW4HYG': (12.5, 23.0, '200g用小分け袋の大きさを仮定', None),
    'B01FJ2IYN8': (12.5, 23.0, '200g用小分け袋の大きさを仮定', None),
    'B01FEUZPUK': (12.5, 23.0, '200g用小分け袋の大きさを仮定', None),
    'B01FEULQK8': (12.5, 23.0, '200g用小分け袋の大きさを仮定', None),
}

SPECIAL = {
    'B079L4T8BS': ('borderline', '100g×4の内袋。2×2に配置すれば厚みを抑えられる可能性があるが、内袋寸法は未確認。', '低'),
    'B079L56FM7': ('borderline', '100g×4の内袋。外袋の表示寸法だけでは並べ方を決められない。', '低'),
    'B0H99J2F9T': ('borderline', '200gの袋が2つ。重ねず横に並べる前提で、1袋の厚みが境界付近。', '低'),
    'B0G3PJK8K5': ('borderline', '200gの豆袋が2つ。横に並べても豆とガセットの厚みが境界付近。', '低'),
    'B07ND8DBVG': ('borderline', '100g×3袋。2袋重ね＋1袋横置きなどの配置が必要。', '低'),
    'B07CNRNKT5': ('borderline', '豆袋はマチを広げられるが、商品固有の平置き幅が不明。', '低'),
    'B07CPSSL44': ('borderline', '豆袋はマチを広げられるが、商品固有の平置き幅が不明。', '低'),
    'B00U5OYT58': ('unlikely', '袋が上部で結ばれており、その結び目は内容物をならしても薄くならない。', '中'),
    'B0H8MNXGKP': ('borderline', 'ティーバッグ20個で内容量40g。個々の袋や包装の重なりが不明。掲載長辺32.9cmで発送サイズにも余裕が少ない。', '低'),
    'B077PTNJ29': ('borderline', '400mLの液体は袋内に広げやすいが、注ぎ口の硬い部分の厚さが不明。', '低'),
    'B0CBHB12LV': ('borderline', '内容物だけなら3cm以内の推定だが、付属の計量スプーンが局所的に厚くなる可能性がある。', '低'),
    'B0FWQXZVTF': ('borderline', '内容物だけなら3cm以内の推定だが、付属の計量スプーンが局所的に厚くなる可能性がある。', '低'),
}

def dimensions_of(item):
    asin = item['asin']
    if asin in GEOMETRY_OVERRIDES:
        return GEOMETRY_OVERRIDES[asin]
    dims = item['listedDimensions']
    if not dims:
        return None
    match = re.search(r'(\d+(?:\.\d+)?)\s*[x×X]\s*(\d+(?:\.\d+)?)\s*[x×X]\s*(\d+(?:\.\d+)?)\s*(cm|mm)', dims, re.I)
    sides = sorted((float(v) / (10 if match.group(4).lower() == 'mm' else 1) for v in match.groups()[:3]), reverse=True)
    return (sides[1], sides[0], f'Amazon掲載の{item["dimensionType"]}寸法から仮定', None)

def material_of(item):
    asin = item['asin']
    title = item['title']
    if asin in FISH_SINKING: return '沈下性の魚用粒'
    if asin in FISH_FLOATING: return '浮上性の魚用粒'
    if asin in SMALL_ANIMAL: return '小動物用の粒・穀類'
    if asin == 'B081YSXNRG': return 'ペット用細切りおやつ'
    if asin in DOG_CAT: return '犬猫用ドライフード'
    if asin in INSTANT: return 'インスタントコーヒー'
    if asin in BEANS: return '焙煎コーヒー豆'
    if asin in GROUND: return '挽いたコーヒー'
    if asin == 'B0DFW1ML76': return '塩化マグネシウムのフレーク'
    if asin == 'B0GL6TYSJR': return '甘味入り飲料粉末'
    if asin in KIKIYU: return '入浴剤の粒'
    if item['category'] == '入浴剤・バスソルト':
        if any(s in title for s in ('クレイ', 'ベントナイト')): return 'クレイ入り入浴粉末'
        return 'エプソムソルト・バスソルト'
    if asin in SUPPLEMENTS: return '錠剤・カプセル'
    if asin == 'B0070Q8RQQ': return '紅茶葉'
    if asin == 'B00U5OYT58': return 'ピートモス'
    if asin == 'B077PTNJ29': return '液体詰め替え'
    if asin == 'B0H8MNXGKP': return '紅茶葉'
    if item['category'] == '観賞魚・ペット': return '魚用粒（浮沈不明）'
    return '食品粉末'

def mass_of(item):
    asin = item['asin']
    if asin in MASS_OVERRIDES: return MASS_OVERRIDES[asin]
    title = item['title']
    match = re.search(r'(\d+(?:\.\d+)?)\s*(?:g|ｇ|グラム|mL|ml)', title, re.I)
    if not match: raise ValueError(f'No content mass: {asin}')
    return float(match.group(1))

predictions = {}
for item in products:
    asin = item['asin']
    material = material_of(item)
    mass = mass_of(item)
    geometry = dimensions_of(item)
    if not geometry: raise ValueError(f'No pouch geometry: {asin}')
    width, height, geometry_note, geometry_source = geometry
    density_low, density_high, density_source = DENSITIES[material]
    # 1 cm is withheld from the width for side seals; 3 cm from the height for
    # the top/bottom seals and unfilled headspace. 0.3 cm provisionally allows
    # for the product pouch, a thin mailer and small unevenness.
    usable_area = (width - 1) * (height - 3)
    if usable_area <= 0: raise ValueError(f'Invalid face area: {asin}')
    thin = round(mass / density_high / usable_area + 0.3, 1)
    thick = round(mass / density_low / usable_area + 0.3, 1)
    verdict = 'likely' if thick <= 2.8 else 'unlikely' if thin > 3.0 else 'borderline'
    confidence = '中' if (geometry_source in ('gex_200', 'gex_care', 'agf_80') or (item['sizeConfirmed'] and item['dimensionType'] in ('本体', '製品', '商品'))) else '低'
    reason = f'{mass:g}gの{material}を約{width:g}×{height:g}cmの袋に広げる計算。'
    if asin in SPECIAL:
        verdict, special_reason, confidence = SPECIAL[asin]
        reason += special_reason
    else:
        reason += '密度と袋の有効面積に幅があるため、数値は目安。'
    if asin in ('B079L4T8BS', 'B079L56FM7'):
        thin, thick = 2.0, 3.8  # inner pouches, not one 400g fill
    if asin == 'B07ND8DBVG':
        thin, thick = 2.0, 3.6  # three 100g pouches; two may need stacking
    if asin == 'B0H8MNXGKP':
        thin, thick = 1.0, 3.0  # tea bags and wrappers cannot be modeled as loose leaves
    if asin == 'B077PTNJ29':
        thin, thick = 2.1, 3.4  # the rigid pour spout is not captured by liquid volume
    if asin in ('B0CBHB12LV', 'B0FWQXZVTF'):
        thick = 3.5  # unknown peak of included measuring spoon
    if asin == 'B0CVKL9BVN':
        confidence = '中'  # matching manufacturer's package dimensions were found
    if asin in ('B0CGWZ5J6H', 'B007BJAY6I', 'B08YFP2BVH', 'B0CW8GQS1G', 'B07GSDJ6T2'):
        confidence = '低'  # tablet mass and packed density are only indirect estimates
        reason += '質量は粒数からの概算。'
    # A low calculated thickness is not enough for a positive recommendation
    # when the pouch face came from a shipping box or another product.
    geometry_unverified = geometry_source not in ('gex_200', 'gex_care', 'agf_80') and (
        not item['sizeConfirmed'] or item['dimensionType'] in ('梱包', '掲載寸法')
        or geometry_source == 'coffee_bag'
    )
    if verdict == 'likely' and geometry_unverified:
        verdict = 'borderline'
        confidence = '低'
        reason += '商品袋の実寸を確認できないため、判定は保留。'
    sources = [f'https://www.amazon.co.jp/dp/{asin}']
    for key in (geometry_source, density_source):
        if key and SOURCES[key] not in sources: sources.append(SOURCES[key])
    predictions[asin] = {
        'verdict': verdict,
        'confidence': confidence,
        'roughThicknessCm': [thin, thick],
        'reason': reason,
        'massG': mass,
        'material': material,
        'assumedPouchCm': [width, height],
        'geometryNote': geometry_note,
        'densityRangeGml': [density_low, density_high],
        'sources': sources,
    }

assert len(predictions) == 100
(ROOT / 'predictions.js').write_text('window.NEKOPOST_PREDICTIONS = ' + json.dumps(predictions, ensure_ascii=False, separators=(',', ':')) + ';\n')
print(Counter(p['verdict'] for p in predictions.values()))
for item in products:
    p = predictions[item['asin']]
    print(item['asin'], p['verdict'], p['roughThicknessCm'], p['confidence'], item['title'][:35])
