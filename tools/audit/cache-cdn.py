#!/usr/bin/env python3
"""Fill the public-library browser audit cache; verified bytes stay outside the repository.
Run: python3 tools/audit/cache-cdn.py [--cache PATH]
AI_CDN_CACHE selects the same cache for ai-libraries.cjs. No credentials are used.
"""
import argparse, base64, concurrent.futures, hashlib, json, os, pathlib, tempfile, urllib.request


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--cache', default=os.environ.get('AI_CDN_CACHE', str(pathlib.Path(tempfile.gettempdir()) / 'uqu-cdn-audit')))
    p.add_argument('--offline', action='store_true', help='validate only; do not fetch missing files')
    args = p.parse_args()
    target = pathlib.Path(args.cache)
    target.mkdir(parents=True, exist_ok=True)
    scripts = json.loads(pathlib.Path(__file__).with_name('cdn-fixtures.json').read_text())['scripts']

    def check(item):
        dest = target / item['cache_file']
        def valid(raw):
            return len(raw) == item['bytes'] and 'sha384-' + base64.b64encode(hashlib.sha384(raw).digest()).decode() == item['integrity']
        if dest.is_file() and valid(dest.read_bytes()):
            return 'cached ' + item['url']
        if args.offline:
            raise ValueError('Missing or invalid cache entry: ' + item['url'])
        if not item['url'].startswith('https://'):
            raise ValueError('CDN fixture URL must use HTTPS')
        req = urllib.request.Request(item['url'], headers={'Accept-Encoding': 'identity'})
        with urllib.request.urlopen(req, timeout=45) as response:
            data = response.read(8 * 1024 * 1024 + 1)
        if not valid(data):
            raise ValueError('Public CDN bytes differ from the reviewed SHA384: ' + item['url'])
        dest.write_bytes(data)
        return 'verified ' + item['url']

    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        for message in pool.map(check, scripts):
            print(message)
    print('Public library cache ready: ' + str(target))


if __name__ == '__main__':
    main()
