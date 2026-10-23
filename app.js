/* Open Items — shared action-item tracker.
   Talks to Supabase directly over its REST API (no libraries to load).
   With no Supabase settings in config.js it runs in demo mode on sample data. */
(function () {
'use strict';

const CFG = window.OPEN_ITEMS_CONFIG || {};
const LIVE = !!(CFG.supabaseUrl && CFG.supabaseAnonKey);
const BASE = (CFG.supabaseUrl || '').replace(/\/+$/, '');
const POLL_MS = 20000;

/* ================= small helpers ================= */
const DAY = 86400000;
const pad = n => String(n).padStart(2, '0');
const iso = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const today0 = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const fromIso = s => { const [y, m, d] = s.slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
const diffDays = s => Math.round((fromIso(s) - today0()) / DAY);
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtDate = s => { const d = fromIso(s); return DOW[d.getDay()] + ' ' + MON[d.getMonth()] + ' ' + d.getDate(); };
const shortDate = s => { const d = fromIso(s); return MON[d.getMonth()] + ' ' + d.getDate(); };
const tsDate = t => iso(new Date(t));
const clock = d => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = id => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} }
};

/* ================= data layer: Supabase ================= */
const SESSION_KEY = 'openitems-session';
let session = LIVE ? store.get(SESSION_KEY, null) : null;

class NetError extends Error {}
class AuthError extends Error {}

async function authCall(path, body, token) {
  let res;
  try {
    res = await fetch(BASE + '/auth/v1/' + path, {
      method: 'POST',
      headers: Object.assign({ apikey: CFG.supabaseAnonKey, 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}),
      body: JSON.stringify(body || {})
    });
  } catch (e) { throw new NetError('Can\'t reach the database server. Check your internet connection. If this only happens on the work network, the site may be blocked.'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.error_description || data.msg || data.message || data.error || ('Error ' + res.status);
    throw new AuthError(/invalid login/i.test(msg) ? 'That email and password don\'t match.' : msg);
  }
  return data;
}

function keepSession(d) {
  session = { access_token: d.access_token, refresh_token: d.refresh_token, expires_at: d.expires_at || (Math.floor(Date.now() / 1000) + (d.expires_in || 3600)), user_id: d.user && d.user.id, email: d.user && d.user.email };
  store.set(SESSION_KEY, session);
}

let refreshing = null;
async function freshToken(force) {
  if (!session) throw new AuthError('Signed out');
  const soon = session.expires_at - 90 < Date.now() / 1000;
  if (!soon && !force) return session.access_token;
  if (!refreshing) refreshing = authCall('token?grant_type=refresh_token', { refresh_token: session.refresh_token })
    .then(d => { keepSession(d); return session.access_token; })
    .finally(() => { refreshing = null; });
  return refreshing;
}

async function rest(method, path, opts = {}) {
  const go = async (force) => {
    const token = await freshToken(force);
    const headers = { apikey: CFG.supabaseAnonKey, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
    if (opts.prefer) headers.Prefer = opts.prefer;
    if (opts.range) { headers['Range-Unit'] = 'items'; headers.Range = opts.range; }
    try {
      return await fetch(BASE + '/rest/v1/' + path, { method, headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
    } catch (e) { throw new NetError('Can\'t reach the database server. Check your internet connection.'); }
  };
  let res = await go(false);
  if (res.status === 401) res = await go(true);
  if (res.status === 401) throw new AuthError('Your sign-in expired. Please sign in again.');
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.message || d.hint || ('Database error ' + res.status));
  }
  if (res.status === 204) return null;
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

const enc = v => encodeURIComponent(v);
const where = m => Object.entries(m).map(([k, v]) => k + '=eq.' + enc(v)).join('&');

async function getAll(table, query) {
  const out = []; const page = 1000;
  for (let from = 0; ; from += page) {
    const rows = await rest('GET', table + '?' + query, { range: from + '-' + (from + page - 1) });
    out.push(...rows);
    if (rows.length < page) break;
  }
  return out;
}

const supa = {
  async signIn(email, pw) { const d = await authCall('token?grant_type=password', { email, password: pw }); keepSession(d); },
  async signOut() { try { if (session) await authCall('logout', {}, session.access_token); } catch (e) {} session = null; store.del(SESSION_KEY); },
  async setPassword(pw) {
    const token = await freshToken();
    const res = await fetch(BASE + '/auth/v1/user', { method: 'PUT', headers: { apikey: CFG.supabaseAnonKey, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }) });
    if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.msg || d.message || 'Could not change password.'); }
  },
  me() { return session && session.user_id; },
  async load() {
    const [profiles, jobs, sections, items, notes] = await Promise.all([
      getAll('profiles', 'select=id,name,email,active&order=name'),
      getAll('jobs', 'select=*&order=id'),
      getAll('sections', 'select=*&order=sort,id'),
      getAll('items', 'select=*&order=id'),
      getAll('job_notes', 'select=*')
    ]);
    return { profiles, jobs, sections, items, notes };
  },
  async insert(table, row) { const r = await rest('POST', table, { body: row, prefer: 'return=representation' }); return r[0]; },
  async update(table, match, patch) { return rest('PATCH', table + '?' + where(match), { body: patch, prefer: 'return=representation' }); },
  async remove(table, match) { return rest('DELETE', table + '?' + where(match)); },
  async saveNotes(jobId, body, prevStamp) {
    if (prevStamp) {
      const r = await rest('PATCH', 'job_notes?job_id=eq.' + enc(jobId) + '&updated_at=eq.' + enc(prevStamp), { body: { body }, prefer: 'return=representation' });
      return r && r.length ? r[0] : null;   // null = someone else changed it first
    }
    try { return (await rest('POST', 'job_notes', { body: { job_id: jobId, body }, prefer: 'return=representation' }))[0]; }
    catch (e) { if (/duplicate|unique|conflict/i.test(e.message)) return null; throw e; }
  }
};

/* ================= data layer: demo (this browser only) ================= */
const DEMO_KEY = 'openitems-demo-v1';
function demoSeed() {
  const t = today0(); const d = n => iso(addDays(t, n)); const ts = n => addDays(t, n).toISOString();
  const P = [['u-brock', 'Brock B.'], ['u-mike', 'Mike R.'], ['u-dana', 'Dana K.'], ['u-tyler', 'Tyler S.'], ['u-jess', 'Jess W.']]
    .map(([id, name]) => ({ id, name, email: name.split(' ')[0].toLowerCase() + '@example.com', active: true }));
  const jobs = [['2417', 'Highway Dept. Maintenance Shop'], ['2422', 'Clinic Addition & Reno'], ['2431', 'Grain Office Remodel'], ['2409', 'School Gym Roof Replacement'], ['OFF', 'Office / General']]
    .map(([id, name]) => ({ id, name, archived: false }));
  const sections = ['Manpower', 'Buyout & Contract Issuance', 'Subs & Vendor Pricing / Coordination', 'Owner / Designer Issues & Pricing', 'General']
    .map((name, i) => ({ id: i + 1, name, sort: i + 1 }));
  let k = 100;
  const mk = (s, text, job, who, due, by, crit = false, extra = {}) => Object.assign({ id: ++k, section_id: s, text, job_id: job, assignee: 'u-' + who, due, critical: crit, note: '', done: false, done_by: null, done_at: null, created_by: 'u-' + by, created_at: ts(-3), updated_at: ts(-3) }, extra);
  const items = [
    mk(1, 'Line up 2 carpenters for footing forms', '2417', 'tyler', d(5), 'brock', false, { note: 'Need them before SE releases the C-4 detail.' }),
    mk(1, 'Confirm labor crew for selective demo, exam rooms 1-2', '2422', 'tyler', d(2), 'jess'),
    mk(2, 'Issue mechanical subcontract (Rev. 2 scope)', '2422', 'brock', d(1), 'jess', true),
    mk(2, 'Get PO out for HM frames & hardware', '2417', 'dana', d(3), 'brock'),
    mk(2, 'Collect insurance certs from drywall sub', '2431', 'jess', d(-4), 'dana'),
    mk(3, 'Chase electrical sub for updated panel schedule', '2422', 'brock', d(-1), 'jess'),
    mk(3, 'Schedule special inspection for anchor bolts', '2417', 'tyler', d(0), 'brock', true),
    mk(3, 'Confirm crane date with roofer', '2409', 'brock', null, 'tyler'),
    mk(4, 'Get revised footing detail from structural engineer for grid C-4, including any added rebar and whether the footing needs to be deepened', '2417', 'brock', d(-2), 'mike', true),
    mk(4, 'Confirm overhead door color selection with owner', '2417', 'dana', d(1), 'brock'),
    mk(4, 'Verify infection control barrier spec with facility', '2422', 'mike', d(2), 'jess', true),
    mk(5, 'Send revised site logistics plan to county', '2417', 'brock', d(6), 'brock'),
    mk(4, 'Return punch list to architect', '2431', 'mike', d(-6), 'dana', false, { done: true, done_by: 'u-mike', done_at: ts(-1) })
  ];
  const notes = [{ job_id: '2417', body: 'OAC mtg ' + fmtDate(d(-3)) + '\n- SE still reviewing footing at grid C-4\n\nNext mtg:\n[] Bring revised pour schedule @brock tue\n[] Price added rebar at C-4 /owner @brock', updated_at: ts(-3) }];
  return { profiles: P, jobs, sections, items, notes, nextId: k + 1, nextSec: 6, me: 'u-brock' };
}
let DEMO = LIVE ? null : (store.get(DEMO_KEY, null) || demoSeed());
const demoSave = () => store.set(DEMO_KEY, DEMO);
const clone = o => JSON.parse(JSON.stringify(o));
const matches = (row, m) => Object.entries(m).every(([k, v]) => String(row[k]) === String(v));
const demo = {
  async signIn() {}, async signOut() {}, async setPassword() {},
  me() { return DEMO.me; },
  async load() { return clone({ profiles: DEMO.profiles, jobs: DEMO.jobs, sections: DEMO.sections, items: DEMO.items, notes: DEMO.notes }); },
  async insert(table, row) {
    const now = new Date().toISOString(); const r = Object.assign({}, row);
    if (table === 'items') Object.assign(r, { id: r.id || DEMO.nextId++, created_by: DEMO.me, created_at: r.created_at || now, updated_at: now, done: !!r.done, critical: !!r.critical, note: r.note || '' });
    if (table === 'sections') r.id = DEMO.nextSec++;
    if (table === 'jobs') r.archived = false;
    DEMO[table === 'job_notes' ? 'notes' : table].push(r); demoSave(); return clone(r);
  },
  async update(table, match, patch) {
    if (table === 'jobs' && patch.id && patch.id !== match.id) {
      DEMO.items.forEach(i => { if (i.job_id === match.id) i.job_id = patch.id; });
      DEMO.notes.forEach(n => { if (n.job_id === match.id) n.job_id = patch.id; });
    }
    const list = DEMO[table === 'job_notes' ? 'notes' : table]; const out = [];
    list.forEach(r => { if (matches(r, match)) { Object.assign(r, patch, table === 'items' ? { updated_at: new Date().toISOString(), updated_by: DEMO.me } : {}); out.push(clone(r)); } });
    demoSave(); return out;
  },
  async remove(table, match) { const k = table === 'job_notes' ? 'notes' : table; DEMO[k] = DEMO[k].filter(r => !matches(r, match)); demoSave(); return null; },
  async saveNotes(jobId, body) {
    const now = new Date().toISOString(); let n = DEMO.notes.find(x => x.job_id === jobId);
    if (n) Object.assign(n, { body, updated_at: now }); else { n = { job_id: jobId, body, updated_at: now }; DEMO.notes.push(n); }
    demoSave(); return clone(n);
  }
};
const db = LIVE ? supa : demo;

/* ================= app state ================= */
const S = { profiles: [], jobs: [], sections: [], items: [], notes: {}, me: null };
const VIEW_KEY = 'openitems-view';
let view = Object.assign({ type: 'mine', jobId: null, who: 'all', showDone: false, notes: true, group: 'job' }, store.get(VIEW_KEY, {}));
let collapsed = store.get('openitems-collapsed', {});
let moreOpen = null, editing = false, delArm = null, addingJob = false, addJobErr = '', acctForm = null, acctErr = '';
let showArchived = false, renamingJob = false, renameErr = '';
let lastSync = null, syncErr = null, pendingRender = false, loaded = false;
const drafts = {};                 // add-row drafts, keyed by block
const pending = new Map();         // itemId -> {field: value} not yet confirmed by the server
const notesState = {};             // jobId -> {dirty, conflict, saving}

const user = id => S.profiles.find(p => p.id === id);
const nameOf = id => (user(id) || {}).name || '—';
const firstName = id => nameOf(id).split(' ')[0];
const job = id => S.jobs.find(j => j.id === id);
const sec = id => S.sections.find(s => s.id === id);
const people = () => S.profiles.filter(p => p.active !== false).slice().sort((a, b) => a.name.localeCompare(b.name));
const jobSort = (a, b) => (a.id === 'OFF') - (b.id === 'OFF') || a.id.localeCompare(b.id, undefined, { numeric: true });
const openJobs = () => S.jobs.filter(j => !j.archived).slice().sort(jobSort);
const archivedJobs = () => S.jobs.filter(j => j.archived).slice().sort(jobSort);
const JOB_ID_RE = /^[A-Za-z0-9-]{1,12}$/;
const orderedSections = () => S.sections.slice().sort((a, b) => (a.sort - b.sort) || (a.id - b.id));

function applyData(d) {
  S.profiles = d.profiles; S.jobs = d.jobs; S.sections = d.sections;
  S.items = d.items.map(it => pending.has(it.id) ? Object.assign(it, pending.get(it.id)) : it);
  const notes = {}; d.notes.forEach(n => { notes[n.job_id] = n; });
  for (const jid in S.notes) if (notesState[jid] && notesState[jid].dirty) notes[jid] = S.notes[jid];
  S.notes = notes;
  S.me = db.me();
  if (view.type === 'job' && !job(view.jobId)) view.type = 'mine';
}

/* ================= shortcut parser ================= */
const WD = { sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, weds: 3, wednesday: 3, thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6 };
function parseQuick(raw) {
  let s = ' ' + raw + ' ';
  const out = { assignee: null, jobId: null, due: null, critical: false, section: null };
  s = s.replace(/\s@([a-z][\w.-]*)(?=\s)/gi, (m, n) => { const u = people().find(u => u.name.toLowerCase().startsWith(n.toLowerCase()) || (u.email || '').toLowerCase().startsWith(n.toLowerCase())); if (u) { out.assignee = u.id; return ' '; } return m; });
  s = s.replace(/\s#([\w-]+)(?=\s)/g, (m, n) => { const j = openJobs().find(j => j.id.toLowerCase().startsWith(n.toLowerCase())); if (j) { out.jobId = j.id; return ' '; } return m; });
  s = s.replace(/\s\/([a-z][\w-]*)(?=\s)/gi, (m, n) => { const x = orderedSections().find(x => x.name.toLowerCase().split(/[^a-z0-9]+/).some(w => w && w.startsWith(n.toLowerCase()))); if (x) { out.section = x.id; return ' '; } return m; });
  s = s.replace(/\s!+(?=\s)/g, () => { out.critical = true; return ' '; });
  const t = today0(); const setDue = d => { out.due = iso(d); return ' '; };
  s = s.replace(/\s(today|tod)(?=\s)/i, () => setDue(t));
  if (!out.due) s = s.replace(/\s(tomorrow|tmrw|tmw)(?=\s)/i, () => setDue(addDays(t, 1)));
  if (!out.due) s = s.replace(/\sin\s(\d{1,3})\s?(d|days?|w|wks?|weeks?)(?=\s)/i, (m, n, u) => setDue(addDays(t, Number(n) * (/^w/i.test(u) ? 7 : 1))));
  if (!out.due) s = s.replace(/\s(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?=\s)/, (m, mo, da, yr) => {
    const y = yr ? Number(yr.length === 2 ? '20' + yr : yr) : t.getFullYear();
    let d = new Date(y, Number(mo) - 1, Number(da));
    if (isNaN(d) || d.getMonth() !== Number(mo) - 1) return m;
    if (!yr && d < addDays(t, -60)) d = new Date(y + 1, Number(mo) - 1, Number(da));
    return setDue(d);
  });
  if (!out.due) s = s.replace(/\s(?:next\s|by\s|due\s)?(sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:s|nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?)(?=\s)/i, (m, w) => {
    let n = (WD[w.toLowerCase()] - t.getDay() + 7) % 7; if (n === 0) n = 7; return setDue(addDays(t, n));
  });
  out.text = s.replace(/\s+/g, ' ').trim();
  return out;
}

/* ================= derived ================= */
const dueState = it => { if (!it.due || it.done) return ''; const n = diffDays(it.due); return n < 0 ? 'late' : n <= 2 ? 'soon' : ''; };
const dueHint = it => { if (!it.due || it.done) return ''; const n = diffDays(it.due); if (n < 0) return (-n) + 'd late'; if (n === 0) return 'today'; if (n === 1) return 'tomorrow'; if (n === 2) return 'in 2 days'; return ''; };
const sortItems = arr => arr.slice().sort((a, b) => (a.done - b.done) || (b.critical - a.critical) || ((a.due || '9999') < (b.due || '9999') ? -1 : (a.due || '9999') > (b.due || '9999') ? 1 : 0) || a.id - b.id);
const liveJobIds = () => new Set(openJobs().map(j => j.id));
function scope() {
  const ok = liveJobIds(); const base = S.items.filter(i => ok.has(i.job_id));
  if (view.type === 'mine') return base.filter(i => i.assignee === S.me);
  if (view.type === 'all') return view.who === 'all' ? base : view.who === 'none' ? base.filter(i => !i.assignee) : base.filter(i => i.assignee === view.who);
  if (view.type === 'job') return S.items.filter(i => i.job_id === view.jobId);
  return base;
}
const shown = () => { const sc = scope(); return view.type === 'done' ? sc.filter(i => i.done) : sc.filter(i => !i.done || view.showDone); };
const lateCount = arr => arr.filter(i => !i.done && i.due && diffDays(i.due) < 0).length;

/* ================= editable cells ================= */
const getText = el => el.innerText.replace(/\n+$/, '');
function makeEditable(el) { try { el.contentEditable = 'plaintext-only'; if (el.contentEditable !== 'plaintext-only') el.contentEditable = 'true'; } catch (e) { el.contentEditable = 'true'; } }
function placeCaretEnd(el) { try { const r = document.createRange(); r.selectNodeContents(el); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); } catch (e) {} }
const isEditing = () => { const a = document.activeElement; return !!(a && a.closest && a.closest('#app') && a.matches('input, textarea, select, .ed')); };

/* ================= rendering ================= */
const checkSvg = '<svg viewBox="0 0 16 16" fill="none" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5l3.2 3L13 4.5"/></svg>';
const flagSvg = '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M3 1.5a.75.75 0 0 1 .75.75V3h8.6a.6.6 0 0 1 .47.97L11.1 6.25l1.72 2.28a.6.6 0 0 1-.47.97h-8.6v5.25a.75.75 0 0 1-1.5 0V2.25A.75.75 0 0 1 3 1.5z"/></svg>';
const caretSvg = '<svg class="car" viewBox="0 0 16 16" fill="currentColor"><path d="M4 6l4 4 4-4z"/></svg>';
const userOpts = (sel, blank) => (blank ? `<option value="" ${!sel ? 'selected' : ''}>Unassigned</option>` : '') +
  people().map(u => `<option value="${esc(u.id)}" ${u.id === sel ? 'selected' : ''}>${esc(u.name)}</option>`).join('') +
  (sel && !people().some(u => u.id === sel) ? `<option value="${esc(sel)}" selected>${esc(nameOf(sel))} (inactive)</option>` : '');
const jobOpts = sel => openJobs().map(j => `<option value="${esc(j.id)}" ${j.id === sel ? 'selected' : ''}>${esc(j.id)}</option>`).join('') +
  (sel && !openJobs().some(j => j.id === sel) ? `<option value="${esc(sel)}" selected>${esc(sel)}</option>` : '');

function renderWho() {
  if (!LIVE) {
    $('who').innerHTML = `<label class="lbl" for="me">Demo: signed in as</label><select id="me">${people().map(u => `<option value="${esc(u.id)}" ${u.id === S.me ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select>`;
    return;
  }
  let form = '';
  if (acctForm === 'name') form = `<form class="railform" id="acct-name-form"><input id="acct-name" value="${esc(nameOf(S.me))}" aria-label="Your name" maxlength="60">${acctErr ? `<div class="err">${esc(acctErr)}</div>` : ''}<div class="r"><button class="btn primary small" type="submit">Save name</button></div></form>`;
  if (acctForm === 'pw') form = `<form class="railform" id="acct-pw-form"><input id="acct-pw1" type="password" placeholder="New password" autocomplete="new-password" aria-label="New password"><input id="acct-pw2" type="password" placeholder="Type it again" autocomplete="new-password" aria-label="Confirm new password">${acctErr ? `<div class="err">${esc(acctErr)}</div>` : ''}<div class="r"><button class="btn primary small" type="submit">Change password</button></div></form>`;
  $('who').innerHTML = `<span class="lbl">Signed in</span><div class="me-name">${esc(nameOf(S.me))}</div>
    <div class="me-acts"><button class="linkbtn" type="button" data-acct="name">${acctForm === 'name' ? 'Cancel' : 'Change name'}</button><button class="linkbtn" type="button" data-acct="pw">${acctForm === 'pw' ? 'Cancel' : 'Password'}</button><button class="linkbtn" type="button" data-acct="out">Sign out</button></div>${form}`;
}

function renderNav() {
  const ok = liveJobIds();
  const open = S.items.filter(i => !i.done && ok.has(i.job_id));
  const mine = open.filter(i => i.assignee === S.me);
  const btn = (key, label, count, on, hot) => `<button type="button" data-nav="${key}" class="${on ? 'on' : ''}"><span class="nm">${label}</span><span class="ct ${hot ? 'hot' : ''}">${count}</span></button>`;
  $('nav-views').innerHTML = btn('mine', 'My items', mine.length, view.type === 'mine', lateCount(mine)) + btn('all', 'All open items', open.length, view.type === 'all') + btn('done', 'Completed', S.items.filter(i => i.done && ok.has(i.job_id)).length, view.type === 'done');
  $('nav-jobs').innerHTML = openJobs().map(j => { const c = open.filter(i => i.job_id === j.id);
    return `<button type="button" data-nav="job:${esc(j.id)}" class="${view.type === 'job' && view.jobId === j.id ? 'on' : ''}" title="${esc(j.id + ' · ' + j.name)}"><span class="nm"><span class="code">${esc(j.id)}</span>${esc(j.name)}</span><span class="ct ${lateCount(c) ? 'hot' : ''}">${c.length}</span></button>`; }).join('');
  $('addjob-toggle').textContent = addingJob ? 'Cancel' : '+ Add job';
  $('addjob-host').innerHTML = addingJob ? `<form class="railform" id="addjob-form" autocomplete="off">
      <div class="r"><input id="aj-code" placeholder="Job #" style="max-width:82px" aria-label="Job number"><input id="aj-name" placeholder="Job name" aria-label="Job name"></div>
      ${addJobErr ? `<div class="err">${esc(addJobErr)}</div>` : ''}
      <button type="submit" class="btn primary small">Add job</button></form>` : '';
  const arch = archivedJobs();
  $('archived-host').innerHTML = arch.length ? `<button type="button" class="arch-toggle" id="arch-toggle" aria-expanded="${showArchived}">${caretSvg}Archived jobs (${arch.length})</button>
    ${showArchived ? `<nav class="nav archived">${arch.map(j => `<button type="button" data-nav="job:${esc(j.id)}" class="${view.type === 'job' && view.jobId === j.id ? 'on' : ''}" title="${esc(j.id + ' · ' + j.name)}"><span class="nm"><span class="code">${esc(j.id)}</span>${esc(j.name)}</span></button>`).join('')}</nav>` : ''}` : '';
  renderSync();
}

function renderSync() {
  const el = $('sync'); if (!el) return;
  if (!LIVE) { el.textContent = 'Demo mode: data stays in this browser.'; el.className = 'sync'; return; }
  el.className = 'sync' + (syncErr ? ' bad' : '');
  el.textContent = syncErr ? 'Not synced: ' + syncErr : lastSync ? 'Up to date as of ' + clock(lastSync) : 'Connecting…';
}

function renderHead() {
  let title, sub;
  if (view.type === 'mine') { title = 'My items'; sub = `Everything assigned to ${firstName(S.me)} across all jobs.`; }
  else if (view.type === 'all') { title = 'All open items'; sub = 'Every open item across all jobs.'; }
  else if (view.type === 'done') { title = 'Completed'; sub = 'Checked-off items across all jobs.'; }
  else { const j = job(view.jobId); title = `<span class="jc">${esc(j.id)}</span>${esc(j.name)}`; sub = j.archived ? 'Archived job. Its items are hidden from every other list.' : 'This job only. Pull it up for job team meetings. Click any cell to edit.'; }
  $('title').innerHTML = title; $('subtitle').textContent = sub;
  if (view.type === 'done') { $('stats').innerHTML = ''; return; }
  const open = scope().filter(i => !i.done);
  const week = open.filter(i => i.due && diffDays(i.due) >= 0 && diffDays(i.due) <= 7).length;
  $('stats').innerHTML = `<div class="stat"><b>${open.length}</b><span>Open</span></div><div class="stat late"><b>${lateCount(open)}</b><span>Overdue</span></div><div class="stat"><b>${week}</b><span>Due 7 days</span></div><div class="stat crit"><b>${open.filter(i => i.critical).length}</b><span>Critical</span></div>`;
}

function renderBanner() {
  let h = LIVE ? '' : `<div class="banner">Demo mode. Add your Supabase settings to config.js to connect the shared database. Until then, everything here is sample data saved in this browser only.</div>`;
  const j = view.type === 'job' && job(view.jobId);
  if (j && j.archived) h += `<div class="banner">Job ${esc(j.id)} is archived. Its items don't appear in My items, All open items, Completed, or the job list. <button type="button" class="btn primary small" id="restore-job">Restore job</button></div>`;
  $('banner').innerHTML = h;
}

function renderRename() {
  const j = view.type === 'job' && job(view.jobId);
  if (!renamingJob || !j) { $('rename-host').innerHTML = ''; return; }
  const lockId = j.id === 'OFF';
  $('rename-host').innerHTML = `<form class="rename" id="rename-form" autocomplete="off">
    <label>Job #<input id="rn-code" value="${esc(j.id)}" style="width:96px" ${lockId ? 'disabled' : ''}></label>
    <label style="flex:1;min-width:200px">Job name<input id="rn-name" value="${esc(j.name)}" style="width:100%"></label>
    <div class="acts"><button type="submit" class="btn primary small">Save</button><button type="button" class="btn ghost small" id="rename-cancel">Cancel</button></div>
    ${renameErr ? `<div class="err">${esc(renameErr)}</div>` : ''}
    ${lockId ? '' : '<div class="hint">Changing the job number moves all of this job\'s items and notes with it.</div>'}
  </form>`;
}

function renderToolbar() {
  let h = '';
  if (view.type !== 'job') h += `<span>Group by</span><span class="seg" role="group" aria-label="Group by"><button type="button" data-group="job" class="${view.group === 'job' ? 'on' : ''}">Job</button><button type="button" data-group="section" class="${view.group === 'section' ? 'on' : ''}">Section</button></span>`;
  if (view.type === 'all') h += `<label for="who-f">Assigned to</label><select id="who-f"><option value="all">Everyone</option><option value="none" ${view.who === 'none' ? 'selected' : ''}>Unassigned</option>${people().map(u => `<option value="${esc(u.id)}" ${view.who === u.id ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select>`;
  if (view.type !== 'done') h += `<label class="chk"><input type="checkbox" id="show-done" ${view.showDone ? 'checked' : ''}> Show completed</label>`;
  if (view.type === 'job') h += `<label class="chk"><input type="checkbox" id="show-notes" ${view.notes ? 'checked' : ''}> Job notes</label>`;
  h += `<button type="button" class="btn ghost small" id="edit-secs">${editing ? 'Close section editor' : 'Edit sections'}</button>`;
  if (view.type === 'job') {
    h += `<button type="button" class="btn ghost small" id="rename-job">Rename job</button>`;
    const j = job(view.jobId);
    if (view.jobId !== 'OFF' && j && !j.archived) h += `<button type="button" class="btn ghost small" id="archive-job">Archive job</button>`;
  }
  if (view.type !== 'done') h += `<div class="tip">Cells grow as you type. Shift+Enter starts a new line, Enter saves. Shortcuts in an "Add item" cell: <code>@mike</code> assign · <code>fri</code> <code>tmrw</code> <code>11/3</code> <code>in 5d</code> due · <code>!</code> critical${view.type !== 'job' && view.group === 'section' ? ' · <code>#2417</code> job' : ''}.</div>`;
  $('toolbar').innerHTML = h;
}

function renderEditor() {
  if (!editing) { $('editor-host').innerHTML = ''; return; }
  const secs = orderedSections(); const n = secs.length;
  const rows = secs.map((s, i) => {
    const cnt = S.items.filter(x => x.section_id === s.id && !x.done).length;
    const armed = delArm === s.id; const target = secs.find(x => x.id !== s.id);
    return `<div class="ed-row">
      <input id="sec-name-${s.id}" data-sec-name="${s.id}" value="${esc(s.name)}" aria-label="Section name">
      <div class="ed-move"><button type="button" class="icon-btn" data-sec-up="${s.id}" ${i === 0 ? 'disabled' : ''} aria-label="Move up">↑</button><button type="button" class="icon-btn" data-sec-down="${s.id}" ${i === n - 1 ? 'disabled' : ''} aria-label="Move down">↓</button></div>
      <span class="cnt">${cnt} open</span>
      <button type="button" class="btn ${armed ? 'danger' : 'ghost'}" data-sec-del="${s.id}" ${n <= 1 ? 'disabled' : ''}>${armed ? 'Confirm delete' : 'Delete'}</button>
    </div>${armed && target ? `<div class="warn">Items in this section (including completed) will move to "${esc(target.name)}". Click Confirm delete to proceed.</div>` : ''}`;
  }).join('');
  $('editor-host').innerHTML = `<div class="editor"><h3>Sections</h3><p>These headers are shared by every job and every person, so changes here show up for the whole team.</p>${rows}
    <form class="ed-add" id="sec-add"><input id="sec-new" placeholder="New section name, e.g. Permits & Inspections" aria-label="New section name"><button class="btn primary" type="submit">Add section</button></form></div>`;
}

function rowHtml(it, jc) {
  const ds = dueState(it); const isMore = moreOpen === it.id;
  const dueCell = it.done
    ? `<div class="donetag" title="Completed">Done ${it.done_at ? esc(shortDate(tsDate(it.done_at))) : ''} · ${esc(firstName(it.done_by))}</div>`
    : `<input type="date" class="cell" id="c-${it.id}-due" data-f="due" data-id="${it.id}" value="${it.due || ''}" aria-label="Due date">${dueHint(it) ? `<span class="duehint">${dueHint(it)}</span>` : ''}`;
  let h = `<tr class="${it.done ? 'done' : ''} ${it.critical && !it.done ? 'critical' : ''}" data-row="${it.id}">
    <td><div class="ctr"><button type="button" class="cb" data-act="toggle" data-id="${it.id}" aria-label="${it.done ? 'Reopen' : 'Mark done'}">${checkSvg}</button></div></td>
    <td class="txt"><div class="cell ed" role="textbox" aria-multiline="true" aria-label="Item" id="c-${it.id}-text" data-f="text" data-id="${it.id}" data-ph="Item">${esc(it.text)}</div></td>
    ${jc ? `<td><select class="cell" id="c-${it.id}-job" data-f="job_id" data-id="${it.id}" aria-label="Job" title="${esc((job(it.job_id) || {}).name)}">${jobOpts(it.job_id)}</select></td>` : ''}
    <td><select class="cell ${it.assignee ? '' : 'unset'}" id="c-${it.id}-who" data-f="assignee" data-id="${it.id}" aria-label="Assigned to">${userOpts(it.assignee, true)}</select></td>
    <td class="due ${ds}">${dueCell}</td>
    <td><div class="ctr"><button type="button" class="flag ${it.critical ? 'on' : ''}" data-act="flag" data-id="${it.id}" aria-label="${it.critical ? 'Remove critical flag' : 'Flag as critical'}" title="${it.critical ? 'Critical' : 'Flag as critical'}">${flagSvg}</button></div></td>
    <td><div class="cell ed" role="textbox" aria-multiline="true" aria-label="Notes" id="c-${it.id}-note" data-f="note" data-id="${it.id}" data-ph="—">${esc(it.note)}</div></td>
    <td><div class="ctr"><button type="button" class="more" data-act="more" data-id="${it.id}" aria-expanded="${isMore}" aria-label="More options">···</button></div></td>
  </tr>`;
  if (isMore) {
    h += `<tr class="sub"><td colspan="${jc ? 8 : 7}"><div class="subbar">
      <label>Move to section <select id="c-${it.id}-sec" data-f="section_id" data-id="${it.id}">${orderedSections().map(s => `<option value="${s.id}" ${s.id === it.section_id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
      <span class="audit">Added by ${esc(nameOf(it.created_by))} on ${esc(fmtDate(tsDate(it.created_at)))}${it.updated_by && it.updated_at ? ` · last changed by ${esc(nameOf(it.updated_by))} ${esc(shortDate(tsDate(it.updated_at)))}` : ''}</span>
      <button type="button" class="btn danger small" data-act="del" data-id="${it.id}">Delete item</button></div></td></tr>`;
  }
  return h;
}

const keyFor = (fixedJob, secId) => 'k' + (fixedJob ? fixedJob.replace(/[^A-Za-z0-9]/g, '') : 'x') + '_' + secId;
const defaultAssignee = () => view.type === 'all' && view.who !== 'all' ? (view.who === 'none' ? null : view.who) : S.me;

function newRowHtml(key, secId, fixedJob, jc) {
  const d = drafts[key] || (drafts[key] = {}); d._sec = secId; d._job = fixedJob;
  const who = 'assignee' in d ? d.assignee : defaultAssignee();
  const jb = d.job_id || 'OFF';
  return `<tr class="newrow" data-key="${key}">
    <td><div class="ctr plus" aria-hidden="true">+</div></td>
    <td class="txt"><div class="cell ed" role="textbox" aria-multiline="true" id="n-${key}-text" data-nf="text" data-key="${key}" data-ph="Add item…" aria-label="New item in ${esc(sec(secId).name)}">${esc(d.text || '')}</div></td>
    ${jc ? `<td><select class="cell" id="n-${key}-job" data-nf="job_id" data-key="${key}" aria-label="Job">${jobOpts(jb)}</select></td>` : ''}
    <td><select class="cell ${who ? '' : 'unset'}" id="n-${key}-who" data-nf="assignee" data-key="${key}" aria-label="Assigned to">${userOpts(who, true)}</select></td>
    <td class="due"><input type="date" class="cell" id="n-${key}-due" data-nf="due" data-key="${key}" value="${d.due || ''}" aria-label="Due date"></td>
    <td><div class="ctr"><button type="button" class="flag ${d.critical ? 'on' : ''}" data-act="nflag" data-key="${key}" aria-label="Flag new item as critical">${flagSvg}</button></div></td>
    <td><div class="cell ed" role="textbox" aria-multiline="true" id="n-${key}-note" data-nf="note" data-key="${key}" data-ph="—" aria-label="Notes">${esc(d.note || '')}</div></td>
    <td></td></tr>`;
}

function secBlock(s, arr, fixedJob) {
  const jc = !fixedJob; const key = keyFor(fixedJob, s.id);
  const open = arr.filter(i => !i.done); const late = lateCount(arr); const closed = !!collapsed[key];
  const colgroup = `<colgroup><col style="width:42px"><col>${jc ? '<col style="width:78px">' : ''}<col style="width:120px"><col style="width:138px"><col style="width:40px"><col style="width:24%"><col style="width:44px"></colgroup>`;
  const thead = `<thead><tr><th aria-label="Done"></th><th>Item</th>${jc ? '<th>Job</th>' : ''}<th>Assigned</th><th>Due</th><th aria-label="Critical"></th><th>Notes</th><th></th></tr></thead>`;
  const rows = sortItems(arr).map(i => rowHtml(i, jc)).join('') + (view.type === 'done' ? '' : newRowHtml(key, s.id, fixedJob, jc));
  return `<section class="sec ${closed ? 'closed' : ''}">
    <div class="sec-h"><button type="button" class="col" data-col="${key}" aria-expanded="${!closed}">${caretSvg}<h3 data-sec-title="${s.id}">${esc(s.name)}</h3></button>
    <span class="n">${open.length} open</span>${late ? `<span class="n late">${late} overdue</span>` : ''}</div>
    <div class="wrap"><table class="grid">${colgroup}${thead}<tbody>${rows}</tbody></table></div></section>`;
}

function sectionsFor(items, fixedJob, showEmpty) {
  let h = '';
  for (const s of orderedSections()) {
    const arr = items.filter(i => i.section_id === s.id);
    if (!arr.length && (!showEmpty || view.type === 'done')) continue;
    h += secBlock(s, arr, fixedJob);
  }
  return h;
}

function notesPanel() {
  const n = S.notes[view.jobId]; const st = notesState[view.jobId] || {};
  let status = 'Saves as you type. Start a line with [] to make it an item.';
  let cls = '';
  if (st.saving) status = 'Saving…';
  else if (st.conflict) { cls = 'bad'; status = 'Someone else changed these notes while you were typing. <button type="button" id="notes-merge">Load theirs</button> (your text is kept below theirs).'; }
  else if (st.error) { cls = 'bad'; status = 'Not saved: ' + esc(st.error); }
  else if (n && n.updated_at) status = 'Saved' + (n.updated_by ? ' · last edit by ' + esc(firstName(n.updated_by)) : '') + ' ' + esc(shortDate(tsDate(n.updated_at)));
  return `<aside class="notes"><h2>Job notes</h2><div class="sv ${cls}" id="sv">${status}</div>
    <textarea id="notes-ta" spellcheck="true" placeholder="Meeting notes, phone calls, context…">${esc(n ? n.body : '')}</textarea>
    <div class="row2"><button type="button" class="btn ghost small" id="convert">Turn [] lines into items</button><span id="conv-ct"></span></div></aside>`;
}

function renderBody() {
  const list = shown(); let html = '';
  if (view.type === 'job') {
    html = `<div class="split ${view.notes ? 'side' : ''}"><div>${sectionsFor(list, view.jobId, true)}</div>${view.notes ? notesPanel() : ''}</div>`;
  } else if (view.group === 'job') {
    for (const j of openJobs()) {
      const arr = list.filter(i => i.job_id === j.id); if (!arr.length) continue;
      const open = arr.filter(i => !i.done); const late = lateCount(arr);
      html += `<div class="jobblock"><div class="job-h"><h2><span class="jc">${esc(j.id)}</span>${esc(j.name)}</h2>
        <span class="n">${view.type === 'done' ? arr.length + ' completed' : open.length + ' open'}</span>${late ? `<span class="n late">${late} overdue</span>` : ''}
        <button type="button" class="btn ghost small" data-nav="job:${esc(j.id)}">Open job page</button></div>
        ${sectionsFor(arr, j.id, false)}</div>`;
    }
  } else {
    html = sectionsFor(list, null, view.type !== 'done');
  }
  if (!html.replace(/<[^>]*>/g, '').trim()) {
    const msg = view.type === 'mine' ? 'Nothing assigned to you right now. Items show up here when someone assigns one to you, or when you add one with yourself as the assignee.'
      : view.type === 'done' ? 'Nothing checked off yet.' : 'No open items yet. Open a job from the sidebar and type in any section\'s "Add item" row.';
    html = `<div class="wrap"><div class="empty">${msg}</div></div>`;
  }
  $('body').innerHTML = html;
  document.querySelectorAll('#body .ed').forEach(makeEditable);
  updateConvCount();
}

function render(keepFocus) {
  if (!loaded) return;
  pendingRender = false;
  store.set(VIEW_KEY, view); store.set('openitems-collapsed', collapsed);
  renderBanner(); renderWho(); renderNav(); renderHead(); renderRename(); renderToolbar(); renderEditor(); renderBody();
  if (keepFocus) { const el = document.getElementById(keepFocus); if (el) { el.focus(); if (el.classList.contains('ed')) placeCaretEnd(el); } }
}
function softRender() { if (isEditing()) pendingRender = true; else render(); }
function refreshSummary() { renderNav(); renderHead(); }

/* ================= toasts & errors ================= */
let toastTimer;
function toast(msg, undo, bad) {
  clearTimeout(toastTimer);
  $('toast-host').innerHTML = `<div class="toast ${bad ? 'bad' : ''}" role="status"><span>${esc(msg)}</span>${undo ? '<button type="button" id="undo">Undo</button>' : ''}</div>`;
  if (undo) $('undo').onclick = () => { $('toast-host').innerHTML = ''; undo(); };
  toastTimer = setTimeout(() => { $('toast-host').innerHTML = ''; }, bad ? 9000 : 5000);
}
function fail(e) {
  if (e instanceof AuthError) { showLogin(e.message); return; }
  console.error(e);
  toast('Couldn\'t save: ' + e.message + ' Reloading the latest data.', null, true);
  sync();
}

/* ================= sync ================= */
let syncing = false;
async function sync() {
  if (syncing) return; syncing = true;
  try {
    const d = await db.load();
    applyData(d); lastSync = new Date(); syncErr = null;
    if (!loaded) { loaded = true; render(); } else softRender();
  } catch (e) {
    if (e instanceof AuthError) { syncing = false; showLogin(e.message); return; }
    syncErr = e instanceof NetError ? 'can\'t reach the server' : e.message; renderSync();
    if (!loaded) $('body').innerHTML = `<div class="banner bad">Couldn't load data: ${esc(e.message)}</div>`;
  } finally { syncing = false; }
}
let pollTimer = null;
function startPolling() {
  clearInterval(pollTimer);
  pollTimer = setInterval(() => { if (document.visibilityState === 'visible') sync(); }, POLL_MS);
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && loaded) sync(); });

/* ================= writes ================= */
const saveTimers = {};
function queueItemSave(id, field, value, delay = 600) {
  const p = pending.get(id) || {}; p[field] = value; pending.set(id, p);
  clearTimeout(saveTimers[id]);
  saveTimers[id] = setTimeout(() => flushItem(id), delay);
}
async function flushItem(id) {
  clearTimeout(saveTimers[id]);
  const patch = pending.get(id); if (!patch) return;
  pending.delete(id);
  try {
    const rows = await db.update('items', { id }, patch);
    const it = S.items.find(i => i.id === id);
    if (rows && rows[0] && it) Object.assign(it, rows[0], pending.get(id) || {});
    if (rows && rows.length === 0) { toast('That item was deleted by someone else.', null, true); sync(); }
  } catch (e) { fail(e); }
}
async function saveItem(id, patch) {
  const it = S.items.find(i => i.id === id); if (!it) return;
  Object.assign(it, patch);
  const p = Object.assign(pending.get(id) || {}, patch); pending.set(id, p);
  await flushItem(id);
}

async function commitNew(key, focusAfter) {
  const d = drafts[key]; if (!d || d._busy) return;
  const raw = (d.text || '').trim(); if (!raw) return;
  const p = parseQuick(raw); if (!p.text) return;
  const row = {
    section_id: p.section || d._sec, text: p.text,
    job_id: d._job || p.jobId || d.job_id || 'OFF',
    assignee: p.assignee || ('assignee' in d ? d.assignee : defaultAssignee()) || null,
    due: p.due || d.due || null, critical: p.critical || !!d.critical, note: d.note || ''
  };
  d._busy = true;
  try {
    const created = await db.insert('items', row);
    S.items.push(created); drafts[key] = {};
    render(focusAfter ? `n-${key}-text` : null);
    if (view.type === 'mine' && created.assignee !== S.me) toast(`Added for ${created.assignee ? firstName(created.assignee) : 'nobody yet'}. It's on their list, not yours.`);
    else if (created.section_id !== d._sec) toast(`Added to ${sec(created.section_id).name}`);
  } catch (e) { d._busy = false; fail(e); }
}

/* ================= events ================= */
document.addEventListener('click', async e => {
  const nav = e.target.closest('[data-nav]');
  if (nav) { const k = nav.dataset.nav; moreOpen = null; renamingJob = false; renameErr = '';
    view = Object.assign({}, view, k.startsWith('job:') ? { type: 'job', jobId: k.slice(4) } : { type: k, jobId: null, who: 'all' });
    render(); window.scrollTo(0, 0); return; }
  const grp = e.target.closest('[data-group]'); if (grp) { view.group = grp.dataset.group; render(); return; }
  const col = e.target.closest('[data-col]'); if (col) { const id = col.dataset.col; collapsed[id] = !collapsed[id]; render(); return; }
  const acct = e.target.closest('[data-acct]');
  if (acct) {
    const a = acct.dataset.acct; acctErr = '';
    if (a === 'out') { await db.signOut(); location.reload(); return; }
    acctForm = acctForm === a ? null : a; renderWho();
    const f = $(a === 'name' ? 'acct-name' : 'acct-pw1'); if (f) f.focus(); return;
  }
  const id = e.target.id;
  if (id === 'addjob-toggle') { addingJob = !addingJob; addJobErr = ''; renderNav(); if (addingJob) $('aj-code').focus(); return; }
  if (id === 'edit-secs') { editing = !editing; delArm = null; render(); return; }
  if (id === 'refresh') { await sync(); toast('Refreshed'); return; }
  if (id === 'convert') { convertNotes(); return; }
  if (id === 'notes-merge') { mergeNotes(); return; }
  if (id === 'reset') { DEMO = demoSeed(); demoSave(); location.reload(); return; }
  if (id === 'arch-toggle' || e.target.closest('#arch-toggle')) { showArchived = !showArchived; renderNav(); return; }
  if (id === 'rename-job') { renamingJob = !renamingJob; renameErr = ''; render(); const f = $('rn-name'); if (f) { f.focus(); f.select(); } return; }
  if (id === 'rename-cancel') { renamingJob = false; renameErr = ''; render(); return; }
  if (id === 'restore-job') {
    const jid = view.jobId;
    try { await db.update('jobs', { id: jid }, { archived: false }); const j = job(jid); if (j) j.archived = false; render(); toast(`Restored job ${jid}`); }
    catch (err) { fail(err); }
    return;
  }
  if (id === 'archive-job') {
    const btn = e.target;
    if (!btn.dataset.armed) { btn.dataset.armed = '1'; btn.textContent = 'Click again to archive'; btn.classList.add('danger'); return; }
    const jid = view.jobId;
    try { await db.update('jobs', { id: jid }, { archived: true }); const j = job(jid); if (j) j.archived = true; view.type = 'mine'; render(); toast(`Archived job ${jid}. Its items are kept and hidden from lists.`); }
    catch (err) { fail(err); }
    return;
  }

  const up = e.target.closest('[data-sec-up]'), dn = e.target.closest('[data-sec-down]'), del = e.target.closest('[data-sec-del]');
  if (up || dn) {
    const sid = Number(up ? up.dataset.secUp : dn.dataset.secDown); const secs = orderedSections();
    const i = secs.findIndex(s => s.id === sid); const j = up ? i - 1 : i + 1;
    [secs[i], secs[j]] = [secs[j], secs[i]];
    secs.forEach((s, n) => { s.sort = n + 1; }); render();
    try { await Promise.all(secs.map(s => db.update('sections', { id: s.id }, { sort: s.sort }))); } catch (err) { fail(err); }
    return;
  }
  if (del) {
    const sid = Number(del.dataset.secDel);
    if (delArm !== sid) { delArm = sid; render(); return; }
    const target = orderedSections().find(x => x.id !== sid); const name = sec(sid).name;
    try {
      await db.update('items', { section_id: sid }, { section_id: target.id });
      await db.remove('sections', { id: sid });
      S.items.forEach(i => { if (i.section_id === sid) i.section_id = target.id; });
      S.sections = S.sections.filter(s => s.id !== sid); delArm = null; render(); toast(`Deleted "${name}"`);
    } catch (err) { fail(err); }
    return;
  }

  const a = e.target.closest('[data-act]'); if (!a) return;
  const iid = Number(a.dataset.id); const it = S.items.find(i => i.id === iid);
  switch (a.dataset.act) {
    case 'toggle': {
      const prev = { done: it.done, done_by: it.done_by, done_at: it.done_at };
      const next = it.done ? { done: false, done_by: null, done_at: null } : { done: true, done_by: S.me, done_at: new Date().toISOString() };
      Object.assign(it, next); render();
      toast(it.done ? 'Marked done' : 'Reopened', () => { Object.assign(it, prev); render(); saveItem(iid, prev); });
      saveItem(iid, next); break;
    }
    case 'flag': { const v = !it.critical; it.critical = v; render(); saveItem(iid, { critical: v }); break; }
    case 'nflag': { const d = drafts[a.dataset.key] || (drafts[a.dataset.key] = {}); d.critical = !d.critical; a.classList.toggle('on', d.critical); break; }
    case 'more': moreOpen = moreOpen === iid ? null : iid; render(); break;
    case 'del': {
      const copy = Object.assign({}, it); moreOpen = null;
      S.items = S.items.filter(i => i.id !== iid); render();
      try { await db.remove('items', { id: iid }); } catch (err) { fail(err); return; }
      toast('Item deleted', async () => {
        try { const back = Object.assign({}, copy); delete back.updated_by; const r = await db.insert('items', back); S.items.push(r); render(); } catch (err) { fail(err); }
      });
      break;
    }
  }
});

document.addEventListener('submit', async e => {
  const f = e.target; e.preventDefault();
  if (f.id === 'login-form') return doLogin();
  if (f.id === 'sec-add') {
    const v = $('sec-new').value.trim(); if (!v) return;
    try { const maxSort = Math.max(0, ...S.sections.map(s => s.sort || 0)); const r = await db.insert('sections', { name: v, sort: maxSort + 1 }); S.sections.push(r); render('sec-new'); toast(`Added section "${v}"`); }
    catch (err) { fail(err); }
    return;
  }
  if (f.id === 'rename-form') {
    const j = job(view.jobId); if (!j) return;
    const code = j.id === 'OFF' ? 'OFF' : $('rn-code').value.trim(); const name = $('rn-name').value.trim();
    renameErr = '';
    if (!name) renameErr = 'Enter a job name.';
    else if (!JOB_ID_RE.test(code)) renameErr = 'Job number can use letters, numbers and dashes only (12 max).';
    else if (code !== j.id && S.jobs.some(x => x !== j && x.id.toLowerCase() === code.toLowerCase())) renameErr = `Job ${code} already exists.`;
    if (renameErr) { const c = j.id === 'OFF' ? '' : $('rn-code').value, n = $('rn-name').value; renderRename(); if ($('rn-code') && c) $('rn-code').value = c; $('rn-name').value = n; return; }
    const oldId = j.id; const patch = code !== oldId ? { id: code, name } : { name };
    try {
      await db.update('jobs', { id: oldId }, patch);
      j.name = name;
      if (code !== oldId) {
        j.id = code;
        S.items.forEach(i => { if (i.job_id === oldId) i.job_id = code; });
        if (S.notes[oldId]) { S.notes[code] = Object.assign(S.notes[oldId], { job_id: code }); delete S.notes[oldId]; }
        if (notesState[oldId]) { notesState[code] = notesState[oldId]; delete notesState[oldId]; }
        view.jobId = code;
      }
      renamingJob = false; render(); toast(code !== oldId ? `Job ${oldId} is now ${code}` : 'Job renamed');
      sync();
    } catch (err) { renameErr = /duplicate|unique|conflict/i.test(err.message) ? `Job ${code} already exists.` : err.message; renderRename(); }
    return;
  }
  if (f.id === 'addjob-form') {
    const code = $('aj-code').value.trim(), name = $('aj-name').value.trim();
    if (!code || !name) addJobErr = 'Enter both a job number and a name.';
    else if (!JOB_ID_RE.test(code)) addJobErr = 'Job number can use letters, numbers and dashes only (12 max).';
    else if (S.jobs.some(j => j.id.toLowerCase() === code.toLowerCase())) {
      const old = S.jobs.find(j => j.id.toLowerCase() === code.toLowerCase());
      if (old.archived) {
        try { await db.update('jobs', { id: old.id }, { archived: false }); old.archived = false; addingJob = false; view = Object.assign({}, view, { type: 'job', jobId: old.id }); render(); toast(`Job ${old.id} was archived. It's back now.`); return; }
        catch (err) { fail(err); return; }
      }
      addJobErr = `Job ${code} already exists.`;
    } else {
      try { const r = await db.insert('jobs', { id: code, name }); S.jobs.push(r); addingJob = false; addJobErr = ''; view = Object.assign({}, view, { type: 'job', jobId: r.id }); render(); toast(`Added job ${code}`); return; }
      catch (err) { addJobErr = err.message; }
    }
    const c = $('aj-code').value, n = $('aj-name').value; renderNav(); $('aj-code').value = c; $('aj-name').value = n; $('aj-code').focus();
    return;
  }
  if (f.id === 'acct-name-form') {
    const v = $('acct-name').value.trim(); if (!v) { acctErr = 'Enter a name.'; renderWho(); return; }
    try { await db.update('profiles', { id: S.me }, { name: v }); const p = user(S.me); if (p) p.name = v; acctForm = null; render(); toast('Name updated'); }
    catch (err) { acctErr = err.message; renderWho(); }
    return;
  }
  if (f.id === 'acct-pw-form') {
    const a = $('acct-pw1').value, b = $('acct-pw2').value;
    if (a.length < 8) acctErr = 'Use at least 8 characters.';
    else if (a !== b) acctErr = 'The two passwords don\'t match.';
    else { try { await db.setPassword(a); acctForm = null; renderWho(); toast('Password changed'); return; } catch (err) { acctErr = err.message; } }
    renderWho(); return;
  }
});

document.addEventListener('input', e => {
  const t = e.target;
  if (t.classList && t.classList.contains('ed') && !t.innerText.trim()) t.innerHTML = '';
  if (t.dataset.f === 'text' || t.dataset.f === 'note') {
    const id = Number(t.dataset.id); const it = S.items.find(i => i.id === id); const v = getText(t);
    if (it && (t.dataset.f === 'note' || v.trim())) { it[t.dataset.f] = t.dataset.f === 'text' ? v.trim() : v; queueItemSave(id, t.dataset.f, it[t.dataset.f]); }
  }
  if (t.dataset.nf === 'text' || t.dataset.nf === 'note') (drafts[t.dataset.key] ||= {})[t.dataset.nf] = getText(t);
  if (t.dataset.secName) {
    const s = sec(Number(t.dataset.secName)); if (!s) return;
    s.name = t.value; document.querySelectorAll(`[data-sec-title="${s.id}"]`).forEach(h => { h.textContent = t.value; });
    clearTimeout(saveTimers['sec' + s.id]);
    saveTimers['sec' + s.id] = setTimeout(() => { if (s.name.trim()) db.update('sections', { id: s.id }, { name: s.name.trim() }).catch(fail); }, 700);
  }
  if (t.id === 'notes-ta') {
    const jid = view.jobId; const st = notesState[jid] || (notesState[jid] = {});
    const n = S.notes[jid] || (S.notes[jid] = { job_id: jid, body: '', updated_at: null });
    n.body = t.value; st.dirty = true; updateConvCount();
    if (!st.conflict) { $('sv').textContent = 'Saving…'; $('sv').className = 'sv'; }
    clearTimeout(saveTimers['notes']); saveTimers['notes'] = setTimeout(() => saveNotes(jid), 900);
  }
});
document.addEventListener('paste', e => {
  const t = e.target.closest && e.target.closest('.ed'); if (!t) return;
  e.preventDefault(); const txt = (e.clipboardData || window.clipboardData).getData('text/plain');
  document.execCommand('insertText', false, txt);
});

document.addEventListener('change', e => {
  const t = e.target;
  if (t.id === 'me' && !LIVE) { DEMO.me = t.value; demoSave(); S.me = t.value; moreOpen = null; render(); toast('Now viewing as ' + nameOf(S.me)); return; }
  if (t.id === 'who-f') { view.who = t.value; render(); return; }
  if (t.id === 'show-done') { view.showDone = t.checked; render(); return; }
  if (t.id === 'show-notes') { view.notes = t.checked; render(); return; }
  if (t.dataset.nf && t.dataset.nf !== 'text' && t.dataset.nf !== 'note') {
    (drafts[t.dataset.key] ||= {})[t.dataset.nf] = t.value || null;
    if (t.dataset.nf === 'assignee') t.classList.toggle('unset', !t.value);
    return;
  }
  const f = t.dataset.f; if (!f || f === 'text' || f === 'note') return;
  const id = Number(t.dataset.id); const it = S.items.find(i => i.id === id); if (!it) return;
  if (f === 'due') {
    it.due = t.value || null; saveItem(id, { due: it.due });
    const td = t.closest('td'); td.className = 'due ' + dueState(it); const old = td.querySelector('.duehint'); if (old) old.remove();
    if (dueHint(it)) td.insertAdjacentHTML('beforeend', `<span class="duehint">${dueHint(it)}</span>`);
    refreshSummary(); return;
  }
  if (f === 'assignee') {
    it.assignee = t.value || null; t.classList.toggle('unset', !t.value); saveItem(id, { assignee: it.assignee }); refreshSummary();
    if (view.type === 'mine' && it.assignee !== S.me) toast(`Reassigned to ${it.assignee ? firstName(it.assignee) : 'nobody'}. It leaves your list on the next refresh.`);
    return;
  }
  if (f === 'job_id') { it.job_id = t.value; t.title = (job(it.job_id) || {}).name || ''; saveItem(id, { job_id: it.job_id }); refreshSummary(); return; }
  if (f === 'section_id') { it.section_id = Number(t.value); moreOpen = null; render(); saveItem(id, { section_id: it.section_id }); toast(`Moved to ${sec(it.section_id).name}`); return; }
});

document.addEventListener('keydown', e => {
  const t = e.target; if (!t.dataset) return;
  if (e.key === 'Enter' && !e.shiftKey && t.dataset.nf === 'text') { e.preventDefault(); commitNew(t.dataset.key, true); return; }
  if (e.key === 'Enter' && !e.shiftKey && (t.dataset.f === 'text' || t.dataset.f === 'note' || t.dataset.nf === 'note')) {
    e.preventDefault(); const tr = t.closest('tr'); let next = tr.nextElementSibling; while (next && next.classList.contains('sub')) next = next.nextElementSibling;
    const sel = (t.dataset.f === 'text') ? 'td.txt .ed' : 'td:nth-last-child(2) .ed';
    const nt = next && next.querySelector(sel); if (nt) { nt.focus(); placeCaretEnd(nt); } else t.blur(); return;
  }
  if (e.key === 'Escape' && t.dataset.nf === 'text') { t.innerHTML = ''; if (drafts[t.dataset.key]) drafts[t.dataset.key].text = ''; t.blur(); }
});

document.addEventListener('focusout', e => {
  const t = e.target;
  setTimeout(() => { if (pendingRender && !isEditing()) render(); }, 0);
  if (!t.dataset) return;
  if (t.dataset.f === 'text' || t.dataset.f === 'note') {
    const id = Number(t.dataset.id); const it = S.items.find(i => i.id === id);
    if (t.dataset.f === 'text' && it && !getText(t).trim()) { t.textContent = it.text; toast('An item needs some text. To remove it, use Delete in the ··· menu.'); }
    if (pending.has(id)) flushItem(id);
    return;
  }
  if (t.id === 'notes-ta' && notesState[view.jobId] && notesState[view.jobId].dirty) { clearTimeout(saveTimers['notes']); saveNotes(view.jobId); return; }
  if (!t.dataset.nf) return;
  const row = t.closest('tr.newrow'); const to = e.relatedTarget;
  if (to && row && row.contains(to)) return;
  const key = row && row.dataset.key;
  if (key && (drafts[key] && (drafts[key].text || '').trim())) setTimeout(() => commitNew(key, false), 0);
});

window.addEventListener('beforeunload', e => {
  for (const id of pending.keys()) flushItem(id);
  const dirty = Object.values(notesState).some(s => s.dirty);
  if (dirty || pending.size) { e.preventDefault(); e.returnValue = ''; }
});

/* ================= job notes ================= */
async function saveNotes(jid) {
  const st = notesState[jid] || (notesState[jid] = {}); const n = S.notes[jid]; if (!n || st.conflict || st.saving) return;
  st.saving = true;
  const body = n.body;
  try {
    const r = await db.saveNotes(jid, body, n.updated_at);
    st.saving = false;
    if (!r) { st.conflict = true; }
    else { const latest = n.body; Object.assign(n, r); n.body = latest; st.dirty = latest !== body; st.error = null; }
  } catch (e) { st.saving = false; st.error = e.message; if (e instanceof AuthError) return showLogin(e.message); }
  if (view.type === 'job' && view.jobId === jid && $('sv')) {
    const tmp = document.createElement('div'); tmp.innerHTML = notesPanel();
    const fresh = tmp.querySelector('#sv'); $('sv').className = fresh.className; $('sv').innerHTML = fresh.innerHTML;
  }
  if (st.dirty && !st.conflict && !st.error) saveNotes(jid);
}
async function mergeNotes() {
  const jid = view.jobId; const mine = (S.notes[jid] || {}).body || '';
  try {
    const d = await db.load(); const theirs = d.notes.find(x => x.job_id === jid);
    S.notes[jid] = theirs ? Object.assign({}, theirs) : { job_id: jid, body: '', updated_at: null };
    S.notes[jid].body = (S.notes[jid].body || '') + '\n\n----- my unsaved text -----\n' + mine;
    notesState[jid] = { dirty: true };
    render(); saveNotes(jid);
  } catch (e) { fail(e); }
}
function updateConvCount() {
  const ta = $('notes-ta'); if (!ta) return;
  const n = ta.value.split('\n').filter(l => /^\s*\[\s?\]\s+\S/.test(l)).length;
  $('conv-ct').textContent = n ? `${n} line${n > 1 ? 's' : ''} ready. Add /buyout, /owner etc. to pick a section.` : 'No [] lines yet';
  $('convert').disabled = !n;
}
async function convertNotes() {
  const ta = $('notes-ta'); const jid = view.jobId;
  const fallback = (orderedSections().find(s => /general/i.test(s.name)) || orderedSections().slice(-1)[0]).id;
  const lines = ta.value.split('\n'); let made = 0;
  $('convert').disabled = true;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*)\[\s?\]\s+(.+)$/); if (!m) continue;
    const p = parseQuick(m[2]); if (!p.text) continue;
    try {
      const it = await db.insert('items', { section_id: p.section || fallback, text: p.text, job_id: jid, assignee: p.assignee || S.me, due: p.due, critical: p.critical, note: '' });
      S.items.push(it); made++;
      lines[i] = `${m[1]}[→ added] ${it.text} (${it.assignee ? firstName(it.assignee) : 'unassigned'}${it.due ? ', ' + shortDate(it.due) : ''} · ${sec(it.section_id).name})`;
    } catch (e) { fail(e); break; }
  }
  const n = S.notes[jid] || (S.notes[jid] = { job_id: jid, body: '', updated_at: null });
  n.body = lines.join('\n'); (notesState[jid] ||= {}).dirty = true;
  render(); saveNotes(jid);
  toast(`Created ${made} item${made === 1 ? '' : 's'} from notes`);
}

/* ================= sign-in & start ================= */
function showLogin(msg) {
  clearInterval(pollTimer); loaded = false;
  $('app').hidden = true; $('login').hidden = false;
  $('login-co').textContent = CFG.companyName || '';
  $('login-help').textContent = `Forgot your password or need an account? Ask ${CFG.adminContact || 'the app admin'}.`;
  $('login-err').textContent = msg && msg !== 'Signed out' ? msg : '';
  if (session && session.email) $('login-email').value = session.email;
  ($('login-email').value ? $('login-pw') : $('login-email')).focus();
}
async function doLogin() {
  const btn = $('login-btn'); btn.disabled = true; btn.textContent = 'Signing in…'; $('login-err').textContent = '';
  try { await db.signIn($('login-email').value.trim(), $('login-pw').value); $('login-pw').value = ''; start(); }
  catch (e) { $('login-err').textContent = e.message; }
  finally { btn.disabled = false; btn.textContent = 'Sign in'; }
}
async function start() {
  $('login').hidden = true; $('app').hidden = false;
  $('co-name').textContent = (CFG.companyName || '') + (LIVE ? '' : ' · demo');
  $('reset').hidden = LIVE;
  await sync();
  if (loaded) startPolling();
}

if (LIVE && !session) showLogin(); else start();
})();
