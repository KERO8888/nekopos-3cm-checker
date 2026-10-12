"""Conservative checks for Yahoo supplier titles before treating them as one unit."""

import re
import unicodedata


MULTI = re.compile(
    r"(?:[×xX*]\s*[2-9]\d*\s*(?:個|袋|本|点|パック)?"
    r"|[2-9]\d*\s*(?:個|袋|本|箱|点|パック)\s*(?:セット|組|入)"
    r"|ケース販売|まとめ買い|セット販売|ギフトセット)"
)


def is_multi_unit(title):
    return bool(MULTI.search(unicodedata.normalize("NFKC", title or "")))
