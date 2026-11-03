/* Product detail page controller (runs after app.js) */
document.addEventListener('DOMContentLoaded', async () => {
  const { money, esc, qs, loadData, card, reveal, waLink, stars } = ES;

  let data;
  try { data = await loadData(); }
  catch { document.querySelectorAll('[data-fatal]').forEach(el => { el.hidden = false; el.textContent = 'Catalogue data could not be loaded from data/*.json.'; }); return; }

  const { settings, products } = data;
  const b = settings.business || {};
  const sym = b.currencySymbol || '$';
  const id = qs('id');
  const p = products.find(x => x.id === id);

  document.querySelectorAll('[data-year]').forEach(el => el.textContent = new Date().getFullYear());
  document.querySelectorAll('[data-wa-link]').forEach(el => el.href = waLink(b));

  if (!p) {
    const miss = document.querySelector('[data-pdp-missing]');
    if (miss) miss.hidden = false;
    document.querySelector('[data-related]').innerHTML = products.slice(0, 4).map((x, i) => card(x, sym, i + 1)).join('');
    reveal(document);
    return;
  }

  document.title = `${p.name} — ELECTRONICS SELLING`;
  const metaDesc = document.querySelector('meta[name="description"]');
  if (metaDesc) metaDesc.content = p.shortDescription || p.name;
  document.querySelector('[data-crumb]').textContent = p.name;

  const set = (sel, val) => document.querySelectorAll(sel).forEach(el => { el.textContent = val; });

  set('[data-pdp-cat]', p.categoryName || p.category || '');
  set('[data-pdp-name]', p.name);
  set('[data-pdp-stars]', stars(p.rating));
  set('[data-pdp-rating]', p.rating || '');
  set('[data-pdp-reviews]', `(${p.reviews || 0} reviews)`);
  set('[data-pdp-sku]', 'SKU ' + (p.sku || p.id));
  set('[data-pdp-price]', money(p.price, sym));
  set('[data-pdp-desc]', p.description || p.shortDescription || '');
  set('[data-pdp-warranty]', 'Warranty included');
  set('[data-pdp-shipping]', 'Dispatch in 24–48h');

  const was = document.querySelector('[data-pdp-was]');
  if (was) was.textContent = p.oldPrice > p.price ? money(p.oldPrice, sym) : '';
  const off = document.querySelector('[data-pdp-off]');
  if (off) off.textContent = p.oldPrice > p.price ? `Save ${Math.round((1 - p.price / p.oldPrice) * 100)}%` : '';

  const stockEl = document.querySelector('[data-pdp-stock]');
  if (stockEl) {
    const n = Number(p.stock);
    if (n === 0) { stockEl.textContent = 'Out of stock'; stockEl.className = 'pill pill--off'; }
    else if (n <= 8) { stockEl.textContent = `Only ${n} left in stock`; stockEl.className = 'pill pill--off'; }
    else { stockEl.textContent = 'In stock — ready to ship'; stockEl.className = 'pill pill--ok'; }
  }

  const mainImg = document.querySelector('[data-pdp-image]');
  if (mainImg) { mainImg.src = p.image; mainImg.alt = p.name; }
  const thumbs = document.querySelector('[data-pdp-thumbs]');
  const gal = (p.gallery && p.gallery.length ? p.gallery : [p.image]).filter(Boolean);
  if (thumbs) {
    thumbs.innerHTML = gal.map((src, i) => `
      <button class="pdp__thumb ${i === 0 ? 'is-active' : ''}" type="button" data-src="${esc(src)}" aria-label="View image ${i + 1}">
        <img src="${esc(src)}" alt="" loading="lazy">
      </button>`).join('');
    thumbs.addEventListener('click', e => {
      const btn = e.target.closest('.pdp__thumb');
      if (!btn) return;
      thumbs.querySelectorAll('.pdp__thumb').forEach(t => t.classList.remove('is-active'));
      btn.classList.add('is-active');
      mainImg.src = btn.dataset.src;
    });
  }

  const specs = document.querySelector('[data-pdp-specs]');
  if (specs) {
    const rows = Object.entries(p.specs || {});
    specs.innerHTML = rows.length
      ? rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')
      : '';
    if (!rows.length) specs.hidden = true;
  }

  const order = `Hello ${b.name || ''}, I would like to order:\n\n• ${p.name}\n• Price: ${money(p.price, sym)}\n• SKU: ${p.sku || p.id}\n\nIs it in stock?`;
  const waBtn = document.querySelector('[data-pdp-wa]');
  if (waBtn) waBtn.href = waLink(b, order);
  const mailBtn = document.querySelector('[data-pdp-mail]');
  if (mailBtn) {
    mailBtn.href = `mailto:${b.email || ''}?subject=${encodeURIComponent('Enquiry: ' + p.name)}&body=${encodeURIComponent(order)}`;
  }

  const pdp = document.querySelector('[data-pdp]');
  if (pdp) pdp.hidden = false;

  const related = products
    .filter(x => x.id !== p.id && x.category === p.category)
    .concat(products.filter(x => x.id !== p.id && x.category !== p.category))
    .slice(0, 4);
  const relHost = document.querySelector('[data-related]');
  if (relHost) relHost.innerHTML = related.map((x, i) => card(x, sym, i + 1)).join('');

  reveal(document);
});
