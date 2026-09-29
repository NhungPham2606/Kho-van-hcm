// Dung menu trai tu KVH_MENU (assets/flows.js) cho moi trang.
(function () {
  const base = document.documentElement.dataset.base || '';
  const ICONS = window.KVH_ICONS || {};
  const MENU = window.KVH_MENU || [];
  const aside = document.getElementById('sidebar');
  if (!aside) return;
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const svg = (name, size = 20) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`;
  const chev = '<svg class="chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>';
  const norm = p => p.replace(/index\.html$/, '');
  const url = href => new URL(base + href, location.href);
  let openGroups = {};
  try { openGroups = JSON.parse(localStorage.getItem('kvh-open') || '{}'); } catch (e) {}

  function render() {
    const here = norm(location.pathname);
    const hash = location.hash;
    let html = `
      <a class="sb-logo" href="${base || './'}">
        <img src="${base}assets/logo.png" alt="CPC1HN" onerror="this.hidden=true;this.nextElementSibling.hidden=false">
        <span class="sb-logo-text" hidden>CPC<b>1</b>HN</span>
        <span class="sb-unit">Kho vận HCM</span>
      </a><ul class="sb-menu">`;
    MENU.forEach((g, gi) => {
      if (!g.muc) {
        const active = norm(url(g.href).pathname) === here;
        html += `<li><a class="sb-item${active ? ' active' : ''}" href="${(base + (g.href || '')) || './'}">${svg(g.icon)}${esc(g.ten)}</a></li>`;
        return;
      }
      let groupActive = false;
      const items = g.muc.map((m, mi) => {
        const u = url(m.href);
        const samePage = norm(u.pathname) === here;
        const active = samePage && (u.hash === hash || (!hash && mi === 0));
        if (samePage) groupActive = true;
        return `<li><a class="sb-child${active ? ' active' : ''}" href="${base}${m.href}">${esc(m.ten)}</a></li>`;
      }).join('');
      const open = groupActive || openGroups[g.ten];
      html += `<li class="sb-group${open ? ' open' : ''}" data-g="${esc(g.ten)}">
        <button class="sb-item sb-toggle${groupActive ? ' active' : ''}" type="button" aria-expanded="${open ? 'true' : 'false'}">${svg(g.icon)}${esc(g.ten)}${chev}</button>
        <ul class="sb-children">${items}</ul></li>`;
    });
    html += `</ul><div class="sb-foot">CPC1HN · Chi nhánh HCM</div>`;
    aside.innerHTML = html;
    aside.querySelectorAll('.sb-toggle').forEach(btn => btn.addEventListener('click', () => {
      const li = btn.parentElement;
      const open = !li.classList.contains('open');
      li.classList.toggle('open', open);
      btn.setAttribute('aria-expanded', open);
      openGroups[li.dataset.g] = open;
      try { localStorage.setItem('kvh-open', JSON.stringify(openGroups)); } catch (e) {}
    }));
    aside.querySelectorAll('a').forEach(a => a.addEventListener('click', () => document.body.classList.remove('sb-open')));
  }
  render();
  window.addEventListener('hashchange', render);

  const btn = document.querySelector('.menu-btn');
  if (btn) btn.addEventListener('click', () => document.body.classList.toggle('sb-open'));
  const ov = document.querySelector('.sb-overlay');
  if (ov) ov.addEventListener('click', () => document.body.classList.remove('sb-open'));
})();
