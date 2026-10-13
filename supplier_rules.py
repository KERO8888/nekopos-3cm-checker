"""Conservative checks for supplier titles before treating them as one unit."""

import re
import unicodedata


MULTI = re.compile(
    r"(?:\(\s*[xX×]\s*(?:[2-9]\d*|1\d+)\s*\)"
    r"|(?:[×*]|(?<=[0-9gGmMlL])[xX])\s*(?:[2-9]\d*|1\d+)\s*(?:個|コ|袋|本|箱|点|パック|セット|組|入)"
    r"|[gGmMlL錠袋包本箱個コ]\s*[×xX*]\s*(?:[2-9]\d*|1\d+)(?!\d)"
    r"|(?<!\d)(?:[2-9]\d*|1\d+)\s*(?:個|コ|袋|包|本|箱|点|パック)(?!限|まで)"
    r"|ケース販売|まとめ買い|セット(?!力)|ギフトセット)"
)


def is_multi_unit(title):
    normalized = unicodedata.normalize("NFKC", title or "")
    normalized = re.sub(r"お一人様\s*\d+\s*点\s*(?:限り|まで|限定)", "", normalized)
    return bool(MULTI.search(normalized))
