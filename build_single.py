#!/usr/bin/env python3
"""Builds dist/: ONE index.html (all CSS + JS inlined) plus manifest.json, sw.js and the icons.
Easiest way to host on GitHub Pages from a phone: upload just the files in dist/ (no folders needed)."""
import re, os, shutil
ROOT = os.path.dirname(os.path.abspath(__file__)); os.chdir(ROOT)
html = open('index.html').read()
css = open('style.css').read()
html = html.replace('<link rel="stylesheet" href="style.css">', '<style>\n' + css + '\n</style>')
def inline(m):
    src = m.group(1)
    if src.startswith('http'): return m.group(0)
    js = open(src).read()
    assert '</script' not in js, src
    return '<script>\n' + js + '\n</script>'
html = re.sub(r'<script src="([^"]+)"></script>', inline, html)
html = re.sub(r"<script>window\.THREE \|\| document\.write\(.*?</script>\n", "", html)   # no vendor fallback in the single file
html = html.replace('&middot; files', '&middot; single file')
os.makedirs('dist', exist_ok=True)
open('dist/index.html', 'w').write(html)
for f in ['manifest.json', 'sw.js', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png']: shutil.copy(f, 'dist/' + f)
print('dist/index.html', len(html) // 1024, 'KB')
