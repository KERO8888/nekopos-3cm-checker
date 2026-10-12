import unittest

from discover_supplier_leads import rakuten_hits
from supplier_rules import is_multi_unit
from verify_rakuten_suppliers import leads_for, sizes


class SupplierPipelineTests(unittest.TestCase):
    def test_rakuten_shipping_ignores_generic_free_shipping_notice(self):
        html = '''<div class="searchresultitem" data-track-price="1214">
          <a class="title-link--3Yuev" href="https://item.rakuten.co.jp/shop/a/">500g 単品</a>
          <div class="price-wrapper--10ccL">1,214 円 +送料880円</div>
          <span>11 ポイント</span><p>3,980円以上で送料無料</p></div>'''
        hit = rakuten_hits(html)[0]
        self.assertEqual((hit["priceYen"], hit["displayShippingYen"], hit["displayPoints"]), (1214, 880, 11))

    def test_twelve_bags_are_not_one_unit(self):
        self.assertTrue(is_multi_unit("詰め替え 200g×12袋"))
        self.assertTrue(is_multi_unit("200g 12袋"))
        self.assertTrue(is_multi_unit("500g×2"))
        self.assertTrue(is_multi_unit("500グラム (x 12)"))
        self.assertFalse(is_multi_unit("詰め替え 200g 1袋"))
        self.assertFalse(is_multi_unit("8×4エイトフォーメン 詰替300mL"))
        self.assertFalse(is_multi_unit("200g お一人様30点限り"))

    def test_wrong_size_lead_is_not_checked(self):
        item = {"title": "入浴剤 500g", "queries": {"rakuten:title": {
            "market": "rakuten", "firstPageHits": [
                {"title": "入浴剤 50g", "url": "https://item.rakuten.co.jp/shop/wrong/", "priceYen": 100, "displayShippingYen": 0},
                {"title": "入浴剤 500g", "url": "https://item.rakuten.co.jp/shop/right/", "priceYen": 500, "displayShippingYen": 0},
            ]}}}
        self.assertEqual([lead["url"] for lead in leads_for(item, [])], ["https://item.rakuten.co.jp/shop/right/"])
        self.assertEqual(sizes("500グラム"), {"500g"})


if __name__ == "__main__":
    unittest.main()
