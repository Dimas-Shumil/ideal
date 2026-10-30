import { createHash } from 'node:crypto';
const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pages = {
  '/schedule.html': ['Расписание тренировок — ИДЕАЛ / Абакан', 'Публичное расписание групповых занятий клуба ИДЕАЛ. Время Абакана, UTC+7. Только просмотр, без онлайн-записи.'],
  '/': ['ИДЕАЛ — тренажёрный зал в Абакане', 'Спортивный клуб ИДЕАЛ в Абакане: тренажёрный зал, групповые и персональные тренировки, расписание, тренеры и абонементы. Контакты и адрес клуба.'],
  '/about.html': ['О спортивном клубе ИДЕАЛ — Абакан', 'О спортивном клубе ИДЕАЛ в Абакане: тренажёрный зал, персональные и групповые занятия, адрес и контакты.'],
  '/trainers.html': ['Тренеры клуба ИДЕАЛ в Абакане', 'Тренеры спортивного клуба ИДЕАЛ в Абакане: специализация, профили и направления тренировок.'],
  '/trainer.html': ['Демо-профиль тренера — ИДЕАЛ / Абакан', 'Демонстрационный профиль. Реальные данные ожидаются, запись недоступна.'],
  '/shop.html': ['Спортивное питание — ИДЕАЛ / Абакан', 'Спортивное питание в клубе ИДЕАЛ в Абакане: каталог товаров, наличие, заказ и самовывоз из клуба с оплатой при получении.'],
};
export function seoFor(config, path, query = {}, product = null, options = {}) {
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
  // Published editorial pages may be indexed only after explicit content approval.
  const editorialPath = ['/about.html', '/schedule.html', '/trainers.html'].includes(path) ||
    /^\/directions\/(?:gym|group|personal)$/.test(path) || /^\/trainers\/[a-f0-9]{32}$/.test(path);
  if (config.SEO_CONTENT_INDEXABLE && editorialPath && options.published && Object.keys(query).length === 0) index = true;
  return { title, description, canonical: origin ? origin + url : '', robots: enabled && index ? 'index,follow' : 'noindex,follow', origin };
}
export function seoHead(seo) {
  return `<title>${escape(seo.title)}</title><meta name="description" content="${escape(seo.description)}"><meta name="robots" content="${seo.robots}">` +
    (seo.canonical ? `<link rel="canonical" href="${escape(seo.canonical)}"><meta property="og:type" content="website"><meta property="og:locale" content="ru_RU"><meta property="og:site_name" content="ИДЕАЛ"><meta property="og:title" content="${escape(seo.title)}"><meta property="og:description" content="${escape(seo.description)}"><meta property="og:url" content="${escape(seo.canonical)}"><meta property="og:image" content="${escape(seo.origin)}/site/img/brand/ideal-og-v1.png"><meta name="twitter:card" content="summary_large_image">` : '');
}
export function applySeo(res, config, path, html, query = {}, siteContacts = {}) {
  const seo = seoFor(config, path, query);
  res.set('X-Robots-Tag', seo.robots);
  let extra = '';
  // Only the verified site identity. No invented reviews, people or club facts.
  if (path === '/' && seo.origin) {
    const nodes = [{ '@type': 'WebSite', '@id': seo.origin + '/#website', name: 'ИДЕАЛ', url: seo.origin + '/', inLanguage: 'ru-RU' }];
    // Verified owner-published contacts are used for structured identity.
    if (siteContacts?.address && siteContacts?.phone) {
      const business = {
        '@type': 'HealthClub', '@id': seo.origin + '/#club',
        name: 'ИДЕАЛ', url: seo.origin + '/', telephone: siteContacts.phone,
        address: { '@type': 'PostalAddress', streetAddress: siteContacts.address, addressLocality: 'Абакан', addressRegion: 'Республика Хакасия', addressCountry: 'RU' },
        image: seo.origin + '/site/img/brand/ideal-og-v1.png',
        logo: seo.origin + '/site/img/brand/ideal-logo-v1.png'
      };
      const sameAs = [siteContacts.vk, siteContacts.telegram].filter(Boolean);
      if (sameAs.length) business.sameAs = sameAs;
      nodes.push(business);
    }
    const json = JSON.stringify({ '@context': 'https://schema.org', '@graph': nodes }).replace(/</g, '\\u003c');
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
  return 'User-agent: *\n' + ['/api/', '/admin', '/staff', '/trainer$', '/trainer/', '/crm', '/shop-panel', '/login', '/logout', '/application', '/notifications', '/cart.html', '/shop/order/', '/offline.html'].map(p => 'Disallow: ' + p + '\n').join('') + 'Sitemap: ' + config.SEO_ORIGIN + '/sitemap.xml\n';
}
export async function sitemapXml(config, prisma) {
  let urls = [];
  if (config.production && config.SEO_INDEXABLE && config.SEO_ORIGIN) {
    const products = await prisma.shopProduct.findMany({where:{active:true},select:{id:true},orderBy:{id:'asc'}});
    urls = ['/', '/shop.html', ...products.map(p => '/product.html?id=' + encodeURIComponent(p.id))];
    if (config.SEO_CONTENT_INDEXABLE) {
      // Editorial pages are listed only while publicly visible. The original
      // unconfigured blank records still render the bundled default pages.
      if (prisma.contentEntry?.findMany) {
        const entries = await prisma.contentEntry.findMany({
          where: { key: { in: ['about','gym','group','personal'] } },
          select: { key: true, visible: true, version: true, data: true }
        });
        for (const key of ['about','gym','group','personal']) {
          const e = entries.find(item => item.key === key);
          if (!e || e.visible || (e.version === 1 && Object.values(e.data || {}).every(v => !v)))
            urls.push(key === 'about' ? '/about.html' : '/directions/' + key);
        }
      } else urls.push('/about.html','/directions/gym','/directions/group','/directions/personal');
      if (prisma.trainerProfile?.findMany) {
        const trainers = await prisma.trainerProfile.findMany({
          where: { publicVisible: true, publicName: { not: '' }, user: { active: true, role: 'TRAINER' } },
          select: { publicKey: true, publicName: true, photo: { select: { trainerId: true } }, summary: true, biography: true }
        });
        if (trainers.length) urls.push('/trainers.html');
        for (const trainer of trainers) if (trainer.photo && (trainer.summary?.trim() || trainer.biography?.trim())) urls.push('/trainers/' + trainer.publicKey);
      }
      if (prisma.lesson?.findFirst) {
        const lesson = await prisma.lesson.findFirst({where:{kind:'GROUP',publicVisible:true,status:'SCHEDULED',startsAt:{gte:new Date()},trainer:{user:{active:true,role:'TRAINER'}}},select:{id:true}});
        if (lesson) urls.push('/schedule.html');
      }
    }
  }
  return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + urls.map(p => `<url><loc>${escape(config.SEO_ORIGIN + p)}</loc></url>`).join('') + '</urlset>';
}
