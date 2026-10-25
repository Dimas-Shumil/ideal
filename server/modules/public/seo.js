import { createHash } from 'node:crypto';
const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pages = {
  '/': ['ИДЕАЛ — тренажёрный зал в Абакане', 'Спортивный клуб ИДЕАЛ в Абакане. Направления тренировок, абонементы и спортивное питание.'],
  '/about.html': ['О клубе — ИДЕАЛ / Абакан', 'Спортивный клуб ИДЕАЛ в Абакане. Страница готовится к наполнению.'],
  '/trainers.html': ['Тренеры — ИДЕАЛ / Абакан', 'Каталог тренеров клуба ИДЕАЛ. Реальные данные готовятся к публикации.'],
  '/trainer.html': ['Демо-профиль тренера — ИДЕАЛ / Абакан', 'Демонстрационный профиль. Реальные данные ожидаются, запись недоступна.'],
  '/shop.html': ['Спортивное питание — ИДЕАЛ / Абакан', 'Спортивное питание в клубе ИДЕАЛ. Заказ без регистрации, самовывоз и оплата при получении.'],
};
export function seoFor(config, path, query = {}, product = null) {
  const origin = config.SEO_ORIGIN || '';
  const enabled = !!(config.production && config.SEO_INDEXABLE && origin);
  let url = path, title, description, index = false;
  if (pages[path]) {
    [title, description] = pages[path];
    index = ['/', '/shop.html'].includes(path) && Object.keys(query).length === 0;
  } else if (path === '/product.html' && product) {
    title = product.name + ' — ИДЕАЛ';
    description = product.description?.trim().slice(0, 240) || 'Спортивное питание в клубе ИДЕАЛ. Самовывоз, оплата при получении.';
    url = path + '?id=' + encodeURIComponent(product.id);
    index = Object.keys(query).length === 1 && query.id === product.id;
  } else {
    title = 'ИДЕАЛ'; description = '';
  }
  return { title, description, canonical: origin ? origin + url : '', robots: enabled && index ? 'index,follow' : 'noindex,follow', origin };
}
export function seoHead(seo) {
  return `<title>${escape(seo.title)}</title><meta name="description" content="${escape(seo.description)}"><meta name="robots" content="${seo.robots}">` +
    (seo.canonical ? `<link rel="canonical" href="${escape(seo.canonical)}"><meta property="og:type" content="website"><meta property="og:site_name" content="ИДЕАЛ"><meta property="og:title" content="${escape(seo.title)}"><meta property="og:description" content="${escape(seo.description)}"><meta property="og:url" content="${escape(seo.canonical)}">` : '');
}
export function applySeo(res, config, path, html, query = {}) {
  const seo = seoFor(config, path, query);
  res.set('X-Robots-Tag', seo.robots);
  let extra = '';
  // Only the verified site identity. No invented reviews, people or club facts.
  if (path === '/' && seo.origin) {
    const json = JSON.stringify({'@context':'https://schema.org','@type':'WebSite',name:'ИДЕАЛ',url:seo.origin + '/'}).replace(/</g, '\\u003c');
    extra = `<script type="application/ld+json">${json}</script>`;
    const csp = res.get('Content-Security-Policy');
    if (csp) res.set('Content-Security-Policy', csp.replace(/script-src([^;]*)/, (_, values) => `script-src${values} 'sha256-${createHash('sha256').update(json).digest('base64')}'`));
  }
  return html.replace(/<title>[\s\S]*?<\/title>/i, '')
    .replace(/<meta\s+name=["'](?:description|robots)["'][^>]*>/gi, '')
    .replace('</head>', seoHead(seo) + extra + '</head>');
}
export function robotsText(config) {
  if (!config.production || !config.SEO_INDEXABLE || !config.SEO_ORIGIN) return 'User-agent: *\nDisallow: /\n';
  return 'User-agent: *\n' + ['/api/', '/admin', '/staff', '/trainer', '/crm', '/shop-panel', '/login', '/logout', '/application', '/notifications', '/cart.html', '/shop/order/', '/offline.html'].map(p => 'Disallow: ' + p + '\n').join('') + 'Sitemap: ' + config.SEO_ORIGIN + '/sitemap.xml\n';
}
export async function sitemapXml(config, prisma) {
  let urls = [];
  if (config.production && config.SEO_INDEXABLE && config.SEO_ORIGIN) {
    const products = await prisma.shopProduct.findMany({where:{active:true},select:{id:true},orderBy:{id:'asc'}});
    urls = ['/', '/shop.html', ...products.map(p => '/product.html?id=' + encodeURIComponent(p.id))];
  }
  return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + urls.map(p => `<url><loc>${escape(config.SEO_ORIGIN + p)}</loc></url>`).join('') + '</urlset>';
}
