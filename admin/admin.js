/* ============================================================
   ELECTRONICS SELLING — admin dashboard
   Writes content to GitHub through the REST Contents API.

   SECURITY MODEL (read carefully):
   • The token lives in a module-scoped variable only. It is never
     written to localStorage, sessionStorage, cookies or any file.
   • The passphrase gate is client-side only — cosmetic, not auth.
   • Real protection: a fine-grained GitHub PAT scoped to ONE
     repository with Contents: Read and write, plus a short expiry.
   • A static site cannot authenticate anyone server-side. Put this
     path behind Cloudflare Access (or keep the repo private) if you
     need a hard guarantee.
   ============================================================ */
(() => {
  'use strict';

  /* Client-side gate: SHA-256 of the passphrase. Default: electronics-admin */
  const GATE_HASH = '6d471af6b9aea3dbd2ee2b3d42839f324caee4c04b670dcce9130fa134ca50dd';
  let ADMIN_PASSWORD = '';
  const API = '/api';

  const DEFAULT_CATEGORIES = [
    { id: 'smartphones', name: 'Smartphones', icon: 'phone' },
    { id: 'laptops', name: 'Laptops & Computers', icon: 'laptop' },
    { id: 'televisions', name: 'Televisions', icon: 'tv' },
    { id: 'audio', name: 'Speakers & Headphones', icon: 'audio' },
    { id: 'accessories', name: 'Chargers & Accessories', icon: 'plug' },
    { id: 'equipment', name: 'Electronic Equipment', icon: 'chip' }
  ];

  /* ---------- state (token deliberately NOT persisted) ---------- */
  const S = {
    token: '',
    owner: '',
    repo: '',
    branch: '',
    defaultBranch: '',
    basePath: 'data',
    connected: false,
    products: [],
    settings: {},
    sha: { products: null, settings: null },
    pendingImages: {},   // productId -> dataURL
    draft: { products: null, settings: null },
    log: []
  };

  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const el = (tag, props = {}, html = '') => {
    const n = document.createElement(tag);
    Object.assign(n, props);
    if (html) n.innerHTML = html;
    return n;
  };

  /* ---------- base64 helpers (UTF-8 safe) ---------- */
  function b64encode(text) {
    const bytes = new TextEncoder().encode(text);
    let bin = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(bin);
  }
  function b64decode(b64) {
    const clean = String(b64).replace(/[\r\n\s]/g, '');
    const bin = atob(clean);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder('utf-8').decode(bytes);
  }
  function dataUrlToBase64(dataUrl) {
    const m = /^data:[^;]+;base64,([\s\S]+)$/.exec(dataUrl || '');
    return m ? m[1] : '';
  }
  async function sha256Hex(str) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'item';

  /* ---------- alerts / log ---------- */
  let alertTimer;
  function flash(kind, msg) {
    const node = kind === 'ok' ? $('#appAlertOk') : $('#appAlertErr');
    const other = kind === 'ok' ? $('#appAlertErr') : $('#appAlertOk');
    other.classList.remove('is-on');
    node.textContent = msg;
    node.classList.add('is-on');
    clearTimeout(alertTimer);
    alertTimer = setTimeout(() => node.classList.remove('is-on'), 6000);
  }
  function logLine(msg, kind = '') {
    S.log.unshift({ msg, kind, at: new Date().toLocaleTimeString() });
    S.log = S.log.slice(0, 40);
    const host = $('#commitLog');
    if (!host) return;
    host.innerHTML = S.log.map(l =>
      `<div class="${l.kind}">[${esc(l.at)}] ${esc(l.msg)}</div>`).join('') || '<div>No activity in this session.</div>';
  }

  /* ---------- GitHub API ---------- */
  function headers() {
    return {
      'Content-Type': 'application/json',
      'x-admin-password': ADMIN_PASSWORD
    };
  }

  async function ghFetch(path, init = {}) {
    const res = await fetch(API + '/github?path=' + encodeURIComponent(path), {
      ...init,
      headers: { ...headers(), ...(init.headers || {}) }
    });
    let body = null;
    const text = await res.text();
    if (text) { try { body = JSON.parse(text); } catch { body = { message: text }; } }
    if (!res.ok) {
      const msg = body && body.message ? body.message : `HTTP ${res.status}`;
      const err = new Error(msg);
      err.status = res.status;
      err.body = body;
      throw err;
    }
    return body;
  }

  /* read a file: returns { text, sha } or null when missing */
  async function readFile(path) {
    try {
      const data = await ghFetch(`/repos/${S.owner}/${S.repo}/contents/${encodeURI(path)}?ref=${encodeURIComponent(S.branch)}`);
      if (Array.isArray(data)) return null;
      return { text: b64decode(data.content || ''), sha: data.sha };
    } catch (e) {
      if (e.status === 404) return null;
      throw e;
    }
  }

  /* serialized commit queue — prevents 409 sha conflicts */
  let chain = Promise.resolve();
  function queue(fn) {
    const next = chain.then(fn, fn);
    chain = next.catch(() => {});
    return next;
  }

  async function writeFile(path, text, message, isBinary = false) {
    return queue(async () => {
      const target = path;
      const existing = await readFile(target);
      const body = {
        message,
        content: isBinary ? text : b64encode(text),
        branch: S.branch
      };
      if (existing) body.sha = existing.sha;
      try {
        const out = await ghFetch(`/repos/${S.owner}/${S.repo}/contents/${encodeURI(target)}`, {
          method: 'PUT',
          body: JSON.stringify(body)
        });
        logLine(`Committed ${target} (${out.commit && out.commit.sha ? out.commit.sha.slice(0, 7) : 'ok'})`, 'ok');
        return out;
      } catch (e) {
        if (e.status === 409) {
          // sha moved under us: re-read and retry once
          const fresh = await readFile(target);
          const retryBody = { message, content: body.content, branch: S.branch };
          if (fresh) retryBody.sha = fresh.sha;
          const out = await ghFetch(`/repos/${S.owner}/${S.repo}/contents/${encodeURI(target)}`, {
            method: 'PUT',
            body: JSON.stringify(retryBody)
          });
          logLine(`Committed ${target} after conflict retry`, 'ok');
          return out;
        }
        throw e;
      }
    });
  }

  async function deleteFile(path, message) {
    return queue(async () => {
      const existing = await readFile(path);
      if (!existing) return null;
      const out = await ghFetch(`/repos/${S.owner}/${S.repo}/contents/${encodeURI(path)}`, {
        method: 'DELETE',
        body: JSON.stringify({ message, sha: existing.sha, branch: S.branch })
      });
      logLine(`Deleted ${path}`, 'ok');
      return out;
    });
  }

  /* ---------- persistence helpers ---------- */
  const productsPath = () => `${S.basePath}/products.json`;
  const settingsPath = () => `${S.basePath}/settings.json`;

  async function saveProducts(message) {
    const payload = { updated: new Date().toISOString().slice(0, 10), items: S.products };
    const text = JSON.stringify(payload, null, 2);
    if (!S.connected) { S.draft.products = text; return; }
    await writeFile(productsPath(), text, message);
    S.draft.products = null;
  }
  async function saveSettings(message) {
    S.settings.updated = new Date().toISOString().slice(0, 10);
    const text = JSON.stringify(S.settings, null, 2);
    if (!S.connected) { S.draft.settings = text; return; }
    await writeFile(settingsPath(), text, message);
    S.draft.settings = null;
  }

  async function uploadImage(dataUrl, name) {
    const b64 = dataUrlToBase64(dataUrl);
    const path = `images/uploads/${Date.now()}-${slug(name)}.${(dataUrl.match(/^data:image\/(\w+)/) || [, 'png'])[1].replace('jpeg', 'jpg')}`;
    await writeFile(path, b64, `admin: upload image ${path}`, true);
    return path;
  }

  /* ---------- connection ---------- */
  async function connect(withToken = true) {
    S.owner = $('#owner').value.trim();
    S.repo = $('#repo').value.trim();
    S.branch = $('#branch').value.trim();
    S.basePath = ($('#basePath').value.trim() || 'data').replace(/^\/|\/$/g, '');
    if (!S.owner || !S.repo) return flash('err', 'Repository owner and name are required.');

    if (withToken) $('#btnConnect').disabled = true, $('#btnConnect').textContent = 'Connecting…';
    try {
      const repo = await ghFetch(`/repos/${S.owner}/${S.repo}`);
      S.defaultBranch = repo.default_branch || 'main';
      if (!S.branch) S.branch = S.defaultBranch;
      S.connected = true;
      renderConnInfo(repo);
      $('#connBadge').className = 'badge badge--ok';
      $('#connBadge').innerHTML = '<span class="dot"></span> Connected';
      $('#btnReload').disabled = false;
      logLine(`Connected to ${S.owner}/${S.repo}@${S.branch}`, 'ok');
      if (withToken) await loadAll();
      flash('ok', withToken ? 'Connected and catalogue loaded.' : 'Connection verified.');
    } catch (e) {
      S.connected = false;
      $('#connBadge').className = 'badge badge--err';
      $('#connBadge').innerHTML = '<span class="dot"></span> Not connected';
      const hint = e.status === 401 ? 'Admin password or server GitHub credentials are invalid.'
        : e.status === 403 ? 'GitHub credentials lack repository permission.'
        : e.status === 404 ? 'Repository not found, or the token cannot see it.'
        : e.message;
      flash('err', `Connection failed: ${hint}`);
      logLine(`Connection failed: ${hint}`, 'err');
    } finally {
      $('#btnConnect').disabled = false;
      $('#btnConnect').textContent = 'Connect & load catalogue';
    }
  }

  function renderConnInfo(repo) {
    const rows = [
      ['Repository', `${S.owner}/${S.repo}`],
      ['Branch', S.branch],
      ['Default branch', S.defaultBranch],
      ['Visibility', repo ? (repo.private ? 'Private' : 'Public') : '—'],
      ['Authentication', 'Cloudflare protected']
    ];
    $('#connInfo').innerHTML = rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');
  }

  async function loadAll() {
    try {
      const [p, s] = await Promise.all([readFile(productsPath()), readFile(settingsPath())]);
      if (p) {
        try {
          const parsed = JSON.parse(p.text);
          S.products = Array.isArray(parsed) ? parsed : (parsed.items || []);
          S.sha.products = p.sha;
        } catch { throw new Error('products.json is not valid JSON'); }
      } else {
        S.products = [];
        logLine('products.json not found in the repository — a new one will be created on first save', '');
      }
      if (s) {
        try { S.settings = JSON.parse(s.text); S.sha.settings = s.sha; }
        catch { throw new Error('settings.json is not valid JSON'); }
      } else {
        S.settings = { business: {}, categories: DEFAULT_CATEGORIES, offers: [], announcements: [], hero: {}, about: {}, stats: [] };
      }
      renderAll();
      flash('ok', `Loaded ${S.products.length} products and site settings.`);
    } catch (e) {
      flash('err', `Could not read content files: ${e.message}. Check the content folder (“${S.basePath}”).`);
      logLine(`Load failed: ${e.message}`, 'err');
    }
  }

  /* ---------- rendering ---------- */
  function categories() {
    return (S.settings.categories && S.settings.categories.length) ? S.settings.categories : DEFAULT_CATEGORIES;
  }
  const catName = id => (categories().find(c => c.id === id) || {}).name || id;

  function renderAll() { renderProducts(); renderOffers(); renderBusiness(); renderCategories(); }

  function renderProducts() {
    const q = ($('#productSearch') && $('#productSearch').value || '').toLowerCase().trim();
    const cat = $('#productCatFilter') && $('#productCatFilter').value;
    const pub = $('#productPubFilter') && $('#productPubFilter').value;
    const rows = S.products.filter(p => {
      if (cat && p.category !== cat) return false;
      if (pub === 'published' && p.published === false) return false;
      if (pub === 'draft' && p.published !== false) return false;
      if (!q) return true;
      return `${p.name} ${p.sku} ${p.categoryName || ''} ${p.category}`.toLowerCase().includes(q);
    });
    const host = $('#productRows');
    if (!host) return;
    host.innerHTML = rows.length ? rows.map(p => `
      <tr>
        <td><img class="t-img" src="../${esc(p.image || '')}" alt="" onerror="this.style.opacity=.25"></td>
        <td><b>${esc(p.name)}</b><div class="small muted">${esc(p.sku || p.id)}</div></td>
        <td>${esc(catName(p.category))}</td>
        <td><b>${esc(p.price)}</b>${p.oldPrice ? `<div class="small muted"><s>${esc(p.oldPrice)}</s></div>` : ''}</td>
        <td>${esc(p.stock ?? 0)}</td>
        <td>${p.published === false ? '<span class="badge badge--warn">Draft</span>' : '<span class="badge badge--ok">Live</span>'}</td>
        <td>
          <div class="row-actions">
            <button class="btn btn--ghost btn--sm" data-act="toggle" data-id="${esc(p.id)}">${p.published === false ? 'Publish' : 'Unpublish'}</button>
            <button class="btn btn--ghost btn--sm" data-act="edit" data-id="${esc(p.id)}">Edit</button>
            <button class="btn btn--danger btn--sm" data-act="del" data-id="${esc(p.id)}">Delete</button>
          </div>
        </td>
      </tr>`).join('') : `<tr><td colspan="7"><div class="empty">No products match this filter.</div></td></tr>`;

    const count = $('#productCount');
    if (count) count.textContent = `${S.products.length} product${S.products.length === 1 ? '' : 's'} in the catalogue · ${S.products.filter(p => p.published !== false).length} published`;
  }

  function renderCategories() {
    const sel = $('#pfCategory');
    if (sel) {
      const current = sel.value;
      sel.innerHTML = categories().map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
      if (current) sel.value = current;
    }
    const filter = $('#productCatFilter');
    if (filter) {
      const cur = filter.value;
      filter.innerHTML = '<option value="">All categories</option>' +
        categories().map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
      filter.value = cur || '';
    }
  }

  function renderOffers() {
    const host = $('#offerRows');
    if (!host) return;
    const offers = S.settings.offers || [];
    host.innerHTML = offers.length ? offers.map((o, i) => `
      <tr>
        <td><b>${esc(o.title)}</b><div class="small muted">${esc((o.text || '').slice(0, 70))}</div></td>
        <td>${esc(o.tag || '')}</td>
        <td>${o.price ? esc(o.price) : '—'}</td>
        <td><span class="mono">${esc(o.code || '')}</span></td>
        <td>${o.published === false ? '<span class="badge badge--warn">Hidden</span>' : '<span class="badge badge--ok">Live</span>'}</td>
        <td><div class="row-actions">
          <button class="btn btn--ghost btn--sm" data-oact="toggle" data-i="${i}">${o.published === false ? 'Publish' : 'Unpublish'}</button>
          <button class="btn btn--ghost btn--sm" data-oact="edit" data-i="${i}">Edit</button>
          <button class="btn btn--danger btn--sm" data-oact="del" data-i="${i}">Delete</button>
        </div></td>
      </tr>`).join('') : `<tr><td colspan="6"><div class="empty">No offers yet — add one to fill the “Special offers” section.</div></td></tr>`;
    const ta = $('#announcements');
    if (ta) ta.value = (S.settings.announcements || []).join('\n');
    const at = $('#announceText');
    if (at) at.value = (S.settings.business && S.settings.business.announcement) || '';
  }

  function renderVideos() {
    const host = $('#videoRows'); if (!host) return;
    const videos = S.settings.videos || [];
    host.innerHTML = videos.length ? videos.map((v,i)=>`<div class="card" style="margin-top:10px"><b>${esc(v.title)}</b><p>${esc(v.url)}</p><button class="btn btn--danger btn--sm" data-vdel="${i}">Delete</button></div>`).join('') : '<p>No videos published yet.</p>';
    host.querySelectorAll('[data-vdel]').forEach(b=>b.addEventListener('click', async()=>{ S.settings.videos.splice(Number(b.dataset.vdel),1); await saveSettings('admin: delete video post'); renderVideos(); }));
  }
  async function publishVideo() {
    const title=$('#videoTitle').value.trim(), url=$('#videoUrl').value.trim(), description=$('#videoDescription').value.trim();
    if(!title || !url || !/(youtube\.com\/watch\?v=|youtu\.be\/)/i.test(url)) return flash('err','Enter a title and a valid YouTube video link.');
    S.settings.videos=S.settings.videos||[]; S.settings.videos.unshift({id:'video-'+Date.now(),title,url,description,published:true});
    try { await saveSettings('admin: publish video'); $('#videoTitle').value=''; $('#videoUrl').value=''; $('#videoDescription').value=''; renderVideos(); flash('ok','Video published on the website.'); }
    catch(e){ flash('err','Video save failed: '+e.message); }
  }

  function renderBusiness() {
    const b = (S.settings.business = S.settings.business || {});
    const soc = (b.social = b.social || {});
    const map = {
      bizName: b.name, bizTagline: b.tagline, bizPhone: b.phone, bizWhatsapp: b.whatsapp,
      bizEmail: b.email, bizHours: b.hours, bizAddress: b.address, bizMap: b.mapQuery,
      bizWaMsg: b.whatsappMessage, socFacebook: soc.facebook, socInstagram: soc.instagram,
      socX: soc.x, socYoutube: soc.youtube, socTiktok: soc.tiktok
    };
    Object.entries(map).forEach(([id, v]) => { const n = $('#' + id); if (n) n.value = v || ''; });
    const about = (S.settings.about = S.settings.about || {});
    if ($('#aboutHeading')) $('#aboutHeading').value = about.heading || '';
    if ($('#aboutBody')) $('#aboutBody').value = about.body || '';
    if ($('#aboutList')) $('#aboutList').value = (about.list || []).join('\n');
  }

  /* ---------- product modal ---------- */
  function specRow(k = '', v = '') {
    const row = el('div', { className: 'rowline rowline--spec' });
    row.innerHTML = `<input type="text" placeholder="Specification" value="${esc(k)}">
      <input type="text" placeholder="Value" value="${esc(v)}">
      <button class="icon-x" type="button" aria-label="Remove row">✕</button>`;
    row.querySelector('.icon-x').addEventListener('click', () => row.remove());
    return row;
  }

  let editingId = null;
  function openProduct(id) {
    editingId = id || null;
    const p = id ? S.products.find(x => x.id === id) : null;
    $('#pmTitle').textContent = p ? 'Edit product' : 'New product';
    $('#pfId').value = p ? p.id : '';
    $('#pfName').value = p ? p.name : '';
    $('#pfSku').value = p ? (p.sku || '') : '';
    renderCategories();
    $('#pfCategory').value = p ? p.category : categories()[0].id;
    $('#pfStock').value = p ? (p.stock ?? 0) : 10;
    $('#pfPrice').value = p ? p.price : '';
    $('#pfOldPrice').value = p && p.oldPrice ? p.oldPrice : '';
    $('#pfRating').value = p ? (p.rating || 0) : 4.5;
    $('#pfReviews').value = p ? (p.reviews || 0) : 0;
    $('#pfShort').value = p ? (p.shortDescription || '') : '';
    $('#pfLong').value = p ? (p.description || '') : '';
    $('#pfImage').value = p ? (p.image || '') : '';
    $('#pfPublished').checked = p ? p.published !== false : true;
    $('#pfFeatured').checked = !!(p && p.featured);
    $('#pfNew').checked = !!(p && p.isNew);
    $('#pfImageFile').value = '';
    $('#pfUploadState').innerHTML = 'Images upload to <span class="mono">images/uploads/</span> when you save. Max ~1MB each.';
    const specsHost = $('#pfSpecs');
    specsHost.innerHTML = '';
    const entries = p && p.specs ? Object.entries(p.specs) : [['', '']];
    entries.forEach(([k, v]) => specsHost.appendChild(specRow(k, v)));
    updatePreview();
    $('#productModal').classList.add('is-open');
    setTimeout(() => $('#pfName').focus(), 60);
  }

  function updatePreview() {
    const v = $('#pfImage').value.trim();
    const img = $('#pfPreview');
    if (!img) return;
    img.src = v ? '../' + v.replace(/^\.?\//, '') : '';
    img.alt = v || 'No image';
  }

  async function saveProduct() {
    const name = $('#pfName').value.trim();
    const price = Number($('#pfPrice').value);
    if (!name) return flash('err', 'A product name is required.');
    if (!isFinite(price) || price < 0) return flash('err', 'Enter a valid price.');

    const oldPrice = Number($('#pfOldPrice').value) || 0;
    const id = $('#pfId').value || slug(name);
    const cat = $('#pfCategory').value;
    const specs = {};
    $$('#pfSpecs .rowline').forEach(r => {
      const [k, v] = r.querySelectorAll('input');
      if (k.value.trim()) specs[k.value.trim()] = v.value.trim();
    });

    const btn = $('#btnSaveProduct');
    btn.disabled = true;
    btn.textContent = 'Saving…';
    try {
      let image = $('#pfImage').value.trim();
      const file = $('#pfImageFile').files[0];
      if (file) {
        if (file.size > 1024 * 1024) throw new Error('Image is larger than 1MB — compress it first.');
        if (!S.connected) throw new Error('Connect to GitHub before uploading images.');
        const dataUrl = await new Promise((res, rej) => {
          const fr = new FileReader();
          fr.onload = () => res(fr.result);
          fr.onerror = rej;
          fr.readAsDataURL(file);
        });
        image = await uploadImage(dataUrl, file.name);
        $('#pfImage').value = image;
      }

      const record = {
        id,
        name,
        sku: $('#pfSku').value.trim() || 'ES-' + id.toUpperCase().replace(/-/g, '').slice(0, 10),
        category: cat,
        categoryName: catName(cat),
        price,
        oldPrice: oldPrice > price ? oldPrice : 0,
        currency: (S.settings.business && S.settings.business.currency) || 'USD',
        shortDescription: $('#pfShort').value.trim(),
        description: $('#pfLong').value.trim(),
        image: image || 'images/products/placeholder.svg',
        gallery: [image || 'images/products/placeholder.svg', 'images/banners/hero.svg'],
        specs,
        rating: Number($('#pfRating').value) || 0,
        reviews: Number($('#pfReviews').value) || 0,
        stock: Number($('#pfStock').value) || 0,
        featured: $('#pfFeatured').checked,
        isNew: $('#pfNew').checked,
        published: $('#pfPublished').checked,
        createdAt: (S.products.find(x => x.id === id) || {}).createdAt || new Date().toISOString().slice(0, 10)
      };

      const idx = S.products.findIndex(x => x.id === id);
      if (idx >= 0) S.products[idx] = { ...S.products[idx], ...record };
      else S.products.unshift(record);

      await saveProducts(idx >= 0 ? `admin: update product “${name}”` : `admin: add product “${name}”`);
      renderProducts();
      $('#productModal').classList.remove('is-open');
      flash('ok', S.connected
        ? `Saved “${name}”. GitHub Pages will show it after the next deploy.`
        : `“${name}” is held in memory. Download products.json or connect to GitHub to publish.`);
    } catch (e) {
      flash('err', `Save failed: ${e.message}`);
      logLine(`Save failed: ${e.message}`, 'err');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Save & commit';
    }
  }

  async function deleteProduct(id) {
    const p = S.products.find(x => x.id === id);
    if (!p) return;
    if (!confirm(`Delete “${p.name}”? This commits the removal to GitHub.`)) return;
    S.products = S.products.filter(x => x.id !== id);
    renderProducts();
    try {
      await saveProducts(`admin: delete product “${p.name}”`);
      flash('ok', `Deleted “${p.name}”.`);
    } catch (e) { flash('err', `Delete failed: ${e.message}`); }
  }

  async function toggleProduct(id) {
    const p = S.products.find(x => x.id === id);
    if (!p) return;
    p.published = p.published === false;
    renderProducts();
    try {
      await saveProducts(`admin: ${p.published ? 'publish' : 'unpublish'} “${p.name}”`);
      flash('ok', `“${p.name}” is now ${p.published ? 'published' : 'a draft'}.`);
    } catch (e) { flash('err', `Update failed: ${e.message}`); }
  }

  /* ---------- offers ---------- */
  let editingOffer = -1;
  function openOffer(i) {
    editingOffer = typeof i === 'number' ? i : -1;
    const o = editingOffer >= 0 ? (S.settings.offers || [])[editingOffer] || {} : {};
    $('#omTitle').textContent = editingOffer >= 0 ? 'Edit offer' : 'New offer';
    $('#ofTag').value = o.tag || 'Limited';
    $('#ofTitle').value = o.title || '';
    $('#ofText').value = o.text || '';
    $('#ofPrice').value = o.price || '';
    $('#ofOldPrice').value = o.oldPrice || '';
    $('#ofCode').value = o.code || '';
    $('#ofStyle').value = o.style || 'navy';
    $('#ofLink').value = o.link || '#products';
    $('#ofPublished').checked = o.published !== false;
    $('#offerModal').classList.add('is-open');
    setTimeout(() => $('#ofTitle').focus(), 60);
  }

  async function saveOffer() {
    const title = $('#ofTitle').value.trim();
    if (!title) return flash('err', 'An offer headline is required.');
    const record = {
      id: (editingOffer >= 0 && (S.settings.offers[editingOffer] || {}).id) || 'offer-' + Date.now(),
      tag: $('#ofTag').value.trim(),
      title,
      text: $('#ofText').value.trim(),
      price: $('#ofPrice').value.trim(),
      oldPrice: $('#ofOldPrice').value.trim(),
      code: $('#ofCode').value.trim(),
      style: $('#ofStyle').value,
      link: $('#ofLink').value.trim() || '#products',
      published: $('#ofPublished').checked
    };
    S.settings.offers = S.settings.offers || [];
    if (editingOffer >= 0) S.settings.offers[editingOffer] = record;
    else S.settings.offers.unshift(record);
    const btn = $('#btnSaveOffer');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      await saveSettings(`admin: ${editingOffer >= 0 ? 'update' : 'add'} offer “${title}”`);
      renderOffers();
      $('#offerModal').classList.remove('is-open');
      flash('ok', S.connected ? 'Offer saved and committed.' : 'Offer held in memory. Download settings.json or connect to publish.');
    } catch (e) { flash('err', `Save failed: ${e.message}`); }
    finally { btn.disabled = false; btn.textContent = 'Save & commit'; }
  }

  async function offerAction(act, i) {
    const offers = S.settings.offers || [];
    const o = offers[i];
    if (!o) return;
    if (act === 'edit') return openOffer(i);
    if (act === 'del') {
      if (!confirm(`Delete the offer “${o.title}”?`)) return;
      offers.splice(i, 1);
      renderOffers();
      try { await saveSettings(`admin: delete offer “${o.title}”`); flash('ok', 'Offer deleted.'); }
      catch (e) { flash('err', `Delete failed: ${e.message}`); }
      return;
    }
    if (act === 'toggle') {
      o.published = o.published === false;
      renderOffers();
      try { await saveSettings(`admin: ${o.published ? 'publish' : 'unpublish'} offer “${o.title}”`); flash('ok', 'Offer status updated.'); }
      catch (e) { flash('err', `Update failed: ${e.message}`); }
    }
  }

  /* ---------- business ---------- */
  async function saveBusiness() {
    const b = (S.settings.business = S.settings.business || {});
    b.name = $('#bizName').value.trim();
    b.tagline = $('#bizTagline').value.trim();
    b.phone = $('#bizPhone').value.trim();
    b.whatsapp = $('#bizWhatsapp').value.replace(/[^\d]/g, '');
    b.email = $('#bizEmail').value.trim();
    b.hours = $('#bizHours').value.trim();
    b.address = $('#bizAddress').value.trim();
    b.mapQuery = $('#bizMap').value.trim();
    b.whatsappMessage = $('#bizWaMsg').value.trim();
    b.social = b.social || {};
    b.social.facebook = $('#socFacebook').value.trim();
    b.social.instagram = $('#socInstagram').value.trim();
    b.social.x = $('#socX').value.trim();
    b.social.youtube = $('#socYoutube').value.trim();
    b.social.tiktok = $('#socTiktok').value.trim();

    S.settings.about = S.settings.about || {};
    S.settings.about.heading = $('#aboutHeading').value.trim();
    S.settings.about.body = $('#aboutBody').value.trim();
    S.settings.about.list = $('#aboutList').value.split('\n').map(s => s.trim()).filter(Boolean);

    const btn = $('#btnSaveBusiness');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      await saveSettings('admin: update business information');
      flash('ok', S.connected ? 'Business information saved and committed.' : 'Saved in memory. Download settings.json or connect to publish.');
    } catch (e) { flash('err', `Save failed: ${e.message}`); }
    finally { btn.disabled = false; btn.textContent = 'Save business information'; }
  }

  async function saveAnnouncements() {
    S.settings.announcements = $('#announcements').value.split('\n').map(s => s.trim()).filter(Boolean);
    S.settings.business = S.settings.business || {};
    S.settings.business.announcement = $('#announceText').value.trim();
    try {
      await saveSettings('admin: update announcements');
      flash('ok', 'Announcements saved.');
    } catch (e) { flash('err', `Save failed: ${e.message}`); }
  }

  /* ---------- export / import ---------- */
  function download(name, text) {
    const blob = new Blob([text], { type: 'application/json' });
    const a = el('a', { href: URL.createObjectURL(blob), download: name });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  /* ---------- view switching ---------- */
  const VIEWS = {
    connect: ['Repository connection', 'Connect this dashboard to the GitHub repository that stores your catalogue.'],
    products: ['Products', 'Add, edit, publish and delete the products shown on the public site.'],
    offers: ['Offers &amp; advertisements', 'Manage the offer cards and announcement strip.'],
    business: ['Business information', 'Contact details, social links and the About section.'],
    videos: ['Video posts', 'Publish and remove videos shown on the public website.'],
    help: ['Setup &amp; security', 'One-time GitHub setup and the limits of browser-based tokens.']
  };
  function showView(name) {
    $$('.side__link[data-view]').forEach(b => b.classList.toggle('is-active', b.dataset.view === name));
    $$('[data-panel]').forEach(p => p.classList.toggle('hidden', p.dataset.panel !== name));
    const [t, s] = VIEWS[name] || VIEWS.connect;
    $('#viewTitle').innerHTML = t;
    $('#viewSub').textContent = s;
    if (name === 'products') renderProducts();
    if (name === 'offers') renderOffers();
    if (name === 'business') renderBusiness();
    if (name === 'videos') renderVideos();
  }

  /* ---------- wire up ---------- */
  document.addEventListener('DOMContentLoaded', () => {
    /* gate */
    const gateForm = $('#gateForm');
    gateForm.addEventListener('submit', async e => {
      e.preventDefault();
      const pass = $('#gatePass').value;
      try {
        const auth = await fetch('/api/login', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({password:pass})});
        if (!auth.ok) throw new Error('Incorrect admin password.');
        ADMIN_PASSWORD = pass;
        $('#gate').classList.add('hidden');
        $('#app').classList.remove('hidden');
        $('#gateAlert').classList.remove('is-on');
      } catch (err) {
        const a = $('#gateAlert'); a.textContent = err.message || 'Login failed.'; a.classList.add('is-on'); $('#gatePass').select();
      }
    });

    /* connection */
    $('#connForm').addEventListener('submit', e => { e.preventDefault(); connect(true); });
    $('#btnTest').addEventListener('click', () => connect(false));
    $('#btnReload').addEventListener('click', loadAll);
    $('#btnSignOut').addEventListener('click', () => {
      ADMIN_PASSWORD = '';
      S.token = '';
      S.connected = false;
      S.products = []; S.settings = {};
      $('#app').classList.add('hidden');
      $('#gate').classList.remove('hidden');
      $('#connBadge').className = 'badge';
      $('#connBadge').innerHTML = '<span class="dot"></span> Not connected';
      logLine('Session ended — token cleared from memory', '');
      flash('ok', 'Signed out. The token has been cleared from this tab.');
    });

    /* nav */
    $$('.side__link[data-view]').forEach(b => b.addEventListener('click', () => showView(b.dataset.view)));

    $('#btnPublishVideo').addEventListener('click', publishVideo);

    /* products */
    $('#btnNewProduct').addEventListener('click', () => openProduct(null));
    $('#btnProductRefresh').addEventListener('click', () => { if (S.connected) loadAll(); else { renderProducts(); flash('ok', 'Working set refreshed from memory.'); } });
    $('#btnSaveProduct').addEventListener('click', saveProduct);
    $('#pfAddSpec').addEventListener('click', () => $('#pfSpecs').appendChild(specRow()));
    $('#pfImage').addEventListener('input', updatePreview);
    $('#pfImageFile').addEventListener('change', e => {
      const f = e.target.files[0];
      if (!f) return;
      const fr = new FileReader();
      fr.onload = () => {
        $('#pfPreview').src = fr.result;
        $('#pfUploadState').innerHTML = `<b>${esc(f.name)}</b> (${Math.round(f.size / 1024)} KB) will be committed to <span class="mono">images/uploads/</span> on save.`;
      };
      fr.readAsDataURL(f);
    });
    $('#productSearch').addEventListener('input', renderProducts);
    $('#productCatFilter').addEventListener('change', renderProducts);
    $('#productPubFilter').addEventListener('change', renderProducts);
    $('#productRows').addEventListener('click', e => {
      const b = e.target.closest('button[data-act]');
      if (!b) return;
      const { act, id } = b.dataset;
      if (act === 'edit') openProduct(id);
      if (act === 'del') deleteProduct(id);
      if (act === 'toggle') toggleProduct(id);
    });

    /* offers */
    $('#btnNewOffer').addEventListener('click', () => openOffer());
    $('#btnSaveOffer').addEventListener('click', saveOffer);
    $('#offerRows').addEventListener('click', e => {
      const b = e.target.closest('button[data-oact]');
      if (!b) return;
      offerAction(b.dataset.oact, Number(b.dataset.i));
    });
    $('#btnSaveAnnouncements').addEventListener('click', saveAnnouncements);

    /* business */
    $('#btnSaveBusiness').addEventListener('click', saveBusiness);

    /* modals */
    $$('[data-close-modal]').forEach(n => n.addEventListener('click', () => {
      $('#productModal').classList.remove('is-open');
      $('#offerModal').classList.remove('is-open');
    }));
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        $('#productModal').classList.remove('is-open');
        $('#offerModal').classList.remove('is-open');
      }
    });

    /* export / import */
    $('#btnExportProducts').addEventListener('click', () => download('products.json', JSON.stringify({ updated: new Date().toISOString().slice(0, 10), items: S.products }, null, 2)));
    $('#btnExportSettings').addEventListener('click', () => download('settings.json', JSON.stringify(S.settings, null, 2)));
    $('#btnImport').addEventListener('click', () => $('#importFile').click());
    $('#importFile').addEventListener('change', e => {
      const f = e.target.files[0];
      if (!f) return;
      const fr = new FileReader();
      fr.onload = () => {
        try {
          const parsed = JSON.parse(fr.result);
          if (Array.isArray(parsed) || Array.isArray(parsed.items)) {
            S.products = Array.isArray(parsed) ? parsed : parsed.items;
            renderProducts();
            flash('ok', `Imported ${S.products.length} products into the working set.`);
          } else {
            S.settings = parsed;
            renderOffers(); renderBusiness(); renderCategories();
            flash('ok', 'Imported settings into the working set.');
          }
        } catch (err) { flash('err', `Import failed: ${err.message}`); }
      };
      fr.readAsText(f);
    });

    renderCategories();
    renderConnInfo(null);
    showView('connect');
  });
})();
