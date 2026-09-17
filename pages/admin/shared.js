// ── C-Auctions Admin — shared helpers ──
const API_BASE = 'https://consignment-auctions-api.morneydeetlefs.workers.dev/api';

function getKey() { return localStorage.getItem('cAuctionsAdminKey') || ''; }
function setKey(k) { localStorage.setItem('cAuctionsAdminKey', k); }
function clearKey() { localStorage.removeItem('cAuctionsAdminKey'); }

// Core fetch wrapper. Adds auth header, parses JSON, throws readable errors.
async function api(path, { method = 'GET', body, auth = true, isForm = false } = {}) {
  const headers = {};
  if (auth) headers['Authorization'] = 'Bearer ' + getKey();
  if (body && !isForm) headers['Content-Type'] = 'application/json';
  const res = await fetch(API_BASE + path, {
    method,
    headers,
    body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
  });
  let data;
  try { data = await res.json(); } catch { data = {}; }
  if (!res.ok) {
    if (res.status === 401) { clearKey(); location.href = 'index.html'; }
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

// Redirect to login if no key stored. Call at top of every protected page.
function requireAuth() {
  if (!getKey()) { location.href = 'index.html'; throw new Error('redirecting'); }
}

function logout() { clearKey(); location.href = 'index.html'; }

// ── Nav ──
function renderNav(active) {
  const slot = document.getElementById('nav-slot');
  if (!slot) return;
  const links = [
    ['index.html', 'Dashboard'],
    ['sellers.html', 'Sellers'],
    ['auctions.html', 'Auctions'],
    ['payments.html', 'Payments & payouts'],
    ['config.html', 'Settings'],
  ];
  slot.innerHTML = `
    <div class="sidebar">
      <div class="brand">C-Auctions <span>Admin</span></div>
      <nav class="mainnav">
        ${links.map(([href, label]) =>
          `<a href="${href}" class="${active === href ? 'active' : ''}">${label}</a>`
        ).join('')}
      </nav>
      <div class="sidebar-foot">
        <button class="secondary small" onclick="logout()">Log out</button>
      </div>
    </div>
  `;
}

// ── Small render helpers ──
function statusDot(status) {
  const s = (status || '').toLowerCase();
  return `<span class="dot-wrap"><span class="dot dot-${s}"></span>${escapeHtml(status || '—')}</span>`;
}

function formatMoney(n) {
  if (n == null || isNaN(n)) return '—';
  return 'R' + Number(n).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(s) {
  if (!s) return '—';
  const d = new Date(s.includes('T') || s.includes(' ') ? s.replace(' ', 'T') + (s.endsWith('Z') ? '' : 'Z') : s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' }) +
    ' ' + d.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' });
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function imageUrl(key) {
  return key ? `${API_BASE}/images/${key}` : '';
}

// ── Toast ──
let toastTimer = null;
function toast(msg, type = '') {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.className = 'toast show' + (type ? ' ' + type : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, 3200);
}

// Wrap an async handler so errors surface as a toast instead of a silent failure.
function guard(fn) {
  return async (...args) => {
    try { return await fn(...args); }
    catch (e) { if (e.message !== 'redirecting') toast(e.message, 'error'); }
  };
}
