/* ============================================================
   ELECTRONICS SELLING — shared helpers + public site logic
   Data source: /data/settings.json and /data/products.json
   ============================================================ */

const ES = (() => {
  'use strict';

  const money = (n, sym = '$') => {
    const v = Number(n);
    if (!isFinite(v) || v <= 0) return '—';
    const s = v % 1 === 0 ? String(v) : v.toFixed(2);
    return sym + s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  };

  const esc = (s = '') => String(s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));

  const stars = r => {
    const n = Math.round(Number(r) || 0);
    return '★★★★★'.slice(0, n) + '☆☆☆☆☆'.slice(0, 5 - n);
  };

  const qs = (k, fallback = '') => {
    try { return new URLSearchParams(location.search).get(k) || fallback; }
    catch { return fallback; }
  };

  const icon = (name, size = 20) => {
    const p = {
      phone: '<rect x="7" y="2" width="10" height="20" rx="2.5"/><path d="M11 18h2"/>',
      laptop: '<rect x="4" y="5" width="16" height="11" rx="2"/><path d="M2 19h20l-1.5-2H3.5z"/>',
      tv: '<rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>',
      audio: '<path d="M4 14v-2a8 8 0 0 1 16 0v2"/><rect x="2" y="13" width="4" height="7" rx="2"/><rect x="18" y="13" width="4" height="7" rx="2"/>',
      plug: '<path d="M9 2v6M15 2v6"/><path d="M6 8h12v3a6 6 0 0 1-12 0z"/><path d="M12 17v5"/>',
      chip: '<rect x="6" y="6" width="12" height="12" rx="3"/><path d="M10 2v4M14 2v4M10 18v4M14 18v4M2 10h4M2 14h4M18 10h4M18 14h4"/>',
      check: '<path d="M20 6L9 17l-5-5"/>',
      arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
      pin: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/>',
      mail: '<rect x="2" y="4" width="20" height="16" rx="3"/><path d="m3 6 9 7 9-7"/>',
      clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l4 2"/>',
      truck: '<path d="M14 17V5H2v12h12zM14 9h4l4 4v4h-8"/><circle cx="6.5" cy="18.5" r="2"/><circle cx="17.5" cy="18.5" r="2"/>',
      shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="m9 12 2 2 4-4"/>',
      headset: '<path d="M4 14v-2a8 8 0 0 1 16 0v2"/><rect x="2" y="13" width="4" height="6" rx="2"/><rect x="18" y="13" width="4" height="6" rx="2"/><path d="M20 19v1a3 3 0 0 1-3 3h-3"/>',
      card: '<rect x="2" y="5" width="20" height="14" rx="3"/><path d="M2 10h20"/>',
      search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
      wa: '<path d="M20.5 11.6a8.4 8.4 0 0 1-12.4 7.4L3.5 20.5l1.6-4.5A8.4 8.4 0 1 1 20.5 11.6z"/><path d="M8.6 8.2c-.3 0-.6.1-.8.4-.3.3-.9 1-.9 2.2s.9 2.4 1 2.6c.1.2 1.7 2.7 4.2 3.6 2 .8 2.4.6 2.9.6.4 0 1.4-.6 1.6-1.2.2-.6.2-1 .1-1.1-.1-.1-.2-.2-.5-.3l-1.7-.8c-.2-.1-.4-.1-.6.1l-.6.8c-.1.1-.3.2-.5.1-.2-.1-.9-.3-1.8-1.1-.7-.6-1.1-1.3-1.2-1.5-.1-.2 0-.3.1-.4l.4-.5c.1-.2.2-.3.3-.5v-.4l-.8-1.9c-.2-.4-.4-.4-.5-.4z"/>',
      star: '<path d="M12 3l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5-5.8-3.1-5.8 3.1 1.1-6.5L2.6 9.8l6.5-.9z"/>'
    }[name] || '<circle cx="12" cy="12" r="9"/>';
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
  };

  async function loadData() {
    const bust = '?v=' + Date.now();
    const [s, p] = await Promise.all([
      fetch('data/settings.json' + bust, { cache: 'no-store' }),
      fetch('data/products.json' + bust, { cache: 'no-store' })
    ]);
    if (!s.ok || !p.ok) throw new Error('Could not load catalogue data');
    const settings = await s.json();
    const products = await p.json();
    return { settings, products: (products.items || products || []).filter(x => x.published !== false) };
  }

  function card(p, sym, d = 0) {
    const off = p.oldPrice > p.price ? Math.round((1 - p.price / p.oldPrice) * 100) : 0;
    const flags = [
      off ? `<span class="flag flag--sale">−${off}%</span>` : '',
      p.isNew ? '<span class="flag flag--new">New</span>' : '',
      Number(p.stock) > 0 && Number(p.stock) <= 8 ? '<span class="flag flag--low">Low stock</span>' : ''
    ].join('');
    return `
      <article class="product reveal ${d ? 'reveal-d' + d : ''}">
        <a class="product__media" href="product.html?id=${encodeURIComponent(p.id)}" aria-label="${esc(p.name)}">
          <img src="${esc(p.image)}" alt="${esc(p.name)}" loading="lazy" width="400" height="400">
          <span class="product__flags">${flags}</span>
        </a>
        <div class="product__body">
          <span class="product__cat">${esc(p.categoryName || p.category || '')}</span>
          <h3 class="product__name"><a href="product.html?id=${encodeURIComponent(p.id)}">${esc(p.name)}</a></h3>
          <p class="product__desc">${esc(p.shortDescription || '')}</p>
          <span class="product__rate"><span class="stars">${stars(p.rating)}</span> ${esc(p.rating || '')} <span class="count">(${esc(p.reviews || 0)})</span></span>
          <div class="product__foot">
            <span class="price">
              <span class="price__now">${money(p.price, sym)}</span>
              ${p.oldPrice > p.price ? `<span class="price__was">${money(p.oldPrice, sym)}</span>` : ''}
            </span>
            <a class="product__cta" href="product.html?id=${encodeURIComponent(p.id)}" aria-label="View ${esc(p.name)}">${icon('arrow', 18)}</a>
          </div>
        </div>
      </article>`;
  }

  function reveal(scope = document) {
    const els = scope.querySelectorAll('.reveal:not(.in)');
    if (!('IntersectionObserver' in window)) { els.forEach(e => e.classList.add('in')); return; }
    const io = new IntersectionObserver((entries) => {
      entries.forEach(en => {
        if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: .08 });
    els.forEach(e => io.observe(e));
  }

  const waLink = (b, msg) => `https://wa.me/${String(b.whatsapp || '').replace(/[^\d]/g, '')}?text=${encodeURIComponent(msg || b.whatsappMessage || 'Hello')}`;

  return { money, esc, stars, qs, icon, loadData, card, reveal, waLink };
})();

/* ------------------------------------------------------------
   Public page controller
   ------------------------------------------------------------ */
document.addEventListener('DOMContentLoaded', async () => {
  const { money, esc, qs, icon, loadData, card, reveal, waLink, stars } = ES;

  /* header behaviour */
  const header = document.querySelector('.header');
  const onScroll = () => header && header.classList.toggle('is-stuck', window.scrollY > 8);
  onScroll(); window.addEventListener('scroll', onScroll, { passive: true });

  /* drawer */
  const drawer = document.querySelector('.drawer');
  const scrim = document.querySelector('.scrim');
  const openDrawer = (open) => {
    if (!drawer) return;
    drawer.classList.toggle('is-open', open);
    scrim && scrim.classList.toggle('is-open', open);
    drawer.setAttribute('aria-hidden', open ? 'false' : 'true');
    document.body.style.overflow = open ? 'hidden' : '';
  };
  document.querySelectorAll('[data-drawer-open]').forEach(b => b.addEventListener('click', () => openDrawer(true)));
  document.querySelectorAll('[data-drawer-close]').forEach(b => b.addEventListener('click', () => openDrawer(false)));
  scrim && scrim.addEventListener('click', () => openDrawer(false));
  document.addEventListener('keydown', e => { if (e.key === 'Escape') openDrawer(false); });

  /* year */
  document.querySelectorAll('[data-year]').forEach(el => el.textContent = new Date().getFullYear());

  let data;
  try {
    data = await loadData();
  } catch (err) {
    document.querySelectorAll('[data-fatal]').forEach(el => { el.hidden = false; el.textContent = 'The catalogue could not be loaded. If you opened this file directly, run it from a web server (file:// blocks fetch).'; });
    return;
  }

  const { settings, products } = data;
  const b = settings.business || {};
  const sym = b.currencySymbol || '$';
  const setText = (sel, val) => document.querySelectorAll(sel).forEach(el => { el.textContent = val; });

  /* ---------- business info ---------- */
  setText('[data-biz-name]', b.name || 'ELECTRONICS SELLING');
  setText('[data-biz-phone]', b.phone || '');
  setText('[data-biz-email]', b.email || '');
  setText('[data-biz-address]', b.address || '');
  setText('[data-biz-hours]', b.hours || '');
  setText('[data-biz-tagline]', b.tagline || '');
  setText('[data-biz-announcement]', b.announcement || '');
  document.querySelectorAll('[data-biz-phone-link]').forEach(el => el.href = 'tel:' + String(b.phone || '').replace(/[^\d+]/g, ''));
  document.querySelectorAll('[data-biz-email-link]').forEach(el => el.href = 'mailto:' + (b.email || ''));
  document.querySelectorAll('[data-wa-link]').forEach(el => el.href = waLink(b));
  document.querySelectorAll('[data-year]').forEach(el => el.textContent = new Date().getFullYear());
  const mapFrame = document.querySelector('[data-map]');
  if (mapFrame && b.mapQuery) {
    mapFrame.src = 'https://www.google.com/maps?q=' + encodeURIComponent(b.mapQuery) + '&output=embed';
    mapFrame.loading = 'lazy';
  }

  /* social links */
  const socialHost = document.querySelector('[data-socials]');
  const socialIcons = {
    facebook: '<path d="M15 3h-3a4 4 0 0 0-4 4v3H5v4h3v7h4v-7h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/>',
    instagram: '<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.2" cy="6.8" r="1"/>',
    x: '<path d="M4 4l16 16M20 4L4 20"/>',
    youtube: '<rect x="2" y="5" width="20" height="14" rx="4"/><path d="m10 9 6 3-6 3z"/>',
    tiktok: '<path d="M14 4v10a3.5 3.5 0 1 1-3.5-3.5"/><path d="M14 4a5 5 0 0 0 5 5"/>'
  };
  if (socialHost && b.social) {
    socialHost.innerHTML = Object.entries(b.social)
      .filter(([, url]) => url && url !== '#')
      .map(([k, url]) => `<a class="social" href="${esc(url)}" target="_blank" rel="noopener noreferrer" aria-label="${k}">
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${socialIcons[k] || socialIcons.x}</svg></a>`).join('');
  }

  /* announcement strip */
  const strip = document.querySelector('[data-strip]');
  if (strip) {
    const items = (settings.announcements && settings.announcements.length ? settings.announcements : [b.announcement || '']).filter(Boolean);
    strip.innerHTML = [...items, ...items].map(t => `<span>${esc(t)}</span>`).join('');
  }

  /* ---------- hero ---------- */
  const hero = settings.hero || {};
  setText('[data-hero-kicker]', hero.kicker || '');
  const h1 = document.querySelector('[data-hero-title]');
  if (h1) h1.innerHTML = `${esc(hero.titleLine1 || '')} <span class="grad">${esc(hero.titleHighlight || '')}</span>`;
  setText('[data-hero-lead]', hero.lead || '');
  const heroImg = document.querySelector('[data-hero-img]');
  if (heroImg && hero.banner) { heroImg.src = hero.banner; heroImg.alt = (b.name || '') + ' product collection'; }
  const hb = document.querySelector('[data-hero-badge]');
  if (hb && hero.badge) hb.innerHTML = `<span class="ic">${icon('truck', 19)}</span><span><b>${esc(hero.badge.title)}</b><small>${esc(hero.badge.text)}</small></span>`;
  setText('[data-hero-tag]', hero.tag || '');
  const pcta = document.querySelector('[data-hero-primary]');
  if (pcta && hero.primaryCta) { pcta.textContent = hero.primaryCta.label; pcta.href = hero.primaryCta.href || '#products'; }
  const scta = document.querySelector('[data-hero-secondary]');
  if (scta && hero.secondaryCta) { scta.textContent = hero.secondaryCta.label; scta.href = hero.secondaryCta.href === 'whatsapp' ? waLink(b) : (hero.secondaryCta.href || '#'); }

  /* stats */
  const statHost = document.querySelector('[data-stats]');
  if (statHost) statHost.innerHTML = (settings.stats || []).map(s =>
    `<div class="hero__stat"><strong>${esc(s.value)}</strong><span>${esc(s.label)}</span></div>`).join('');

  /* ---------- categories ---------- */
  const catHost = document.querySelector('[data-categories]');
  const counts = products.reduce((m, p) => (m[p.category] = (m[p.category] || 0) + 1, m), {});
  if (catHost) catHost.innerHTML = (settings.categories || []).map((c, i) => `
    <a class="cat-card reveal reveal-d${(i % 3) + 1}" href="#products" data-cat="${esc(c.id)}">
      <span class="cat-card__count">${counts[c.id] || 0}</span>
      <span class="cat-card__ic">${icon(c.icon || 'chip', 24)}</span>
      <h3>${esc(c.name)}</h3>
      <p>${esc(c.desc || '')}</p>
      <span class="cat-card__more">Browse ${icon('arrow', 15)}</span>
    </a>`).join('');

  /* ---------- latest products ---------- */
  const latestHost = document.querySelector('[data-latest]');
  const latest = products.filter(p => p.isNew).concat(products.filter(p => !p.isNew)).slice(0, 8);
  if (latestHost) latestHost.innerHTML = latest.map((p, i) => card(p, sym, (i % 4) + 1)).join('');

  /* ---------- offers ---------- */
  const offersHost = document.querySelector('[data-offers]');
  if (offersHost) {
    const live = (settings.offers || []).filter(o => o.published !== false);
    if (!live.length) {
      offersHost.innerHTML = '<div class="empty" style="grid-column:1/-1"><strong>No active offers</strong>Check back soon.</div>';
    } else {
      offersHost.innerHTML = live.map((o, i) => {
        const big = i === 0;
        const inner = `
          <span class="offer__tag">${esc(o.tag || 'Offer')}</span>
          <h3>${esc(o.title)}</h3>
          <p>${esc(o.text || '')}</p>
          <div class="offer__row">
            ${o.price ? `<span class="offer__price">${sym}${esc(o.price)}</span>` : ''}
            ${o.oldPrice ? `<span class="offer__was">${sym}${esc(o.oldPrice)}</span>` : ''}
            ${o.code ? `<span class="offer__code">${esc(o.code)}</span>` : ''}
            <a class="btn btn--light btn--sm" href="${esc(o.link || 'product.html?id=' + (products[0] ? products[0].id : ''))}">View offer ${icon('arrow', 15)}</a>
          </div>`;
        if (big) return `<div class="offer reveal ${o.style === 'blue' ? 'offer--alt' : ''}">${inner}</div>`;
        return `<div class="offer offer--small reveal reveal-d${Math.min(i, 3)} ${o.style === 'blue' ? 'offer--alt' : ''}">${inner}</div>`;
      }).reduce((acc, html, i) => {
        if (i === 1) return acc + `<div class="offer__stack">` + html;
        if (i === live.length - 1 && live.length > 1) return acc + html + `</div>`;
        return acc + html;
      }, '');
    }
  }

  /* ---------- video posts ---------- */
  const videoSection = document.querySelector('[data-video-section]');
  const videoHost = document.querySelector('[data-video-posts]');
  const videoId = u => { try { const x=new URL(u); if(x.hostname.includes('youtu.be')) return x.pathname.slice(1); return x.searchParams.get('v') || (x.pathname.includes('/embed/') ? x.pathname.split('/embed/')[1].split('/')[0] : ''); } catch { return ''; } };
  const videos = (settings.videos || []).filter(v => v.published !== false && videoId(v.url));
  if(videoSection && videoHost && videos.length){ videoSection.style.display='block'; videoHost.innerHTML=videos.map(v=>`<article class="offer"><div style="position:relative;padding-top:56.25%;margin-bottom:1rem"><iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId(v.url))}" title="${esc(v.title)}" loading="lazy" allowfullscreen style="position:absolute;inset:0;width:100%;height:100%;border:0;border-radius:12px"></iframe></div><h3>${esc(v.title)}</h3><p>${esc(v.description||'')}</p></article>`).join(''); }

  /* ---------- about ---------- */
  const about = settings.about || {};
  setText('[data-about-heading]', about.heading || '');
  setText('[data-about-body]', about.body || '');
  const aboutList = document.querySelector('[data-about-list]');
  if (aboutList && about.list) {
    aboutList.innerHTML = about.list.map(t => `<li>${icon('check', 17)}<span>${esc(t)}</span></li>`).join('');
  }
  const statGrid = document.querySelector('[data-stat-grid]');
  if (statGrid) statGrid.innerHTML = (settings.stats || []).map(s =>
    `<div class="stat reveal"><strong>${esc(s.value)}</strong><span>${esc(s.label)}</span></div>`).join('');

  /* ---------- catalogue: search / filter / sort ---------- */
  const grid = document.querySelector('[data-grid]');
  const searchInput = document.querySelector('[data-search-input]');
  const chipsHost = document.querySelector('[data-chips]');
  const sortSel = document.querySelector('[data-sort]');
  const countEl = document.querySelector('[data-result-count]');
  const state = { q: qs('q', ''), cat: qs('category', 'all'), sort: 'featured' };

  if (chipsHost) {
    chipsHost.innerHTML = [`<button class="chip is-active" data-chip="all">All products</button>`]
      .concat((settings.categories || []).map(c => `<button class="chip" data-chip="${esc(c.id)}">${esc(c.name)}</button>`)).join('');
  }

  function apply() {
    if (!grid) return;
    let list = products.slice();
    const q = state.q.trim().toLowerCase();
    if (state.cat !== 'all') list = list.filter(p => p.category === state.cat);
    if (q) {
      list = list.filter(p => [p.name, p.categoryName, p.shortDescription, p.description, (p.specs ? Object.values(p.specs).join(' ') : '')]
        .join(' ').toLowerCase().includes(q));
    }
    if (state.sort === 'price-asc') list.sort((a, b2) => a.price - b2.price);
    if (state.sort === 'price-desc') list.sort((a, b2) => b2.price - a.price);
    if (state.sort === 'rating') list.sort((a, b2) => (b2.rating || 0) - (a.rating || 0));
    if (state.sort === 'featured') list.sort((a, b2) => (b2.featured ? 1 : 0) - (a.featured ? 1 : 0));

    grid.innerHTML = list.length
      ? list.map((p, i) => card(p, sym, (i % 4) + 1)).join('')
      : `<div class="empty" style="grid-column:1/-1"><strong>No products match “${esc(state.q)}”</strong>Try a different word, or clear the filters.</div>`;
    if (countEl) countEl.textContent = `${list.length} product${list.length === 1 ? '' : 's'}`;
    chipsHost && chipsHost.querySelectorAll('.chip').forEach(c => c.classList.toggle('is-active', c.dataset.chip === state.cat));
    reveal(grid);
  }

  if (searchInput) {
    searchInput.value = state.q;
    const wrap = searchInput.closest('.toolbar__search');
    wrap && wrap.classList.toggle('has-value', !!searchInput.value);
    let t;
    searchInput.addEventListener('input', () => {
      state.q = searchInput.value;
      wrap && wrap.classList.toggle('has-value', !!searchInput.value);
      clearTimeout(t); t = setTimeout(apply, 140);
    });
    const clr = wrap && wrap.querySelector('.clr');
    clr && clr.addEventListener('click', () => { searchInput.value = ''; state.q = ''; wrap.classList.remove('has-value'); apply(); searchInput.focus(); });
  }
  sortSel && sortSel.addEventListener('change', () => { state.sort = sortSel.value; apply(); });
  chipsHost && chipsHost.addEventListener('click', e => {
    const chip = e.target.closest('[data-chip]');
    if (!chip) return;
    state.cat = chip.dataset.chip;
    apply();
  });
  document.querySelectorAll('[data-cat]').forEach(el => el.addEventListener('click', () => {
    state.cat = el.dataset.cat;
    apply();
    if (searchInput) searchInput.focus({ preventScroll: true });
  }));
  /* header mini search */
  document.querySelectorAll('[data-mini-search]').forEach(form => {
    form.addEventListener('submit', e => {
      e.preventDefault();
      const v = form.querySelector('input').value.trim();
      if (searchInput) { searchInput.value = v; state.q = v; }
      location.hash = '#products';
      apply();
    });
  });

  apply();
  reveal(document);

  /* contact form -> mailto fallback, no backend */
  const form = document.querySelector('[data-contact-form]');
  if (form) {
    form.addEventListener('submit', e => {
      e.preventDefault();
      const fd = new FormData(form);
      const msg = form.querySelector('[data-form-msg]');
      const name = String(fd.get('name') || '').trim();
      const email = String(fd.get('email') || '').trim();
      const topic = String(fd.get('topic') || 'General enquiry');
      const body = String(fd.get('message') || '').trim();
      if (!name || !email || !body) {
        msg.className = 'form__msg is-err';
        msg.textContent = 'Please fill in your name, email and message.';
        return;
      }
      const subject = `[Website] ${topic} — ${name}`;
      const text = `Name: ${name}\nEmail: ${email}\nTopic: ${topic}\n\n${body}`;
      window.location.href = `mailto:${b.email || ''}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`;
      msg.className = 'form__msg is-ok';
      msg.innerHTML = `Thanks, ${esc(name)}. Your email app should open with the message ready. Prefer WhatsApp? <a href="${waLink(b, text)}" target="_blank" rel="noopener">Send it instantly</a>.`;
      form.reset();
    });
    const waBtn = form.querySelector('[data-form-wa]');
    waBtn && waBtn.addEventListener('click', () => {
      const fd = new FormData(form);
      const text = `Hello, I'm ${fd.get('name') || ''}.\nTopic: ${fd.get('topic') || ''}\n${fd.get('message') || ''}`;
      window.open(waLink(b, text), '_blank', 'noopener');
    });
  }
});
