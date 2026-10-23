"""Optional source maintenance: python tools/sync_components.py.
Go Live needs only the already generated HTML/CSS, not Python.
"""
from pathlib import Path
import re
root = Path(__file__).resolve().parents[1]
for filename in ('index.html', 'trainers.html', 'about.html', 'trainer.html', 'shop.html'):
    page = root / filename
    text = page.read_text(encoding='utf-8')
    for name in ('header', 'footer', 'menu', 'preview'):
        fragment = (root / 'components' / (name + '.html')).read_text(encoding='utf-8').strip()
        pattern = r'(<!-- component:' + name + r':start -->).*?(<!-- component:' + name + r':end -->)'
        text, count = re.subn(pattern, lambda m: m[1] + '\n' + fragment + '\n    ' + m[2], text, flags=re.S)
        if count != 1:
            raise ValueError(f'{filename}: expected one {name} component')
    page.write_text(text, encoding='utf-8')
print('Shared components synchronized.')
