"""Cache listed Amazon product photos locally for the file-based dashboard.

The saved images are visual references, not photos of a packed parcel.
"""

import io
import json
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from PIL import Image, ImageOps


ROOT = Path(__file__).parent
SOURCE = ROOT / 'product_images.js'
OUT_DIR = ROOT / 'assets' / 'product-images'
MANIFEST = ROOT / 'local_product_images.js'
PREFIX = 'window.NEKOPOST_IMAGES = '


def load_urls():
    content = SOURCE.read_text()
    if not content.startswith(PREFIX):
        raise ValueError('Unexpected image URL file format')
    return json.loads(content[len(PREFIX):].rstrip().removesuffix(';'))['images']


def cache_one(asin, url):
    destination = OUT_DIR / f'{asin}.jpg'
    if destination.exists() and destination.stat().st_size > 1000:
        return asin, True, None
    request = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            raw = response.read()
        image = ImageOps.exif_transpose(Image.open(io.BytesIO(raw)))
        image.thumbnail((640, 640), Image.Resampling.LANCZOS)
        if image.mode != 'RGB':
            background = Image.new('RGB', image.size, 'white')
            if image.mode == 'RGBA':
                background.paste(image, mask=image.getchannel('A'))
            else:
                background.paste(image.convert('RGB'))
            image = background
        image.save(destination, 'JPEG', quality=85, optimize=True)
        return asin, True, None
    except Exception as error:
        return asin, False, type(error).__name__


def main():
    urls = load_urls()
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    cached = {}
    errors = {}
    with ThreadPoolExecutor(max_workers=6) as pool:
        futures = [pool.submit(cache_one, asin, url) for asin, url in urls.items()]
        for future in as_completed(futures):
            asin, success, error = future.result()
            if success:
                cached[asin] = f'assets/product-images/{asin}.jpg'
            else:
                errors[asin] = error
    MANIFEST.write_text('window.NEKOPOST_LOCAL_IMAGES = ' + json.dumps(dict(sorted(cached.items())), ensure_ascii=False, separators=(',', ':')) + ';\n')
    print(f'Cached {len(cached)}/{len(urls)} product photos; failures: {errors}')


if __name__ == '__main__':
    main()
