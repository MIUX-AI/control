import { upload as uploadToBlob } from "https://esm.sh/@vercel/blob@1.1.1/client?bundle";

/* ═══════════════════════════════════════════════════════════
   MIUX STUDIO — app.js v4.0
   • Login via httpOnly session cookie
   • Upload foto + video → Vercel Blob client upload
   • Auto-refresh + smart polling
   • Video player & download langsung
   • Sembunyikan URL internal
═══════════════════════════════════════════════════════════ */

/* ══ STATE ══ */
const state = {
  sessionKey: null,
  session: null,
  dashboard: null,
  activeTab: null,
  loginMode: 'user',
  unlockClicks: 0,
  unlockTimer: null,
  pollTimer: null,
  imageUrl: null,
  videoUrl: null,
  taskFilter: 'ALL',
  keyFilter: 'ALL'
};

/* ══ PARTICLES ══ */
const pField = document.getElementById('particles');
for (let i = 0; i < 22; i++) {
  const p = document.createElement('div');
  p.className = 'p';
  const dur = 4 + Math.random() * 5, delay = Math.random() * dur;
  const dx = (Math.random() - 0.5) * 90, sz = 1 + Math.random() * 2;
  p.style.cssText = `left:${Math.random()*100}%;bottom:${Math.random()*35}%;width:${sz}px;height:${sz}px;--px:${dx}px;animation:pFloat ${dur}s ease-out ${delay}s infinite;`;
  pField.appendChild(p);
}

/* ══ CLOCK ══ */
setInterval(() => {
  const c = document.getElementById('dnavClock');
  if (c) c.textContent = new Date().toLocaleTimeString('id-ID', { hour12: false });
}, 1000);

/* ══ HUD TICKER ══ */
const units = ['MX-01', 'AX-7F', 'CR-22', 'NX-0B', 'MX-01'];
let uIdx = 0;
setInterval(() => {
  const e = document.getElementById('hudUnit');
  if (e) e.textContent = units[uIdx++ % units.length];
}, 4200);

/* ══ TOAST ══ */
let toastTm;
function toast(msg, ok = true) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast show' + (ok ? '' : ' bad');
  clearTimeout(toastTm);
  toastTm = setTimeout(() => el.classList.remove('show'), 3200);
}

/* ══ UPLOAD VEIL ══ */
function showUpload(label, sub) {
  document.getElementById('uploadIco').textContent = '⬆';
  document.getElementById('uploadTitle').textContent = label || 'Mengunggah file…';
  document.getElementById('uploadSub').textContent = sub || 'Mohon tunggu sebentar';
  document.getElementById('uploadFill').style.width = '5%';
  document.getElementById('uploadPct').textContent = '5%';
  document.getElementById('uploadVeil').classList.add('show');
}
function setUploadPct(pct) {
  document.getElementById('uploadFill').style.width = pct + '%';
  document.getElementById('uploadPct').textContent = Math.round(pct) + '%';
}
function hideUpload() {
  setUploadPct(100);
  setTimeout(() => {
    document.getElementById('uploadVeil').classList.remove('show');
    document.getElementById('uploadFill').style.width = '0%';
    document.getElementById('uploadPct').textContent = '0%';
  }, 400);
}

/* ══ FLASH TRANSITION ══ */
function flashGo(fn) {
  const flash = document.getElementById('flash');
  flash.style.transition = 'none';
  flash.style.opacity = '0';
  flash.style.background = 'var(--lime)';
  requestAnimationFrame(() => requestAnimationFrame(() => {
    flash.style.transition = 'opacity 0.18s ease-out';
    flash.style.opacity = '0.9';
    setTimeout(() => {
      fn();
      flash.style.transition = 'opacity 0.55s ease-in';
      flash.style.opacity = '0';
    }, 160);
  }));
}

/* ══ VIEW TRANSITIONS ══ */
function goToLogin() {
  flashGo(() => {
    document.getElementById('viewWelcome').style.opacity = '0';
    document.getElementById('viewWelcome').style.pointerEvents = 'none';
    document.getElementById('viewLogin').classList.add('active');
    setLoginMode(state.loginMode);
  });
}
function goToWelcome() {
  flashGo(() => {
    document.getElementById('viewLogin').classList.remove('active');
    document.getElementById('viewDashboard').classList.remove('active');
    document.getElementById('viewWelcome').style.opacity = '1';
    document.getElementById('viewWelcome').style.pointerEvents = 'all';
    stopPolling();
  });
}
function goToDashboard() {
  flashGo(() => {
    document.getElementById('viewLogin').classList.remove('active');
    document.getElementById('viewWelcome').style.opacity = '0';
    document.getElementById('viewWelcome').style.pointerEvents = 'none';
    document.getElementById('viewDashboard').classList.add('active');
    initDashboard();
  });
}

/* ══ LOGIN MODE ══ */
function setLoginMode(mode) {
  state.loginMode = mode;
  document.getElementById('modeUserBtn').classList.toggle('active', mode === 'user');
  document.getElementById('modeAdminBtn').classList.toggle('active', mode === 'admin');
  document.getElementById('lcardTitle').textContent = mode === 'admin' ? 'Admin Portal' : 'Selamat Datang';
  document.getElementById('lcardSub').textContent = mode === 'admin' ? 'MASUKKAN KEY ADMIN' : 'MASUKKAN ACCESS KEY ANDA';
  document.getElementById('lcardBadge').textContent = mode === 'admin' ? 'SUDO' : 'MX-01';
  document.getElementById('loginStatusTxt').textContent = mode === 'admin' ? 'ADMIN AUTH' : 'AUTHENTICATING';
}

window.goToLogin = goToLogin;
window.goToWelcome = goToWelcome;
window.setLoginMode = setLoginMode;

/* ══ UNLOCK ADMIN (klik logo 5x) ══ */
function unlockAdmin() {
  state.unlockClicks++;
  clearTimeout(state.unlockTimer);
  state.unlockTimer = setTimeout(() => { state.unlockClicks = 0; }, 1500);
  if (state.unlockClicks >= 5) {
    document.getElementById('modeAdminBtn').style.display = '';
    document.getElementById('loginAdminHint').textContent = 'Mode admin tersedia. Gunakan key admin untuk masuk.';
    toast('Mode admin terbuka');
    state.unlockClicks = 0;
  }
}
document.getElementById('brandUnlock').addEventListener('click', unlockAdmin);
// Sembunyikan tombol admin awalnya
document.getElementById('modeAdminBtn').style.display = 'none';

/* ══ TERMINAL ══ */
const termLines = ['$ sys.init — menunggu autentikasi', '$ conn.secure — TLS 1.3 aktif', '$ model.load — MIUX-CORE v3.0', '$ session.ready — standby'];
let termIdx = 0;
function termLog(custom) {
  const el = document.getElementById('ltermLine');
  if (el) el.innerHTML = (custom || termLines[termIdx++ % termLines.length]) + '<span class="lcursor"></span>';
}
setInterval(() => termLog(), 4200);

/* ══ API ══ */
async function api(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (!headers['Content-Type'] && opts.body && !(opts.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(path, {
    credentials: 'same-origin',
    ...opts,
    headers
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) {
      state.session = null;
    }
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data;
}

/* ══ LOGIN ══ */
async function handleLogin() {
  const key = document.getElementById('loginKey').value.trim();
  if (!key) { toast('Access key wajib diisi', false); return; }

  const btn = document.getElementById('loginSubmit');
  btn.classList.add('loading');
  termLog('$ auth.init — memverifikasi key…');

  try {
    const res = await fetch('/api/auth/validate', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

    state.session = {
      role: data.role,
      name: data.name,
      user: data.user || null
    };
    termLog(`$ auth.ok — ${data.role} session aktif`);
    toast(`✓ Masuk sebagai ${data.name || data.role}`);
    setTimeout(() => goToDashboard(), 500);
  } catch (err) {
    toast(err.message, false);
    termLog('$ auth.fail — ' + err.message);
    document.getElementById('loginKey').value = '';
  }
  btn.classList.remove('loading');
}

async function handleLogout() {
  stopPolling();
  state.sessionKey = null;
  state.session = null;
  state.dashboard = null;
  try {
    await api('/api/auth/logout', { method: 'POST' });
  } catch (_) {}
  goToWelcome();
}

document.getElementById('loginSubmit').addEventListener('click', handleLogin);
document.getElementById('loginKey').addEventListener('keydown', e => { if (e.key === 'Enter') handleLogin(); });
document.getElementById('modeUserBtn').addEventListener('click', () => setLoginMode('user'));
document.getElementById('modeAdminBtn').addEventListener('click', () => setLoginMode('admin'));
document.getElementById('dnavLogout').addEventListener('click', handleLogout);

/* ══ UPLOAD FILE → VERCEL BLOB CLIENT UPLOAD ══ */
function sanitizePathSegment(name) {
  return String(name || 'file')
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 100) || 'file';
}

async function uploadFile(file, kind) {
  const safeName = sanitizePathSegment(file.name);
  const pathname = `kling/${kind}/${Date.now()}-${safeName}`;
  const blob = await uploadToBlob(pathname, file, {
    access: 'public',
    handleUploadUrl: '/api/uploads/blob',
    clientPayload: JSON.stringify({ kind })
  });
  return blob.url;
}

/* ══ SETUP UPLOAD ZONES ══ */
function setupUploadZone(zoneId, inputId, statusId, field) {
  const zone = document.getElementById(zoneId);
  const input = document.getElementById(inputId);
  const status = document.getElementById(statusId);

  async function handleFile(file) {
    const isImage = field === 'image';
    const maxMB = isImage ? 10 : 50;
    if (file.size > maxMB * 1024 * 1024) {
      status.textContent = `✕ File terlalu besar (maks ${maxMB} MB)`;
      status.className = 'uz-status err';
      return;
    }

    const label = isImage ? 'Mengunggah foto…' : 'Mengunggah video…';
    showUpload(label, `${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB)`);

    // Fake progress
    let pct = 5;
    const prog = setInterval(() => {
      pct = Math.min(pct + 8, 80);
      setUploadPct(pct);
    }, 400);

    try {
      const url = await uploadFile(file, field);
      clearInterval(prog);
      setUploadPct(100);

      if (field === 'image') state.imageUrl = url;
      else state.videoUrl = url;

      zone.classList.add('done');
      document.getElementById(isImage ? 'imgZoneIcon' : 'vidZoneIcon').textContent = isImage ? '✅' : '✅';
      document.getElementById(isImage ? 'imgZoneTitle' : 'vidZoneTitle').textContent = file.name;
      status.textContent = `✓ Berhasil diunggah`;
      status.className = 'uz-status ok';
      toast(`✓ ${isImage ? 'Foto' : 'Video'} berhasil diunggah`);
    } catch (err) {
      clearInterval(prog);
      status.textContent = `✕ Gagal: ${err.message}`;
      status.className = 'uz-status err';
      toast(`✕ Upload gagal: ${err.message}`, false);
    }
    hideUpload();
    input.value = '';
  }

  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag'));
  zone.addEventListener('drop', async e => {
    e.preventDefault();
    zone.classList.remove('drag');
    const file = e.dataTransfer.files[0];
    if (file) await handleFile(file);
  });
  input.addEventListener('change', async () => {
    const file = input.files[0];
    if (file) await handleFile(file);
  });
}

setupUploadZone('imgZone', 'imageFile', 'imgStatus', 'image');
setupUploadZone('vidZone', 'videoFile', 'vidStatus', 'video');

/* ══ CFG RANGE ══ */
const cfgRange = document.getElementById('taskCfg');
const cfgDisplay = document.getElementById('cfgDisplay');
if (cfgRange) {
  cfgRange.addEventListener('input', () => {
    cfgDisplay.textContent = cfgRange.value;
  });
}

/* ══ CREATE TASK ══ */
document.getElementById('createTaskBtn').addEventListener('click', async () => {
  if (!state.imageUrl) { toast('Upload foto terlebih dahulu', false); return; }
  if (!state.videoUrl) { toast('Upload video referensi terlebih dahulu', false); return; }

  const btn = document.getElementById('createTaskBtn');
  btn.disabled = true;
  btn.querySelector('.action-btn-txt').textContent = '⟳ MENGIRIM…';

  try {
    await api('/api/tasks', {
      method: 'POST',
      body: JSON.stringify({
        title: document.getElementById('taskTitle').value.trim() || null,
        tier: document.getElementById('taskTier').value,
        character_orientation: document.getElementById('taskOrientation').value,
        cfg_scale: Number(document.getElementById('taskCfg').value),
        image_url: state.imageUrl,
        video_url: state.videoUrl,
        prompt: document.getElementById('taskPrompt').value.trim() || ''
      })
    });

    toast('✓ Proyek berhasil disubmit! Sedang diproses…');

    // Reset form
    document.getElementById('taskTitle').value = '';
    document.getElementById('taskPrompt').value = '';
    document.getElementById('taskTier').value = 'STD';
    document.getElementById('taskOrientation').value = 'VIDEO';
    document.getElementById('taskCfg').value = '0.5';
    cfgDisplay.textContent = '0.5';
    state.imageUrl = null;
    state.videoUrl = null;
    ['imgZone','vidZone'].forEach(id => document.getElementById(id).classList.remove('done'));
    document.getElementById('imgZoneIcon').textContent = '🖼';
    document.getElementById('vidZoneIcon').textContent = '🎬';
    document.getElementById('imgZoneTitle').textContent = 'Klik atau seret foto ke sini';
    document.getElementById('vidZoneTitle').textContent = 'Klik atau seret video ke sini';
    document.getElementById('imgStatus').textContent = '';
    document.getElementById('vidStatus').textContent = '';

    // Go to projects tab
    switchTab('projects');
    await loadDashboard(true);
  } catch (err) {
    toast('✕ ' + err.message, false);
  }

  btn.disabled = false;
  btn.querySelector('.action-btn-txt').textContent = '⬢ SUBMIT PROYEK';
});

/* ══ CREATE USER (admin) ══ */
document.getElementById('createUserBtn').addEventListener('click', async () => {
  const name = document.getElementById('newUserName').value.trim();
  const accessKey = document.getElementById('newUserKey').value.trim();
  if (!name || !accessKey) { toast('Nama user dan access key wajib diisi', false); return; }

  const btn = document.getElementById('createUserBtn');
  btn.disabled = true;
  try {
    await api('/api/admin/users', {
      method: 'POST',
      body: JSON.stringify({
        name,
        accessKey,
        accessStartsAt: document.getElementById('newUserStart').value || null,
        accessEndsAt: document.getElementById('newUserEnd').value || null,
        notes: document.getElementById('newUserNotes').value.trim(),
        isEnabled: true
      })
    });
    toast(`✓ User "${name}" berhasil dibuat`);
    ['newUserName','newUserKey','newUserStart','newUserEnd','newUserNotes'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    await loadDashboard(true);
  } catch (err) { toast('✕ ' + err.message, false); }
  btn.disabled = false;
});

/* ══ IMPORT KEYS (admin) ══ */
document.getElementById('importKeysBtn').addEventListener('click', async () => {
  const rawKeys = document.getElementById('bulkKeys').value.trim();
  if (!rawKeys) { toast('Masukkan minimal satu API key', false); return; }

  const btn = document.getElementById('importKeysBtn');
  btn.disabled = true;
  btn.querySelector('.action-btn-txt').textContent = '⟳ IMPORTING…';

  try {
    const result = await api('/api/keys/import', {
      method: 'POST',
      body: JSON.stringify({ rawKeys, labels: document.getElementById('bulkLabels').value })
    });
    toast(`✓ ${result.createdCount} key berhasil diimport`);
    document.getElementById('bulkKeys').value = '';
    document.getElementById('bulkLabels').value = '';
    await loadDashboard(true);
  } catch (err) { toast('✕ ' + err.message, false); }

  btn.disabled = false;
  btn.querySelector('.action-btn-txt').textContent = '⬤ IMPORT KEYS';
});

/* ══ TEST ALL KEYS ══ */
document.getElementById('testAllBtn').addEventListener('click', async () => {
  try {
    toast('⬡ Menguji semua key…');
    await api('/api/keys/test-all', { method: 'POST' });
    toast('✓ Semua key telah diuji');
    await loadDashboard(true);
  } catch (err) { toast('✕ ' + err.message, false); }
});

/* ══ TAB NAVIGATION ══ */
function switchTab(tabId) {
  state.activeTab = tabId;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tabId));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('hidden', p.id !== 'tab-' + tabId));
}

/* ══ DASHBOARD INIT ══ */
function initDashboard() {
  loadDashboard();
  startPolling();
}

function stopPolling() {
  if (state.pollTimer) { clearInterval(state.pollTimer); state.pollTimer = null; }
}

function startPolling(ms = 12000) {
  stopPolling();
  state.pollTimer = setInterval(() => {
    if (state.session) loadDashboard(true).catch(() => {});
  }, ms);
}

async function loadDashboard(silent = false) {
  try {
    const data = await api('/api/dashboard');
    state.dashboard = data;
    renderDashboard(data);
    updateNavStatus('online');

    // Faster polling if active tasks
    const active = data.summary?.tasks?.active || 0;
    if (active > 0) startPolling(7000);
    else startPolling(12000);
  } catch (err) {
    if (!silent) toast('✕ Gagal memuat dashboard: ' + err.message, false);
    updateNavStatus('error');
  }
}

function updateNavStatus(s) {
  const dot = document.getElementById('dnavDot');
  const txt = document.getElementById('dnavStatusTxt');
  if (dot) dot.style.background = s === 'error' ? 'var(--red)' : 'var(--lime)';
  if (txt) txt.textContent = s === 'error' ? 'ERROR' : 'LIVE';
}

/* ══ RENDER ══ */
function renderDashboard(data) {
  const isAdmin = data.session?.role === 'admin';
  const sum = data.summary || {};

  // Nav user info
  const dnavUser = document.getElementById('dnavUser');
  if (dnavUser) dnavUser.textContent = (isAdmin ? '⬡ ' : '◈ ') + (data.session?.name || '—');

  // Alert bar
  const alertBar = document.getElementById('alertBar');
  if (alertBar) {
    if (!isAdmin && data.resultUrlTtlMs) {
      alertBar.classList.remove('hidden');
      alertBar.textContent = '⚠ Hasil video hanya berlaku 1 jam setelah selesai. Segera tonton atau unduh sebelum link kedaluwarsa.';
    } else {
      alertBar.classList.add('hidden');
    }
  }

  // Stats
  renderStats(isAdmin, sum);

  // Build tabs
  const tabs = isAdmin
    ? [{ id: 'overview', lbl: '◈ Overview' }, { id: 'projects', lbl: '◉ Proyek' }, { id: 'users', lbl: '⬡ Users' }, { id: 'api', lbl: '⬤ API Pool' }]
    : [{ id: 'create', lbl: '⬢ Buat' }, { id: 'projects', lbl: '◉ Proyek' }];

  const tabBar = document.getElementById('tabNav');
  if (tabBar) {
    if (!tabBar.children.length || tabBar.dataset.role !== data.session?.role) {
      tabBar.dataset.role = data.session?.role;
      tabBar.innerHTML = tabs.map(t =>
        `<button class="tab-btn ${state.activeTab === t.id ? 'active' : ''}" data-tab="${t.id}">${t.lbl}</button>`
      ).join('');
      tabBar.querySelectorAll('.tab-btn').forEach(b => {
        b.addEventListener('click', () => switchTab(b.dataset.tab));
      });
    }
    // Ensure valid tab
    if (!state.activeTab || !tabs.find(t => t.id === state.activeTab)) {
      state.activeTab = tabs[0].id;
    }
    tabBar.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === state.activeTab));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('hidden', p.id !== 'tab-' + state.activeTab));
  }

  // Render panels
  renderTasks(data.tasks || []);
  if (isAdmin) {
    renderUsers(data.users || []);
    renderKeys(data.keys || []);
    renderOverview(data);
  }

  // Projects count badge
  const pc = document.getElementById('projectsCount');
  if (pc) pc.textContent = `${(data.tasks || []).length} proyek`;
}

/* ── STATS ── */
function renderStats(isAdmin, sum) {
  const items = isAdmin
    ? [
        { lbl: 'Users Aktif', val: sum.users?.active ?? 0 },
        { lbl: 'Total User', val: sum.users?.total ?? 0 },
        { lbl: 'Key Sehat', val: sum.keys?.healthy ?? 0 },
        { lbl: 'Key Cooldown', val: (sum.keys?.cooldown ?? 0) + (sum.keys?.rateLimited ?? 0) },
        { lbl: 'Task Aktif', val: sum.tasks?.active ?? 0, bold: true },
        { lbl: 'Task Selesai', val: sum.tasks?.completed ?? 0 }
      ]
    : [
        { lbl: 'Task Aktif', val: sum.tasks?.active ?? 0, bold: true },
        { lbl: 'Task Selesai', val: sum.tasks?.completed ?? 0 },
        { lbl: 'Task Gagal', val: sum.tasks?.failed ?? 0, bad: true },
        { lbl: 'Total Proyek', val: sum.tasks?.total ?? 0 }
      ];

  const el = document.getElementById('statsGrid');
  if (el) el.innerHTML = items.map(s =>
    `<div class="stat-card${s.bad ? ' bad' : ''}"><div class="stat-val">${s.val}</div><div class="stat-lbl">${s.lbl}</div></div>`
  ).join('');
}

/* ── TASKS ── */
function renderTasks(tasks) {
  const el = document.getElementById('tasksList');
  if (!el) return;

  const filtered = tasks.filter(t => {
    if (state.taskFilter === 'ALL') return true;
    if (state.taskFilter === 'ACTIVE') return ['PENDING','SUBMITTED','PROCESSING'].includes(t.status);
    if (state.taskFilter === 'COMPLETED') return t.status === 'COMPLETED';
    if (state.taskFilter === 'FAILED') return t.status === 'FAILED' || t.resultExpired;
    return true;
  });

  if (!filtered.length) {
    el.innerHTML = `<div class="empty-state"><div class="empty-ico">◉</div>Tidak ada proyek${state.taskFilter !== 'ALL' ? ' dengan filter ini' : ''}.</div>`;
    return;
  }

  el.innerHTML = filtered.map(task => taskCard(task)).join('');
}

function statusClass(t) {
  if (t.resultExpired) return 's-expired';
  return 's-' + (t.status || 'unknown').toLowerCase();
}

function statusPill(t) {
  const lbl = t.resultExpired ? 'KEDALUWARSA' : (t.status || 'UNKNOWN');
  const cls = t.resultExpired ? 'sp-expired' : 'sp-' + (t.status || 'unknown').toLowerCase();
  return `<span class="spill ${cls}">${esc(lbl)}</span>`;
}

function taskCard(t) {
  const title = t.title || `${t.tier} Motion Task`;
  const isActive = ['PENDING','SUBMITTED','PROCESSING'].includes(t.status);
  const hasResult = t.resultAvailable && t.resultUrl;
  const owner = t.owner?.name;

  let noticeHtml = '';
  if (t.resultExpired) {
    noticeHtml = `<div class="task-notice">⚠ Hasil video telah kedaluwarsa dan tidak bisa diakses lagi. Buat proyek baru jika diperlukan.</div>`;
  } else if (hasResult && t.resultExpiresAt) {
    noticeHtml = `<div class="task-notice">⏱ Unduh sebelum <b>${fmtDate(t.resultExpiresAt)}</b> — link hasil hanya berlaku 1 jam unduh sebelum kadaluwarsa.</div>`;
  } else if (t.status === 'COMPLETED' && !hasResult) {
    noticeHtml = `<div class="task-notice">✓ Selesai diproses — link hasil belum tersedia atau sudah dibersihkan.</div>`;
  } else if (isActive) {
    noticeHtml = `<div class="task-notice">⟳ Sedang diproses oleh AI. Halaman ini akan otomatis diperbarui.</div>`;
  }

  return `
<div class="task-card ${statusClass(t)}">
  <div class="task-top">
    <div style="min-width:0;flex:1">
      <div class="task-name">${esc(title)}</div>
      <div class="task-id">${t.id}</div>
    </div>
    ${statusPill(t)}
  </div>

  <div class="task-meta">
    <div class="task-meta-item"><b>Tier:</b> ${t.tier}</div>
    <div class="task-meta-item"><b>Orient:</b> ${t.characterOrientation}</div>
    <div class="task-meta-item"><b>CFG:</b> ${t.cfgScale}</div>
    <div class="task-meta-item"><b>Remote:</b> ${esc(t.remoteStatus || '—')}</div>
    ${owner ? `<div class="task-meta-item"><b>User:</b> ${esc(owner)}</div>` : ''}
    <div class="task-meta-item"><b>Dibuat:</b> ${fmtDate(t.createdAt)}</div>
  </div>

  ${t.errorMessage && !t.resultExpired ? `<div class="task-err">✕ ${esc(t.errorMessage.slice(0, 250))}</div>` : ''}
  ${noticeHtml}

  ${hasResult ? `
  <div class="task-video-wrap">
    <div class="task-video-label">▶ Hasil Video</div>
    <video class="task-video" controls playsinline preload="metadata" src="${esc(t.resultUrl)}"></video>
  </div>` : ''}

  <div class="task-actions">
    ${hasResult ? `<a class="task-btn primary" href="${esc(t.resultUrl)}" target="_blank" rel="noreferrer">▶ Tonton</a>` : ''}
    ${hasResult ? `<a class="task-btn dl" href="${esc(t.resultUrl)}" download>⬇ Unduh</a>` : ''}
    ${isActive ? `<button class="task-btn" onclick="syncTask('${t.id}')">⟳ Perbarui</button>` : ''}
  </div>
</div>`;
}

/* ── USERS ── */
function renderUsers(users) {
  const el = document.getElementById('usersList');
  if (!el) return;
  if (!users.length) {
    el.innerHTML = `<div class="empty-state"><div class="empty-ico">⬡</div>Belum ada user. Buat user baru di atas.</div>`;
    return;
  }
  el.innerHTML = users.map(u => `
<div class="user-card" data-uid="${u.id}">
  <div class="user-card-top">
    <div>
      <div class="user-name">${esc(u.name)}</div>
      <div class="user-mask">${esc(u.accessKeyMasked)} • ${u.taskCount || 0} proyek</div>
    </div>
    <span class="spill ${u.isActiveNow ? 'sp-live' : 'sp-off'}">${u.isActiveNow ? 'AKTIF' : 'NONAKTIF'}</span>
  </div>

  <div class="form-2col">
    <div class="form-field">
      <label class="flabel">Nama</label>
      <input class="finput" data-f="name" type="text" value="${esc(u.name)}">
    </div>
    <div class="form-field">
      <label class="flabel">Key Baru <span class="fopt">Kosongkan jika tidak ganti</span></label>
      <input class="finput" data-f="accessKey" type="text" placeholder="—">
    </div>
    <div class="form-field">
      <label class="flabel">Aktif Mulai</label>
      <input class="finput" data-f="accessStartsAt" type="datetime-local" value="${toLocal(u.accessStartsAt)}">
    </div>
    <div class="form-field">
      <label class="flabel">Aktif Sampai</label>
      <input class="finput" data-f="accessEndsAt" type="datetime-local" value="${toLocal(u.accessEndsAt)}">
    </div>
    <div class="form-field full">
      <label class="flabel">Catatan</label>
      <textarea class="finput ftextarea" data-f="notes" rows="2">${esc(u.notes || '')}</textarea>
    </div>
  </div>

  <div class="user-actions">
    <button class="task-btn" onclick="saveUser('${u.id}')">💾 Simpan</button>
    <button class="task-btn" onclick="toggleUser('${u.id}', ${!u.isEnabled})">${u.isEnabled ? '✕ Nonaktifkan' : '✓ Aktifkan'}</button>
    <button class="task-btn danger" onclick="deleteUser('${u.id}')">🗑 Hapus</button>
  </div>
</div>`).join('');
}

/* ── KEYS ── */
function renderKeys(keys) {
  const el = document.getElementById('keysList');
  const cnt = document.getElementById('keysCount');
  if (cnt) cnt.textContent = `${keys.length} key`;
  if (!el) return;

  const filtered = state.keyFilter === 'ALL' ? keys : keys.filter(k => k.status === state.keyFilter);

  if (!filtered.length) {
    el.innerHTML = `<div class="empty-state"><div class="empty-ico">⬤</div>Tidak ada key${state.keyFilter !== 'ALL' ? ' dengan filter ini' : ''}.</div>`;
    return;
  }

  const sClass = s => {
    const m = { HEALTHY: 'sp-healthy', COOLDOWN: 'sp-cooldown', INVALID: 'sp-invalid', LIKELY_EXHAUSTED: 'sp-likely_exhausted', RATE_LIMITED: 'sp-cooldown' };
    return m[s] || 'sp-unknown';
  };

  el.innerHTML = filtered.map(k => `
<div class="key-card">
  <div class="key-info">
    <div class="key-lbl">${esc(k.label || 'Unnamed')}</div>
    <div class="key-mask">${esc(k.apiKeyMasked)}</div>
    <div class="key-stat">✓${k.successCount} | Streak ✕${k.failureStreak} &nbsp;<span class="spill ${sClass(k.status)}" style="font-size:7px">${k.status}</span></div>
  </div>
  <div class="key-acts">
    <button class="kbtn" onclick="testKey('${k.id}')">TEST</button>
    <button class="kbtn" onclick="toggleKey('${k.id}')">${k.isEnabled ? 'OFF' : 'ON'}</button>
    <button class="kbtn del" onclick="deleteKey('${k.id}')">DEL</button>
  </div>
</div>`).join('');
}

/* ── OVERVIEW (admin) ── */
function renderOverview(data) {
  const el = document.getElementById('adminOverviewContent');
  if (!el) return;
  const tasks = (data.tasks || []).slice(0, 6);
  const keys = (data.keys || []).slice(0, 6);

  el.innerHTML = `
<div class="ov-item">
  <div class="ov-title">Proyek Terbaru</div>
  ${tasks.length ? tasks.map(t => `
  <div class="ov-row">
    <b>${esc(t.owner?.name || 'Admin')}</b>
    <span style="flex:1;text-align:center;padding:0 8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(t.title || t.id.slice(0, 12))}</span>
    <span class="spill sp-${(t.status||'').toLowerCase()}" style="font-size:7px">${t.status}</span>
  </div>`).join('') : '<div class="ov-row">Belum ada proyek.</div>'}
</div>
<div class="ov-item">
  <div class="ov-title">Status API Key</div>
  ${keys.length ? keys.map(k => `
  <div class="ov-row">
    <b>${esc(k.label || k.apiKeyMasked)}</b>
    <span style="flex:1;text-align:right;padding-right:8px">${k.isEnabled ? '✓' : '✕'}</span>
    <span class="spill" style="font-size:7px;color:var(--muted)">${k.status}</span>
  </div>`).join('') : '<div class="ov-row">Belum ada API key.</div>'}
</div>`;
}

/* ══ FILTER BUTTONS ══ */
document.querySelectorAll('[data-tfilter]').forEach(b => {
  b.addEventListener('click', () => {
    document.querySelectorAll('[data-tfilter]').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    state.taskFilter = b.dataset.tfilter;
    renderTasks(state.dashboard?.tasks || []);
  });
});

document.querySelectorAll('[data-kfilter]').forEach(b => {
  b.addEventListener('click', () => {
    document.querySelectorAll('[data-kfilter]').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    state.keyFilter = b.dataset.kfilter;
    renderKeys(state.dashboard?.keys || []);
  });
});

/* ══ GLOBAL ACTIONS ══ */
window.syncTask = async (id) => {
  try {
    toast('⟳ Memperbarui task…');
    await api(`/api/tasks/${id}/sync`, { method: 'POST' });
    await loadDashboard(true);
    toast('✓ Task diperbarui');
  } catch (e) { toast('✕ ' + e.message, false); }
};

window.saveUser = async (id) => {
  const root = document.querySelector(`[data-uid="${id}"]`);
  if (!root) return;
  try {
    await api(`/api/admin/users/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        name: root.querySelector('[data-f="name"]').value.trim(),
        accessKey: root.querySelector('[data-f="accessKey"]').value.trim() || undefined,
        accessStartsAt: root.querySelector('[data-f="accessStartsAt"]').value || null,
        accessEndsAt: root.querySelector('[data-f="accessEndsAt"]').value || null,
        notes: root.querySelector('[data-f="notes"]').value.trim()
      })
    });
    toast('✓ User berhasil diperbarui');
    await loadDashboard(true);
  } catch (e) { toast('✕ ' + e.message, false); }
};

window.toggleUser = async (id, isEnabled) => {
  try {
    await api(`/api/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify({ isEnabled }) });
    toast('✓ Status user diubah');
    await loadDashboard(true);
  } catch (e) { toast('✕ ' + e.message, false); }
};

window.deleteUser = async (id) => {
  if (!confirm('Hapus user ini? Semua proyek miliknya tetap tersimpan.')) return;
  try {
    await api(`/api/admin/users/${id}`, { method: 'DELETE' });
    toast('✓ User dihapus');
    await loadDashboard(true);
  } catch (e) { toast('✕ ' + e.message, false); }
};

window.testKey = async (id) => {
  try {
    toast('⬡ Menguji key…');
    await api(`/api/keys/${id}/test`, { method: 'POST' });
    toast('✓ Key diuji');
    await loadDashboard(true);
  } catch (e) { toast('✕ ' + e.message, false); }
};

window.toggleKey = async (id) => {
  try {
    await api(`/api/keys/${id}/toggle`, { method: 'PATCH' });
    await loadDashboard(true);
  } catch (e) { toast('✕ ' + e.message, false); }
};

window.deleteKey = async (id) => {
  if (!confirm('Hapus API key ini?')) return;
  try {
    await api(`/api/keys/${id}`, { method: 'DELETE' });
    toast('✓ Key dihapus');
    await loadDashboard(true);
  } catch (e) { toast('✕ ' + e.message, false); }
};

/* ══ HELPERS ══ */
function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function fmtDate(v) {
  if (!v) return '—';
  const d = new Date(v);
  if (isNaN(d)) return '—';
  return d.toLocaleDateString('id-ID', { day:'2-digit', month:'2-digit', year:'2-digit' }) + ' ' + d.toLocaleTimeString('id-ID', { hour:'2-digit', minute:'2-digit', hour12:false });
}

function toLocal(v) {
  if (!v) return '';
  const d = new Date(v);
  if (isNaN(d)) return '';
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/* ══ AUTO-RESTORE SESSION ══ */
(async function init() {
  setLoginMode('user');
  try {
    const data = await api('/api/session');
    if (!data?.session) return;
    state.session = data.session;
    await loadDashboard();
    startPolling();
    document.getElementById('viewDashboard').classList.add('active');
    document.getElementById('viewWelcome').style.opacity = '0';
    document.getElementById('viewWelcome').style.pointerEvents = 'none';
  } catch {
    state.session = null;
  }
})();
