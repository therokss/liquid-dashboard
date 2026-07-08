const express = require('express');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');

const PORT = 8099;
const WWW = path.join(__dirname, 'www');
const INGRESS_ENTRY = process.env.INGRESS_ENTRY || '';
const CREDS_PATH = '/data/ld_credentials.json';
const PREFS_PATH = '/data/ld_prefs.json';
const USER_CFG_PATH = '/data/ld_user_configs.json';
const DASHBOARDS_PATH = '/data/ld_dashboards.json';

// Cerca SUPERVISOR_TOKEN in env e nelle directory s6-rc (HA base image)
function detectSupervisorToken() {
  const fromEnv = process.env.SUPERVISOR_TOKEN || process.env.HASSIO_TOKEN || '';
  if (fromEnv) return fromEnv;
  const s6paths = [
    '/var/run/s6/container_environment/SUPERVISOR_TOKEN',
    '/run/s6/container_environment/SUPERVISOR_TOKEN',
    '/var/run/s6/container_environment/HASSIO_TOKEN',
  ];
  for (const p of s6paths) {
    try {
      const val = fs.readFileSync(p, 'utf8').trim();
      if (val) return val;
    } catch {}
  }
  return '';
}

const SUPERVISOR_TOKEN = detectSupervisorToken();
const HA_WS_URL =
  process.env.HOMEASSISTANT_WEBSOCKET_API ||
  'ws://supervisor/core/websocket';

const app = express();
// Limite alto: la config per-utente include gli sfondi (foto in base64, ~MB).
// Col default di 100 KB il salvataggio di uno sfondo verrebbe rifiutato (413).
app.use(express.json({ limit: '12mb' }));

// CORS per la porta diretta (client app esterni). Le API sono protette dal token
// di Home Assistant (Bearer), quindi Allow-Origin * è sicuro: niente cookie/sessione.
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  next();
});

function readConfig() {
  let haOptions = {};
  let ldCreds = {};
  try { haOptions = JSON.parse(fs.readFileSync('/data/options.json', 'utf8')); } catch {}
  try { ldCreds = JSON.parse(fs.readFileSync(CREDS_PATH, 'utf8')); } catch {}
  return {
    token: haOptions.token || ldCreds.token || '',
    ha_url: haOptions.ha_url || ldCreds.ha_url || 'http://homeassistant.local:8123',
    has_supervisor_token: Boolean(SUPERVISOR_TOKEN),
  };
}

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    ha_ws_url: HA_WS_URL,
    has_token: Boolean(SUPERVISOR_TOKEN),
    ingress_entry: INGRESS_ENTRY,
    env_keys: Object.keys(process.env).filter(k =>
      k.includes('TOKEN') || k.includes('HASSIO') || k.includes('SUPERVISOR')
    ),
  });
});

function addonConfigHandler(req, res) { res.json(readConfig()); }

function addonConfigSaveHandler(req, res) {
  const { token, ha_url } = req.body || {};
  try {
    fs.writeFileSync(CREDS_PATH, JSON.stringify({ token: token || '', ha_url: ha_url || '' }));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
}

if (INGRESS_ENTRY) {
  app.get(`${INGRESS_ENTRY}/api/addon-config`, addonConfigHandler);
  app.post(`${INGRESS_ENTRY}/api/addon-config/save`, addonConfigSaveHandler);
}
app.get('/api/addon-config', addonConfigHandler);
app.post('/api/addon-config/save', addonConfigSaveHandler);

// --- Preferenze condivise (impostate dall'admin, valide per tutti gli utenti) ---
// Salvate lato addon in /data così sono uguali per ogni utente (localStorage è per-dispositivo).
const DEFAULT_PERMISSIONS = {
  rooms: true, visibility: true, weather: true, energy: true,
  waste: true, appearance: true, wallpapers: true, reset: true,
};
function readPrefs() {
  try { return JSON.parse(fs.readFileSync(PREFS_PATH, 'utf8')); } catch { return {}; }
}
function mergedPermissions(stored) {
  return { ...DEFAULT_PERMISSIONS, ...((stored || {}).permissions || {}) };
}
async function prefsGetHandler(req, res) {
  // Sulla porta diretta (niente header ingress) serve un token HA valido.
  if (!req.headers['x-remote-user-id']) {
    const user = await getUser(req);
    if (!user) { res.status(401).json({ error: 'unauthorized' }); return; }
  }
  const stored = readPrefs();
  res.json({ permissions: mergedPermissions(stored), house: stored.house || {} });
}
async function prefsSaveHandler(req, res) {
  const user = await getUser(req);
  if (!user || !user.is_admin) { res.status(403).json({ ok: false, error: 'forbidden' }); return; }
  const body = req.body || {};
  const stored = readPrefs();
  const next = { ...stored, permissions: { ...mergedPermissions(stored), ...(body.permissions || {}) } };
  // Config "casa" condivisa (rifiuti, meteo, energia, aree): impostata dall'admin, vista da tutti
  if (body.house) next.house = { ...(stored.house || {}), ...body.house };
  try {
    fs.writeFileSync(PREFS_PATH, JSON.stringify(next));
    res.json({ ok: true, permissions: next.permissions, house: next.house || {} });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
}
if (INGRESS_ENTRY) {
  app.get(`${INGRESS_ENTRY}/api/prefs`, prefsGetHandler);
  app.post(`${INGRESS_ENTRY}/api/prefs`, prefsSaveHandler);
}
app.get('/api/prefs', prefsGetHandler);
app.post('/api/prefs', prefsSaveHandler);

// --- Preferenze per-utente: ogni utente salva le proprie (per ID utente ingress) ---
// Così le preferenze seguono l'utente su tutti i dispositivi invece di restare nel browser.
function readUserConfigs() {
  try { return JSON.parse(fs.readFileSync(USER_CFG_PATH, 'utf8')); } catch { return {}; }
}
async function userConfigGetHandler(req, res) {
  const user = await getUser(req);
  const uid = user?.id || '';
  if (!uid) { res.json({ config: null, user: null }); return; }
  const all = readUserConfigs();
  res.json({ config: all[uid] || null, user: uid });
}
async function userConfigSaveHandler(req, res) {
  const user = await getUser(req);
  const uid = user?.id || '';
  if (!uid) { res.status(400).json({ ok: false, error: 'no user' }); return; }
  const cfg = (req.body || {}).config;
  if (cfg == null || typeof cfg !== 'object' || Array.isArray(cfg)) {
    res.status(400).json({ ok: false, error: 'bad config' }); return;
  }
  const all = readUserConfigs();
  all[uid] = cfg;
  try { fs.writeFileSync(USER_CFG_PATH, JSON.stringify(all)); res.json({ ok: true }); }
  catch (err) { res.status(500).json({ ok: false, error: err.message }); }
}
if (INGRESS_ENTRY) {
  app.get(`${INGRESS_ENTRY}/api/user-config`, userConfigGetHandler);
  app.post(`${INGRESS_ENTRY}/api/user-config`, userConfigSaveHandler);
}
app.get('/api/user-config', userConfigGetHandler);
app.post('/api/user-config', userConfigSaveHandler);

// --- Dashboard custom (editor) + assegnazione per-schermo -------------------------
// Le dashboard sono condivise (viste da ogni schermo); la mappa screenId→dashboardId
// decide cosa mostra ciascun tablet. In lettura serve un token valido; in scrittura
// serve un amministratore (la delega ai non-admin arriverà con i permessi).
function readDashboards() {
  try { return JSON.parse(fs.readFileSync(DASHBOARDS_PATH, 'utf8')); } catch { return { dashboards: [], deviceMap: {} }; }
}
async function dashboardsGetHandler(req, res) {
  if (!req.headers['x-remote-user-id']) {
    const user = await getUser(req);
    if (!user) { res.status(401).json({ error: 'unauthorized' }); return; }
  }
  const d = readDashboards();
  res.json({ dashboards: d.dashboards || [], deviceMap: d.deviceMap || {} });
}
async function dashboardsSaveHandler(req, res) {
  const user = await getUser(req);
  if (!user || !user.is_admin) { res.status(403).json({ ok: false, error: 'forbidden' }); return; }
  const body = req.body || {};
  const cur = readDashboards();
  const next = {
    dashboards: Array.isArray(body.dashboards) ? body.dashboards : (cur.dashboards || []),
    deviceMap: (body.deviceMap && typeof body.deviceMap === 'object') ? body.deviceMap : (cur.deviceMap || {}),
  };
  try { fs.writeFileSync(DASHBOARDS_PATH, JSON.stringify(next)); res.json({ ok: true }); }
  catch (err) { res.status(500).json({ ok: false, error: err.message }); }
}
if (INGRESS_ENTRY) {
  app.get(`${INGRESS_ENTRY}/api/dashboards`, dashboardsGetHandler);
  app.post(`${INGRESS_ENTRY}/api/dashboards`, dashboardsSaveHandler);
}
app.get('/api/dashboards', dashboardsGetHandler);
app.post('/api/dashboards', dashboardsSaveHandler);

// --- Versione della config (solo timestamp dei file) per il sync "live" ------------
// Il polling di app/dashboard interroga questo endpoint leggerissimo ogni ~10s:
// ricarica la config piena SOLO se un timestamp cambia (evita di riscaricare i MB
// degli sfondi a vuoto). Niente token: espone solo due numeri (mtime).
function configVersionHandler(req, res) {
  const mtime = (p) => { try { return fs.statSync(p).mtimeMs; } catch { return 0; } };
  res.json({ prefs: mtime(PREFS_PATH), userConfig: mtime(USER_CFG_PATH), dashboards: mtime(DASHBOARDS_PATH) });
}
if (INGRESS_ENTRY) app.get(`${INGRESS_ENTRY}/api/config-version`, configVersionHandler);
app.get('/api/config-version', configVersionHandler);

// Proxy immagini (cover media, entity_picture): il browser non può caricare gli URL
// relativi /api/... di HA in contesto ingress → li recuperiamo lato server con il token.
function mediaProxyHandler(req, res) {
  const p = req.query.url;
  if (typeof p !== 'string' || !p.startsWith('/')) { res.status(400).end(); return; }
  if (!SUPERVISOR_TOKEN) { res.status(503).end(); return; }
  // Gli stream MJPEG delle videocamere (/api/camera_proxy_stream/…) sono risposte
  // multipart infinite: niente cache e nessun timeout, così l'anteprima è "live".
  const isStream = p.includes('/camera_proxy_stream/');
  const upstream = http.request(
    'http://supervisor/core' + p,
    { method: 'GET', headers: { Authorization: `Bearer ${SUPERVISOR_TOKEN}` } },
    (up) => {
      res.status(up.statusCode || 502);
      if (up.headers['content-type']) res.setHeader('Content-Type', up.headers['content-type']);
      res.setHeader('Cache-Control', isStream ? 'no-store' : 'public, max-age=120');
      up.pipe(res);
    }
  );
  if (isStream) upstream.setTimeout(0);
  upstream.on('error', () => { if (!res.headersSent) res.status(502).end(); else res.end(); });
  // Se il client chiude la connessione (l'utente esce dalla pagina), interrompi
  // lo stream a monte per non lasciare connessioni aperte verso Home Assistant.
  res.on('close', () => upstream.destroy());
  upstream.end();
}
if (INGRESS_ENTRY) app.get(`${INGRESS_ENTRY}/media-proxy`, mediaProxyHandler);
app.get('/media-proxy', mediaProxyHandler);

// Elenco utenti admin da HA (per sapere se chi guarda è amministratore).
// In ingress HA passa gli header X-Remote-User-*; incrociamo l'id con config/auth/list.
function fetchAuthUsers() {
  return new Promise((resolve) => {
    let done = false;
    const finish = (val) => { if (!done) { done = true; try { ws.close(); } catch {} resolve(val); } };
    const ws = new WebSocket(HA_WS_URL);
    ws.on('message', (data) => {
      let msg; try { msg = JSON.parse(data.toString()); } catch { return; }
      if (msg.type === 'auth_required') ws.send(JSON.stringify({ type: 'auth', access_token: SUPERVISOR_TOKEN }));
      else if (msg.type === 'auth_ok') ws.send(JSON.stringify({ id: 1, type: 'config/auth/list' }));
      else if (msg.type === 'result' && msg.id === 1) finish(msg.success ? (msg.result || []) : []);
      else if (msg.type === 'auth_invalid') finish([]);
    });
    ws.on('error', () => finish([]));
    setTimeout(() => finish([]), 5000);
  });
}

let adminCache = { at: 0, ids: new Set() };
async function refreshAdminIds() {
  if (Date.now() - adminCache.at < 300000) return adminCache.ids;
  const users = await fetchAuthUsers();
  const ids = new Set(
    users
      .filter((u) => u.is_owner || (u.group_ids || []).includes('system-admin'))
      .map((u) => u.id)
  );
  adminCache = { at: Date.now(), ids };
  return ids;
}

// --- Autenticazione porta diretta (app) tramite token HA dell'utente ------------
// IMPORTANTE: la WS del Supervisor (ws://supervisor/core/websocket) accetta SOLO il
// token del Supervisor e rifiuta i token utente ("auth_invalid: Invalid access").
// Quindi validiamo il token utente contro CORE in modo NATIVO, sugli indirizzi interni.
const CORE_WS_CANDIDATES = [
  process.env.HOMEASSISTANT_WEBSOCKET_API_NATIVE,
  'ws://homeassistant:8123/api/websocket',
  'ws://172.30.32.1:8123/api/websocket',
].filter(Boolean);

// Prova a validare il token su UN indirizzo core; ritorna esito + motivo.
function tryValidate(wsUrl, token) {
  return new Promise((resolve) => {
    let done = false, ws;
    try { ws = new WebSocket(wsUrl); } catch (e) { resolve({ ok: false, reason: 'ws_ctor: ' + e.message }); return; }
    const finish = (v) => { if (done) return; done = true; try { ws.close(); } catch {} resolve(v); };
    ws.on('message', (data) => {
      let msg; try { msg = JSON.parse(data.toString()); } catch { return; }
      if (msg.type === 'auth_required') ws.send(JSON.stringify({ type: 'auth', access_token: token }));
      else if (msg.type === 'auth_ok') ws.send(JSON.stringify({ id: 1, type: 'auth/current_user' }));
      else if (msg.type === 'auth_invalid') finish({ ok: false, reason: 'auth_invalid: ' + (msg.message || '') });
      else if (msg.type === 'result' && msg.id === 1) {
        finish(msg.success && msg.result
          ? { ok: true, user: { id: msg.result.id, name: msg.result.name, is_admin: Boolean(msg.result.is_admin) } }
          : { ok: false, reason: 'result_not_success' });
      }
    });
    ws.on('error', (e) => finish({ ok: false, reason: 'ws_error: ' + e.message }));
    setTimeout(() => finish({ ok: false, reason: 'timeout' }), 4000);
  });
}

const userTokenCache = new Map();
async function resolveUser(token) {
  if (!token) return null;
  const cached = userTokenCache.get(token);
  if (cached && cached.exp > Date.now()) return cached.user;
  for (const url of CORE_WS_CANDIDATES) {
    const r = await tryValidate(url, token);
    if (r.ok) {
      const user = { id: r.user.id, is_admin: r.user.is_admin };
      userTokenCache.set(token, { user, exp: Date.now() + 300000 });
      return user;
    }
  }
  return null;
}

// Identità della richiesta: ingress (header X-Remote-User-Id) oppure token (porta diretta).
async function getUser(req) {
  const hdrId = req.headers['x-remote-user-id'];
  if (hdrId) {
    let isAdmin = false;
    try { const ids = await refreshAdminIds(); isAdmin = ids.has(hdrId); } catch {}
    return { id: hdrId, is_admin: isAdmin };
  }
  const m = /^Bearer\s+(.+)$/i.exec(req.headers['authorization'] || '');
  return m ? await resolveUser(m[1].trim()) : null;
}

// Diagnostica: prova TUTTI gli indirizzi candidati e riporta l'esito di ciascuno.
// Uso da browser: http://<ha>:8098/api/whoami?token=<long-lived-token>
function whoamiHandler(req, res) {
  const q = typeof req.query.token === 'string' ? req.query.token : '';
  const m = /^Bearer\s+(.+)$/i.exec(req.headers['authorization'] || '');
  const token = q || (m ? m[1].trim() : '');
  if (!token) { res.status(400).json({ ok: false, reason: 'no_token (usa ?token=... o header Bearer)' }); return; }
  (async () => {
    const attempts = [];
    for (const url of CORE_WS_CANDIDATES) {
      const r = await tryValidate(url, token);
      attempts.push({ url, ok: r.ok, reason: r.reason || null });
      if (r.ok) { res.json({ ok: true, user: r.user, url, attempts }); return; }
    }
    res.json({ ok: false, attempts });
  })().catch((e) => res.json({ ok: false, reason: 'exception: ' + e.message }));
}
app.get('/api/whoami', whoamiHandler);
if (INGRESS_ENTRY) app.get(`${INGRESS_ENTRY}/api/whoami`, whoamiHandler);

async function userHandler(req, res) {
  const user = await getUser(req);
  const name = req.headers['x-remote-user-display-name'] || req.headers['x-remote-user-name'] || '';
  res.json({ id: user?.id || '', name, is_admin: Boolean(user?.is_admin) });
}
if (INGRESS_ENTRY) app.get(`${INGRESS_ENTRY}/api/user`, userHandler);
app.get('/api/user', userHandler);

// --- Crea automaticamente una dashboard "contenitore" che apre la Liquid Dashboard ---
// Legge lo slug reale dell'add-on dal Supervisor e crea una dashboard Lovelace
// (view panel + card iframe verso l'ingress). Serve un solo click dell'admin.
function getAddonSlug() {
  return new Promise((resolve) => {
    const req = http.request('http://supervisor/addons/self/info',
      { headers: { Authorization: `Bearer ${SUPERVISOR_TOKEN}` } },
      (up) => { let b = ''; up.on('data', (c) => (b += c)); up.on('end', () => { try { resolve(JSON.parse(b)?.data?.slug || ''); } catch { resolve(''); } }); });
    req.on('error', () => resolve(''));
    req.setTimeout(4000, () => { req.destroy(); resolve(''); });
    req.end();
  });
}

function haCommandsSequential(cmds) {
  return new Promise((resolve) => {
    const results = [];
    let idx = 0, nextId = 10, done = false;
    const ws = new WebSocket(HA_WS_URL);
    const finish = (v) => { if (!done) { done = true; try { ws.close(); } catch {} resolve(v); } };
    const sendNext = () => {
      if (idx >= cmds.length) { finish(results); return; }
      ws.send(JSON.stringify({ id: nextId++, ...cmds[idx] }));
    };
    ws.on('message', (data) => {
      let msg; try { msg = JSON.parse(data.toString()); } catch { return; }
      if (msg.type === 'auth_required') ws.send(JSON.stringify({ type: 'auth', access_token: SUPERVISOR_TOKEN }));
      else if (msg.type === 'auth_ok') sendNext();
      else if (msg.type === 'auth_invalid') finish(results);
      else if (msg.type === 'result') { results.push({ success: msg.success, error: msg.error, result: msg.result }); idx++; sendNext(); }
    });
    ws.on('error', () => finish(results));
    setTimeout(() => finish(results), 8000);
  });
}

async function createDashboardHandler(req, res) {
  const uid = req.headers['x-remote-user-id'] || '';
  let isAdmin = false;
  try { if (uid && SUPERVISOR_TOKEN) { const ids = await refreshAdminIds(); isAdmin = ids.has(uid); } } catch {}
  if (!isAdmin) { res.status(403).json({ ok: false, error: 'forbidden' }); return; }
  try {
    const slug = await getAddonSlug();
    if (!slug) { res.status(500).json({ ok: false, error: 'slug non disponibile' }); return; }
    const urlPath = 'liquid-dashboard';
    const config = {
      title: 'Casa',
      views: [{ title: 'Casa', path: 'casa', type: 'panel', cards: [{ type: 'iframe', url: `/hassio/ingress/${slug}`, aspect_ratio: '100%' }] }],
    };
    const results = await haCommandsSequential([
      { type: 'lovelace/dashboards/create', url_path: urlPath, mode: 'storage', title: 'Casa', icon: 'mdi:water', show_in_sidebar: true, require_admin: false },
      { type: 'lovelace/config/save', url_path: urlPath, config },
    ]);
    const saved = results[results.length - 1];
    if (saved && saved.success === false) { res.status(500).json({ ok: false, error: (saved.error && saved.error.message) || 'save fallito', slug }); return; }
    res.json({ ok: true, url_path: urlPath, slug });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
}
if (INGRESS_ENTRY) app.post(`${INGRESS_ENTRY}/api/create-dashboard`, createDashboardHandler);
app.post('/api/create-dashboard', createDashboardHandler);

// Verifica se la plancia esiste già (pannello hass_ingress "liquid" o dashboard "liquid-dashboard")
async function dashboardStatusHandler(req, res) {
  try {
    const results = await haCommandsSequential([{ type: 'get_panels' }]);
    const panels = (results[0] && results[0].result) || {};
    let exists = false;
    for (const key of Object.keys(panels)) {
      const p = panels[key] || {};
      if (key === 'liquid' || key === 'liquid-dashboard' || p.url_path === 'liquid' || p.url_path === 'liquid-dashboard') { exists = true; break; }
    }
    res.json({ exists });
  } catch (err) {
    res.json({ exists: false });
  }
}
if (INGRESS_ENTRY) app.get(`${INGRESS_ENTRY}/api/dashboard-status`, dashboardStatusHandler);
app.get('/api/dashboard-status', dashboardStatusHandler);

app.use(INGRESS_ENTRY, express.static(WWW, {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }
}));
app.get(`${INGRESS_ENTRY}/*`, (req, res) => {
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(WWW, 'index.html'));
});
app.get('*', (req, res) => {
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(WWW, 'index.html'));
});

const server = http.createServer(app);
const wss = new WebSocket.Server({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const url = req.url || '';
  const isWs =
    url.endsWith('/api/websocket') || url.includes('/api/websocket?') ||
    url.endsWith('/ha-ws') || url.includes('/ha-ws?');
  if (isWs) {
    console.log('[LD] Upgrade WS:', url);
    wss.handleUpgrade(req, socket, head, (ws) => proxyToHA(ws));
  } else {
    console.log('[LD] Upgrade rifiutato:', url);
    socket.destroy();
  }
});

function proxyToHA(browserWs) {
  if (!SUPERVISOR_TOKEN) {
    console.error('[LD] SUPERVISOR_TOKEN non disponibile');
    browserWs.close(1008, 'No supervisor token');
    return;
  }

  const haWs = new WebSocket(HA_WS_URL);

  haWs.on('open', () => {
    console.log('[LD] Proxy connesso a HA');
  });

  // Da HA verso il browser. Il proxy si autentica DA SOLO con SUPERVISOR_TOKEN
  // appena HA invia auth_required. Inoltra tutto (incluso auth_ok) al browser,
  // così la libreria completa il suo handshake standard.
  haWs.on('message', (data) => {
    const str = data.toString();
    let msg = null;
    try { msg = JSON.parse(str); } catch {}

    if (msg && msg.type === 'auth_required') {
      haWs.send(JSON.stringify({ type: 'auth', access_token: SUPERVISOR_TOKEN }));
    } else if (msg && msg.type === 'auth_ok') {
      console.log('[LD] HA autenticato (auth_ok) →', msg.ha_version);
    } else if (msg && msg.type === 'auth_invalid') {
      console.error('[LD] HA auth_invalid:', msg.message);
    }

    if (browserWs.readyState === WebSocket.OPEN) browserWs.send(str);
  });

  // Dal browser verso HA. Scarta l'auth del browser (token dummy): l'autenticazione
  // la fa il proxy con il SUPERVISOR_TOKEN reale.
  browserWs.on('message', (data) => {
    let msg = null;
    try { msg = JSON.parse(data.toString()); } catch { return; }
    if (msg.type === 'auth') return;
    if (haWs.readyState === WebSocket.OPEN) haWs.send(data.toString());
  });

  browserWs.on('close', (code) => {
    console.log('[LD] Browser WS chiuso:', code);
    if (haWs.readyState === WebSocket.OPEN || haWs.readyState === WebSocket.CONNECTING)
      haWs.close();
  });

  haWs.on('close', (code) => {
    console.log('[LD] HA WS chiuso:', code);
    if (browserWs.readyState === WebSocket.OPEN) browserWs.close();
  });

  haWs.on('error', (err) => {
    console.error('[LD] HA WS error:', err.message);
    if (browserWs.readyState === WebSocket.OPEN) browserWs.close();
  });
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[Liquid Dashboard] v1.46.17 — porta ${PORT}`);
  console.log(`[LD] HA WebSocket → ${HA_WS_URL}`);
  console.log(`[LD] Token supervisore: ${SUPERVISOR_TOKEN ? 'presente' : 'MANCANTE'}`);
  if (INGRESS_ENTRY) console.log(`[LD] Ingress path: ${INGRESS_ENTRY}`);
});

// Porta diretta: stesse API REST per i client esterni (app iOS/Android).
// Protette dal token HA dell'utente → app e dashboard condividono lo stesso /data.
const DIRECT_PORT = 8098;
http.createServer(app).listen(DIRECT_PORT, '0.0.0.0', () => {
  console.log(`[LD] API condivisa (app) → porta ${DIRECT_PORT}`);
});
