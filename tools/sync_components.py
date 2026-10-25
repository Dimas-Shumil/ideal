"""Optional source maintenance: python tools/sync_components.py.
Go Live needs only the already generated HTML/CSS, not Python.
"""
from pathlib import Path
import re
root = Path(__file__).resolve().parents[1]
for filename in ('index.html', 'trainers.html', 'about.html', 'trainer.html', 'shop.html', 'product.html', 'cart.html'):
    page = root / filename
    text = page.read_text(encoding='utf-8')
    for name in ('header', 'footer', 'menu', 'preview'):
        fragment = (root / 'components' / (name + '.html')).read_text(encoding='utf-8').strip()
        pattern = r'(<!-- component:' + name + r':start -->).*?(<!-- component:' + name + r':end -->)'
        text, count = re.subn(pattern, lambda m: m[1] + '\n' + fragment + '\n    ' + m[2], text, flags=re.S)
        if count != 1:
            raise ValueError(f'{filename}: expected one {name} component')
    page.write_text(text, encoding='utf-8')

# Server fragments share the canonical markup, but contacts come from one DB setting.
def server_fragment(name):
    text = (root / ('components/' + name + '.html')).read_text(encoding='utf-8').strip()
    if name == 'footer':
        text, count = re.subn(r'<div class="ideal-footer__contacts">.*?</div>',
            lambda m: "<%- include('../content/contacts') %>", text, flags=re.S)
        if count != 1: raise ValueError('Expected one contacts block')
    if name == 'menu':
        text, count = re.subn(r'<p class="menu-panel__footnote">.*?</p>',
            lambda m: '<p class="menu-panel__footnote">ИДЕАЛ · АБАКАН<% if(typeof siteContacts === "object" && siteContacts.address){ %><br><%= siteContacts.address %><% } %></p>', text, flags=re.S)
        if count != 1: raise ValueError('Expected one menu address')
    return text
for directory in ('shop', 'public'):
    views = root / 'server/views' / directory
    (views / 'header.ejs').write_text(server_fragment('header') + '\n', encoding='utf-8')
    footer = '\n'.join(server_fragment(name) for name in ('footer', 'menu', 'preview'))
    (views / 'footer.ejs').write_text(footer + '\n<script src="/site/scripts/main.js" defer></script></body></html>\n', encoding='utf-8')
print('Shared components synchronized.')
