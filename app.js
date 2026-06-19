/* =============================================================
   Study Tracker — front-end logic
   Talks to the Google Apps Script Web App defined in config.js
   ============================================================= */
"use strict";

/* ---------------- state ---------------- */
const state = {
  role: null,
  pendingRole: null,
  todayEntries: [],      // Minahil: entries for today
  lastEntryId: null,     // Minahil: for Undo
  undoTimer: null,
  entries: [],           // Fiaz: all entries
  flags: [],             // shared: help flags from Minahil
  helpItems: [],         // shared: study materials from Fiaz
  hist: { range: "week", anchor: new Date() },
  selectedDay: null
};

const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ---------------- small helpers ---------------- */
const $  = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
const pad2 = n => String(n).padStart(2, "0");

function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function parseLocalDate(str) {            // "YYYY-MM-DD" -> local Date (no TZ shift)
  const parts = String(str).split("-").map(Number);
  return new Date(parts[0], (parts[1] || 1) - 1, parts[2] || 1);
}
function dateKey(d) { return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }

function todayInfo() {
  const now = new Date();
  return { dateStr: dateKey(now), dayName: DAY_NAMES[now.getDay()], dateObj: now };
}

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const MONTHS_LONG = ["January","February","March","April","May","June","July","August","September","October","November","December"];

function fmtLongDate(d) { return DAY_NAMES[d.getDay()] + ", " + d.getDate() + " " + MONTHS_LONG[d.getMonth()] + " " + d.getFullYear(); }
function fmtShortDate(d) { return d.getDate() + " " + MONTHS[d.getMonth()] + " " + d.getFullYear(); }
function fmtTime(ms) {
  const d = new Date(ms);
  let h = d.getHours(); const m = d.getMinutes(); const ap = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return h + ":" + pad2(m) + " " + ap;
}

function startOfWeekMon(d) {               // Monday 00:00 of d's week
  const x = new Date(d); const day = (x.getDay() + 6) % 7; // Mon=0..Sun=6
  x.setDate(x.getDate() - day); x.setHours(0,0,0,0); return x;
}
function startOfWeekSun(d) {
  const x = new Date(d); x.setDate(x.getDate() - x.getDay()); x.setHours(0,0,0,0); return x;
}

function isConfigured() {
  return CONFIG.WEB_APP_URL && CONFIG.WEB_APP_URL.indexOf("PASTE_YOUR") === -1;
}

/* ---------------- network status bar ---------------- */
let netHideT = null;
function net(msg, kind) {
  const bar = $("#netbar");
  clearTimeout(netHideT);
  if (!msg) { bar.hidden = true; return; }
  bar.hidden = false; bar.textContent = msg;
  bar.className = "netbar " + (kind === "error" ? "is-error" : "is-loading");
  if (kind === "error") netHideT = setTimeout(function () { bar.hidden = true; }, 5000);
}

/* ---------------- API client ----------------
   Reads  -> GET  ?action=...
   Writes -> POST with text/plain body (avoids CORS preflight)
--------------------------------------------------- */
async function apiGet(params) {
  const url = new URL(CONFIG.WEB_APP_URL);
  Object.keys(params).forEach(function (k) { url.searchParams.set(k, params[k]); });
  const res = await fetch(url.toString(), { method: "GET", redirect: "follow" });
  if (!res.ok) throw new Error("HTTP " + res.status);
  return res.json();
}
async function apiPost(payload) {
  const res = await fetch(CONFIG.WEB_APP_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" }, // CORS-safe (no preflight)
    body: JSON.stringify(payload),
    redirect: "follow"
  });
  if (!res.ok) throw new Error("HTTP " + res.status);
  return res.json();
}

/* =============================================================
   ROUTING + AUTH
   ============================================================= */
function showScreen(id) {
  $$(".screen").forEach(function (s) {
    const on = s.id === id;
    s.classList.toggle("is-active", on);
    s.hidden = !on;
  });
  window.scrollTo(0, 0);
}

function openGate(role) {
  state.pendingRole = role;
  const isParent = role === "fiaz";
  $("#gate-avatar").textContent = isParent ? "F" : "M";
  $("#gate-avatar").classList.toggle("is-parent", isParent);
  $("#gate-title").textContent = "Welcome, " + (isParent ? CONFIG.PARENT_NAME : CONFIG.STUDENT_NAME);
  $("#gate-sub").textContent = "Enter your password to continue.";
  $("#gate-error").hidden = true;
  $("#gate-input").value = "";
  $("#gate").hidden = false;
  setTimeout(function () { $("#gate-input").focus(); }, 60);
}
function closeGate() { $("#gate").hidden = true; state.pendingRole = null; }

function tryUnlock(e) {
  e.preventDefault();
  const role = state.pendingRole;
  const pass = $("#gate-input").value;
  if (pass === CONFIG.PASSWORDS[role]) {
    try { sessionStorage.setItem("st_role", role); } catch (_) {}
    closeGate();
    enterRole(role);
  } else {
    const card = $(".gate-card");
    $("#gate-error").hidden = false;
    card.classList.remove("shake"); void card.offsetWidth; card.classList.add("shake");
    $("#gate-input").select();
  }
}

function enterRole(role) {
  state.role = role;
  if (role === "minahil") enterMinahil();
  else enterFiaz();
}

function logout() {
  try { sessionStorage.removeItem("st_role"); } catch (_) {}
  state.role = null;
  showScreen("landing");
}

/* =============================================================
   MINAHIL'S VIEW
   ============================================================= */
function enterMinahil() {
  showScreen("view-minahil");
  const info = todayInfo();
  $("#m-greeting").textContent = "Hello, " + CONFIG.STUDENT_NAME;
  $("#m-date").textContent = fmtLongDate(info.dateObj);

  if (!isConfigured()) { renderConfigWarningMinahil(); return; }

  loadHelpData(false);   // quiet load so the Help tab shows a "new materials" badge

  const daySchedule = SCHEDULE[info.dayName];
  if (!daySchedule) {            // Sunday / off day
    $("#m-offday").hidden = false;
    $("#m-progress-card").hidden = true;
    $("#m-slots").innerHTML = "";
    return;
  }
  $("#m-offday").hidden = true;
  $("#m-progress-card").hidden = false;
  buildSlots(daySchedule);
  loadTodayEntries();
}

function renderConfigWarningMinahil() {
  $("#m-offday").hidden = true;
  $("#m-progress-card").hidden = true;
  $("#m-slots").innerHTML = configWarningHtml();
}
function configWarningHtml() {
  return '<div class="offday-card"><div class="offday-emoji">⚙️</div>' +
    '<h2>Almost ready</h2>' +
    '<p class="muted">The app is not connected yet. Open <strong>config.js</strong> and paste your ' +
    'Apps Script Web App URL into <code>WEB_APP_URL</code>. See the README for steps.</p></div>';
}

function buildSlots(daySchedule) {
  const wrap = $("#m-slots");
  wrap.innerHTML = "";
  SLOTS.forEach(function (slot) { wrap.appendChild(buildSlotCard(slot, daySchedule[slot.id] || [])); });
}

function buildSlotCard(slot, subjects) {
  const el = document.createElement("div");
  el.className = "slot";
  el.dataset.slot = slot.id;

  const subjectChips = subjects.map(function (s, i) {
    return '<button type="button" class="chip chip--subject' +
      (subjects.length === 1 || i === 0 ? " is-active" : "") +
      '" data-subject="' + escapeHtml(s) + '">' + escapeHtml(s) + '</button>';
  }).join("");

  const activityOpts = ACTIVITY_TYPES.map(function (a) {
    return '<option value="' + escapeHtml(a) + '">' + escapeHtml(a) + '</option>';
  }).join("");
  const confChips = CONFIDENCE_LEVELS.map(function (c) {
    return '<button type="button" class="chip chip--conf" data-conf="' + escapeHtml(c) + '">' + escapeHtml(c) + '</button>';
  }).join("");

  el.innerHTML =
    '<div class="slot-head">' +
      '<h3>' + escapeHtml(slot.label) + '</h3>' +
      '<span class="slot-time">' + escapeHtml(slot.time) + '</span>' +
    '</div>' +
    '<p class="slot-subjects-hint">Today: ' + subjects.map(escapeHtml).join(" · ") + '</p>' +
    '<form class="slot-form" novalidate>' +
      '<div class="field"><label>Subject</label>' +
        '<div class="chips chips--subject">' + subjectChips + '</div></div>' +
      '<div class="field"><label>What did you study?</label>' +
        '<input type="text" class="text-input f-topic" placeholder="e.g. Photosynthesis — light reactions" /></div>' +
      '<div class="field"><label>Activity type</label>' +
        '<select class="select f-activity"><option value="" disabled selected>Choose…</option>' + activityOpts + '</select></div>' +
      '<div class="field"><label>Confidence <span class="opt">(optional)</span></label>' +
        '<div class="chips chips--conf">' + confChips + '</div></div>' +
      '<p class="gate-error f-error" hidden>Please pick a subject, add a topic, and choose an activity.</p>' +
      '<button type="submit" class="btn btn--student btn--block slot-submit">Log this session</button>' +
    '</form>';

  // single-choice subject chips
  $$(".chips--subject .chip", el).forEach(function (chip) {
    chip.addEventListener("click", function () {
      $$(".chips--subject .chip", el).forEach(function (c) { c.classList.remove("is-active"); });
      chip.classList.add("is-active");
    });
  });
  // confidence chips: click active again to clear
  $$(".chips--conf .chip", el).forEach(function (chip) {
    chip.addEventListener("click", function () {
      const was = chip.classList.contains("is-active");
      $$(".chips--conf .chip", el).forEach(function (c) { c.classList.remove("is-active"); });
      if (!was) chip.classList.add("is-active");
    });
  });

  $(".slot-form", el).addEventListener("submit", function (e) {
    e.preventDefault();
    submitSlot(slot, el);
  });
  return el;
}

async function submitSlot(slot, el) {
  const subjectChip = $(".chips--subject .chip.is-active", el);
  const subject  = subjectChip ? subjectChip.dataset.subject : "";
  const topic    = $(".f-topic", el).value.trim();
  const activity = $(".f-activity", el).value;
  const confChip = $(".chips--conf .chip.is-active", el);
  const confidence = confChip ? confChip.dataset.conf : "";
  const errEl = $(".f-error", el);

  if (!subject || !topic || !activity) {
    errEl.hidden = false;
    el.classList.remove("shake"); void el.offsetWidth; el.classList.add("shake");
    return;
  }
  errEl.hidden = true;

  const btn = $(".slot-submit", el);
  btn.disabled = true; btn.textContent = "Saving…";

  const info = todayInfo();
  const payload = {
    action: "submit",
    date: info.dateStr, day: info.dayName,
    slotId: slot.id, slotLabel: slotSheetLabel(slot),
    subject: subject, topic: topic, activity: activity, confidence: confidence
  };

  try {
    const res = await apiPost(payload);
    if (!res || !res.ok) throw new Error(res && res.error ? res.error : "Save failed");
    state.todayEntries.push(res.entry);
    state.lastEntryId = res.entry.id;

    // reset for another entry, keep subject selection
    $(".f-topic", el).value = "";
    $(".f-activity", el).value = "";
    $$(".chips--conf .chip", el).forEach(function (c) { c.classList.remove("is-active"); });

    refreshProgress();
    if (!REDUCED) burstConfetti();
    showToast("Nice work — session logged!", true);
  } catch (err) {
    showToast("Couldn't save. Check your connection.", false);
    net("Save failed: " + err.message, "error");
  } finally {
    btn.disabled = false;
    const slotAlreadyLogged = state.todayEntries.some(function (e) { return e.slotId === slot.id; });
    btn.textContent = slotAlreadyLogged ? "Add another entry (optional)" : "Log this session";
  }
}

async function loadTodayEntries() {
  if (!isConfigured()) return;
  net("Loading…");
  try {
    const info = todayInfo();
    const res = await apiGet({ action: "today", date: info.dateStr });
    const server = (res && res.entries) ? res.entries : [];
    // merge by id so an entry submitted while this load was in flight is not lost
    const byId = new Map();
    server.forEach(function (e) { byId.set(e.id, e); });
    state.todayEntries.forEach(function (e) { if (!byId.has(e.id)) byId.set(e.id, e); });
    state.todayEntries = Array.from(byId.values());
    refreshProgress();
    net(null);
  } catch (err) {
    net("Couldn't load today's progress.", "error");
  }
}

function refreshProgress() {
  const done = new Set(state.todayEntries.map(function (e) { return e.slotId; }));
  const count = SLOTS.filter(function (s) { return done.has(s.id); }).length;

  // ring
  const C = 2 * Math.PI * 52;
  $("#m-ring").style.strokeDashoffset = String(C * (1 - count / 3));
  $("#m-progress-count").textContent = count + "/3";

  // copy
  const title = $("#m-progress-title"), msg = $("#m-progress-msg");
  if (count === 0) { title.textContent = "Let's get started"; msg.textContent = "Log a session below when you finish studying."; }
  else if (count < 3) { title.textContent = "Great progress!"; msg.textContent = (3 - count) + " more to complete today."; }
  else { title.textContent = "All done for today! 🎉"; msg.textContent = "Every session logged. Wonderful work."; }

  // badges + slot done marks
  const badges = SLOTS.filter(function (s) { return done.has(s.id); })
    .map(function (s) { return '<span class="pbadge">✓ ' + escapeHtml(s.label) + '</span>'; }).join("");
  $("#m-badges").innerHTML = badges;
  SLOTS.forEach(function (s) {
    const card = $('.slot[data-slot="' + s.id + '"]');
    if (card) {
      card.classList.toggle("is-done", done.has(s.id));
      const btn = $(".slot-submit", card);
      if (btn) btn.textContent = done.has(s.id) ? "Add another entry (optional)" : "Log this session";
    }
  });
}

/* ---- toast + undo ---- */
function showToast(text, withUndo) {
  const t = $("#toast"), undo = $("#toast-undo");
  $("#toast-text").textContent = text;
  t.classList.remove("is-show"); void t.offsetWidth; t.classList.add("is-show");

  clearTimeout(state.undoTimer);
  if (withUndo && state.lastEntryId) {
    undo.hidden = false;
    state.undoTimer = setTimeout(function () { undo.hidden = true; t.classList.remove("is-show"); },
      CONFIG.UNDO_WINDOW_SECONDS * 1000);
  } else {
    undo.hidden = true;
    state.undoTimer = setTimeout(function () { t.classList.remove("is-show"); }, 4000);
  }
}

async function undoLast() {
  if (!state.lastEntryId) return;
  const id = state.lastEntryId;
  $("#toast-undo").hidden = true;
  net("Removing…");
  try {
    const res = await apiPost({ action: "delete", id: id });
    if (!res || !res.ok) throw new Error(res && res.error ? res.error : "Delete failed");
    state.todayEntries = state.todayEntries.filter(function (e) { return e.id !== id; });
    state.lastEntryId = null;
    refreshProgress();
    showToast("Removed.", false);
    net(null);
  } catch (err) {
    net("Couldn't undo: " + err.message, "error");
    showToast("Couldn't undo.", false);
  }
}

/* ---- confetti ---- */
function burstConfetti() {
  const c = $("#confetti"); if (!c) return;
  const ctx = c.getContext("2d");
  const W = window.innerWidth, H = window.innerHeight, DPR = window.devicePixelRatio || 1;
  c.width = W * DPR; c.height = H * DPR; ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  const colors = ["#df7a52", "#1f7a6b", "#e9b949", "#43a48f", "#ec9173", "#3c4a6b"];
  const cx = W / 2, cy = H * 0.72, parts = [];
  for (let i = 0; i < 90; i++) {
    const a = Math.random() * Math.PI * 2, sp = 4 + Math.random() * 8;
    parts.push({ x: cx, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 7,
      r: 4 + Math.random() * 4, col: colors[i % colors.length],
      rot: Math.random() * 6, vr: -0.2 + Math.random() * 0.4, life: 0, max: 60 + Math.random() * 35 });
  }
  let raf;
  (function tick() {
    ctx.clearRect(0, 0, W, H);
    let alive = false;
    parts.forEach(function (p) {
      if (p.life > p.max) return;
      alive = true; p.life++; p.vy += 0.25; p.x += p.vx; p.y += p.vy; p.vx *= 0.99; p.rot += p.vr;
      ctx.save(); ctx.globalAlpha = Math.max(0, 1 - p.life / p.max);
      ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = p.col;
      ctx.fillRect(-p.r / 2, -p.r / 2, p.r, p.r * 1.6); ctx.restore();
    });
    if (alive) raf = requestAnimationFrame(tick); else ctx.clearRect(0, 0, W, H);
  })();
}

/* =============================================================
   FIAZ'S DASHBOARD
   ============================================================= */
function enterFiaz() {
  showScreen("view-fiaz");
  $("#f-subtitle").textContent = CONFIG.STUDENT_NAME + "'s study record";
  populateSubjectSelect();
  loadAllEntries();
}

function populateSubjectSelect() {
  const sel = $("#f-subject");
  if (sel.options.length) return;
  sel.innerHTML = '<option value="" disabled selected>Choose a subject…</option>' +
    SUBJECTS.map(function (s) { return '<option value="' + escapeHtml(s) + '">' + escapeHtml(s) + '</option>'; }).join("");
}

async function loadAllEntries() {
  if (!isConfigured()) {
    $("#f-heatmap").innerHTML = "";
    $("#f-history").innerHTML = configWarningHtml();
    return;
  }
  net("Loading dashboard…");
  $("#f-history").innerHTML = '<div class="loading-row"><span class="spinner"></span></div>';
  try {
    const res = await apiGet({ action: "list" });
    const entries = (res && res.entries) ? res.entries : [];
    entries.forEach(function (e) {
      e._d = parseLocalDate(e.date);
      e._ts = e.timestamp ? new Date(e.timestamp).getTime() : e._d.getTime();
    });
    entries.sort(function (a, b) { return b._ts - a._ts; });
    state.entries = entries;

    renderStats();
    renderHeatmap();
    renderHistory();
    net(null);
  } catch (err) {
    net("Couldn't load data: " + err.message + " — check the Web App URL & deployment.", "error");
    $("#f-history").innerHTML = '<div class="empty">Could not reach the data source.<br>' +
      'Verify <code>WEB_APP_URL</code> and that the Web App is deployed for “Anyone”.</div>';
  }
}

/* ---- stats ---- */
function entriesOnDate(key) { return state.entries.filter(function (e) { return e.date === key; }); }
function slotsLoggedOn(key) { return new Set(entriesOnDate(key).map(function (e) { return e.slotId; })).size; }

function renderStats() {
  const E = state.entries;
  $("#stat-total").textContent = E.length;

  const wkStart = startOfWeekMon(new Date());
  const wkEnd = addDays(wkStart, 7);
  const wk = E.filter(function (e) { return e._d >= wkStart && e._d < wkEnd; });
  $("#stat-week").textContent = wk.length;

  const onTime = wk.filter(function (e) { return e.onTime === "On-time"; }).length;
  $("#stat-ontime").textContent = wk.length ? Math.round((onTime / wk.length) * 100) + "%" : "—";

  $("#stat-streak").textContent = computeStreak();
}

function computeStreak() {
  // count back over study days (Sun = off, skipped, doesn't break the streak)
  let streak = 0, cur = new Date(); cur.setHours(0,0,0,0);
  if (slotsLoggedOn(dateKey(cur)) === 0 && DAY_NAMES[cur.getDay()] !== "Sunday") cur = addDays(cur, -1);
  for (let i = 0; i < 400; i++) {
    const dn = DAY_NAMES[cur.getDay()];
    if (dn === "Sunday") { cur = addDays(cur, -1); continue; }
    if (slotsLoggedOn(dateKey(cur)) > 0) { streak++; cur = addDays(cur, -1); }
    else break;
  }
  return streak;
}

/* ---- heatmap (GitHub-style) ---- */
function levelClass(count) { return count >= 3 ? "lv4" : count === 2 ? "lv3" : count === 1 ? "lv2" : "lv0"; }

function renderHeatmap() {
  const host = $("#f-heatmap");
  const today = new Date(); today.setHours(0,0,0,0);

  let earliest = today;
  if (state.entries.length) {
    earliest = state.entries.reduce(function (m, e) { return e._d < m ? e._d : m; }, today);
    if (earliest > today) earliest = today;
  }
  let start = startOfWeekSun(addDays(earliest, -7));      // pad a week
  const cap = startOfWeekSun(addDays(today, -7 * 25));    // max ~26 weeks
  if (start < cap) start = cap;

  let html = "", cursor = new Date(start), prevMonth = -1;
  while (cursor <= today) {
    html += '<div class="hm-col">';
    const colMonth = cursor.getMonth();
    html += '<div class="hm-col-month">' + (colMonth !== prevMonth ? MONTHS[colMonth] : "&nbsp;") + '</div>';
    prevMonth = colMonth;

    for (let r = 0; r < 7; r++) {
      if (cursor > today) { html += '<div class="hm-spacer"></div>'; cursor = addDays(cursor, 1); continue; }
      const key = dateKey(cursor);
      if (cursor.getDay() === 0) {
        html += '<div class="hm-cell is-off" title="' + fmtShortDate(cursor) + ' · off day"></div>';
      } else {
        const n = slotsLoggedOn(key);
        html += '<div class="hm-cell ' + levelClass(n) + '" data-date="' + key + '" title="' + fmtShortDate(cursor) + ' · ' + n + '/3 sessions"></div>';
      }
      cursor = addDays(cursor, 1);
    }
    html += '</div>';
  }
  host.innerHTML = html;

  $$(".hm-cell[data-date]", host).forEach(function (cell) {
    cell.addEventListener("click", function () {
      $$(".hm-cell", host).forEach(function (c) { c.classList.remove("is-selected"); });
      cell.classList.add("is-selected");
      showDayDetail(cell.dataset.date);
    });
  });
}

function showDayDetail(key) {
  const box = $("#f-daydetail");
  const list = entriesOnDate(key).sort(function (a, b) { return a._ts - b._ts; });
  const d = parseLocalDate(key);
  box.hidden = false;
  box.innerHTML = '<h4>' + fmtLongDate(d) + ' — ' + list.length + ' ' + (list.length === 1 ? "entry" : "entries") + '</h4>' +
    (list.length ? '<div class="entry-list">' + list.map(function (e) { return entryHtml(e); }).join("") + '</div>'
                 : '<p class="empty">No entries logged this day.</p>');
}

/* ---- entry rendering ---- */
function entryHtml(e, highlight) {
  const ot = e.onTime === "On-time";
  const conf = e.confidence ? '<span class="entry-tag entry-tag--conf">' + escapeHtml(e.confidence) + '</span>' : "";
  let topic = escapeHtml(e.topic);
  if (highlight) {
    const re = new RegExp("(" + highlight.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")", "ig");
    topic = topic.replace(re, "<span class='mark'>$1</span>");
  }
  return '<div class="entry">' +
    '<span class="entry-dot ' + (ot ? "ontime" : "late") + '"></span>' +
    '<div class="entry-main">' +
      '<div class="entry-top">' +
        '<span class="entry-subject">' + escapeHtml(e.subject) + '</span>' +
        '<span class="entry-tag">' + escapeHtml(e.activity) + '</span>' + conf +
      '</div>' +
      '<p class="entry-topic">' + topic + '</p>' +
      '<p class="entry-meta">' + escapeHtml(e.day) + ' · ' + escapeHtml(e.timeSlot) + '</p>' +
    '</div>' +
    '<div class="entry-side">' +
      '<span class="badge ' + (ot ? "ontime" : "late") + '">' + (ot ? "On-time" : "Late") + '</span>' +
      '<span class="entry-time">' + (e._ts ? fmtTime(e._ts) : "") + '</span>' +
    '</div>' +
  '</div>';
}

function renderEntryList(host, list, opts) {
  opts = opts || {};
  if (!list.length) { host.innerHTML = '<div class="empty">' + (opts.empty || "No entries found.") + '</div>'; return; }
  host.innerHTML = list.map(function (e) { return entryHtml(e, opts.highlight); }).join("");
}

/* ---- history (day / week / month / all) ---- */
function renderHistory() {
  const range = state.hist.range, anchor = state.hist.anchor;
  $("#f-range-nav").style.visibility = range === "all" ? "hidden" : "visible";

  let list, label;
  if (range === "day") {
    list = entriesOnDate(dateKey(anchor));
    label = fmtLongDate(anchor);
  } else if (range === "week") {
    const s = startOfWeekMon(anchor), e = addDays(s, 7);
    list = state.entries.filter(function (x) { return x._d >= s && x._d < e; });
    label = fmtShortDate(s) + " – " + fmtShortDate(addDays(s, 6));
  } else if (range === "month") {
    list = state.entries.filter(function (x) { return x._d.getMonth() === anchor.getMonth() && x._d.getFullYear() === anchor.getFullYear(); });
    label = MONTHS_LONG[anchor.getMonth()] + " " + anchor.getFullYear();
  } else {
    list = state.entries.slice();
    label = "All time · " + list.length + " entries";
  }
  $("#f-range-label").textContent = label;
  list = list.slice().sort(function (a, b) { return b._ts - a._ts; });
  renderEntryList($("#f-history"), list, { empty: "Nothing logged for this " + (range === "all" ? "record" : range) + "." });
}

function stepRange(dir) {
  const a = state.hist.anchor;
  if (state.hist.range === "day") state.hist.anchor = addDays(a, dir);
  else if (state.hist.range === "week") state.hist.anchor = addDays(a, dir * 7);
  else if (state.hist.range === "month") state.hist.anchor = new Date(a.getFullYear(), a.getMonth() + dir, 1);
  renderHistory();
}

/* ---- subjects ---- */
function renderSubject(subject) {
  const list = state.entries.filter(function (e) { return e.subject === subject; })
    .sort(function (a, b) { return a._ts - b._ts; }); // chronological
  renderEntryList($("#f-subject-list"), list, { empty: "No entries logged for " + subject + " yet." });
}

/* ---- search ---- */
let searchT = null;
function runSearch(q) {
  const host = $("#f-search-results");
  q = q.trim();
  if (!q) { host.innerHTML = '<div class="empty">Type a keyword to search past topics.</div>'; return; }
  const ql = q.toLowerCase();
  const list = state.entries.filter(function (e) {
    return (e.topic && e.topic.toLowerCase().indexOf(ql) > -1) ||
           (e.subject && e.subject.toLowerCase().indexOf(ql) > -1);
  }).sort(function (a, b) { return b._ts - a._ts; });
  renderEntryList(host, list, { highlight: q, empty: "No matches for “" + escapeHtml(q) + "”." });
}

/* =============================================================
   HELP SYSTEM — flags + study materials
   ============================================================= */

function convertToEmbedUrl(url) {
  url = url.trim();
  const ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  if (ytMatch) return "https://www.youtube.com/embed/" + ytMatch[1];
  const driveFileMatch = url.match(/drive\.google\.com\/file\/d\/([^/?#\s]+)/);
  if (driveFileMatch) return "https://drive.google.com/file/d/" + driveFileMatch[1] + "/preview";
  const driveOpenMatch = url.match(/drive\.google\.com\/open\?id=([^&\s]+)/);
  if (driveOpenMatch) return "https://drive.google.com/file/d/" + driveOpenMatch[1] + "/preview";
  const docsMatch = url.match(/docs\.google\.com\/document\/d\/([^/?#\s]+)/);
  if (docsMatch) return "https://docs.google.com/document/d/" + docsMatch[1] + "/preview";
  const slidesMatch = url.match(/docs\.google\.com\/presentation\/d\/([^/?#\s]+)/);
  if (slidesMatch) return "https://docs.google.com/presentation/d/" + slidesMatch[1] + "/embed";
  const sheetsMatch = url.match(/docs\.google\.com\/spreadsheets\/d\/([^/?#\s]+)/);
  if (sheetsMatch) return "https://docs.google.com/spreadsheets/d/" + sheetsMatch[1] + "/preview";
  return url;
}

function helpSeenCount() {
  try { return parseInt(localStorage.getItem("st_help_seen") || "0", 10) || 0; } catch (_) { return 0; }
}
function setHelpSeen(n) {
  try { localStorage.setItem("st_help_seen", String(n)); } catch (_) {}
}

// markSeen=true when Minahil is actually viewing the Help tab (clears the badge);
// markSeen=false for a quiet background load that only refreshes the "new" badge.
async function loadHelpData(markSeen) {
  if (!isConfigured()) return;
  if (markSeen) net("Loading…");
  try {
    const [flagsRes, helpRes] = await Promise.all([
      apiGet({ action: "getFlags" }),
      apiGet({ action: "getHelp" })
    ]);
    state.flags     = (flagsRes && flagsRes.flags) ? flagsRes.flags : [];
    state.helpItems = (helpRes  && helpRes.items)  ? helpRes.items  : [];
    renderFlags();
    renderHelpBoard();

    const pip = $("#m-help-pip");
    if (markSeen) {
      setHelpSeen(state.helpItems.length);
      if (pip) pip.hidden = true;
      net(null);
    } else if (pip) {
      const unseen = Math.max(0, state.helpItems.length - helpSeenCount());
      pip.hidden = unseen === 0;
      pip.textContent = unseen;
    }
  } catch (err) {
    if (markSeen) net("Couldn't load help data.", "error");
  }
}

function renderFlags() {
  const host = $("#m-flags-list");
  if (!host) return;
  const list = state.flags.slice().reverse();
  if (!list.length) {
    host.innerHTML = '<div class="empty">No questions flagged yet. Use the button below when something is unclear.</div>';
  } else {
    host.innerHTML = list.map(function (f) {
      const pending = f.status === "pending";
      return '<div class="flag-card flag--' + escapeHtml(f.status) + '">' +
        '<div class="flag-meta">' +
          '<span class="flag-date">' + escapeHtml(f.date) + '</span>' +
          '<span class="flag-status-badge flag-status--' + escapeHtml(f.status) + '">' +
            (pending ? "Waiting for help" : "Understood ✓") +
          '</span>' +
        '</div>' +
        '<p class="flag-msg">' + escapeHtml(f.message) + '</p>' +
        (pending ?
          '<div class="flag-actions">' +
            '<button class="btn btn--small btn--student" data-flag-resolve="' + escapeHtml(f.id) + '">Mark as understood ✓</button>' +
            '<button class="btn btn--small btn--ghost" data-flag-add-more>Still not clear — add another flag</button>' +
          '</div>' : '') +
      '</div>';
    }).join("");
    $$("[data-flag-resolve]", host).forEach(function (btn) {
      btn.addEventListener("click", function () { markFlagDone(btn.dataset.flagResolve); });
    });
    $$("[data-flag-add-more]", host).forEach(function (btn) {
      btn.addEventListener("click", showFlagForm);
    });
  }
}

function renderHelpBoard() {
  const host = $("#m-help-board");
  if (!host) return;
  const items = state.helpItems.slice().reverse();
  if (!items.length) {
    host.innerHTML = '<div class="empty">No study materials yet. Fiaz will add explanations here when you flag a question.</div>';
    return;
  }
  host.innerHTML = items.map(function (item) {
    const embedUrl = convertToEmbedUrl(item.driveLink || "");
    const d = item.timestamp ? new Date(item.timestamp) : null;
    const dateStr = d && !isNaN(d) ? fmtShortDate(d) : (item.date || "");
    return '<div class="help-material-card">' +
      '<div class="help-material-head">' +
        '<h4 class="help-material-title">' + escapeHtml(item.title) + '</h4>' +
        (dateStr ? '<span class="help-material-date">' + escapeHtml(dateStr) + '</span>' : '') +
      '</div>' +
      '<div class="help-iframe-wrap">' +
        '<iframe src="' + escapeHtml(embedUrl) + '" class="help-iframe" allowfullscreen loading="lazy" title="' + escapeHtml(item.title) + '"></iframe>' +
      '</div>' +
      '<div class="help-material-foot">' +
        '<a href="' + escapeHtml(item.driveLink) + '" target="_blank" rel="noopener noreferrer" class="help-open-link">Can&rsquo;t see it above? Open in a new tab ↗</a>' +
      '</div>' +
    '</div>';
  }).join("");
}

function showFlagForm() {
  $("#m-flag-form").hidden = false;
  $("#m-add-flag-btn").hidden = true;
  $("#m-flag-text").focus();
}
function hideFlagForm() {
  const form = $("#m-flag-form");
  form.hidden = true;
  form.reset();
  $("#m-add-flag-btn").hidden = false;
}

async function submitFlag(e) {
  e.preventDefault();
  const message = $("#m-flag-text").value.trim();
  if (!message) return;
  const btn = $("[type=submit]", e.target);
  btn.disabled = true; btn.textContent = "Submitting…";
  const info = todayInfo();
  try {
    const res = await apiPost({ action: "submitFlag", date: info.dateStr, message: message });
    if (!res || !res.ok) throw new Error(res && res.error ? res.error : "Failed");
    state.flags.push(res.flag);
    hideFlagForm();
    renderFlags();
    showToast("Flag submitted — Fiaz will respond soon.", false);
  } catch (err) {
    net("Couldn't submit flag: " + err.message, "error");
  } finally {
    btn.disabled = false; btn.textContent = "Submit Flag";
  }
}

async function markFlagDone(id) {
  try {
    const res = await apiPost({ action: "updateFlag", id: id, status: "resolved" });
    if (!res || !res.ok) throw new Error(res && res.error ? res.error : "Failed");
    const flag = state.flags.find(function (f) { return f.id === id; });
    if (flag) flag.status = "resolved";
    renderFlags();
    showToast("Marked as understood!", false);
  } catch (err) {
    net("Couldn't update: " + err.message, "error");
  }
}

async function loadFiazHelpData() {
  if (!isConfigured()) return;
  net("Loading…");
  try {
    const [flagsRes, helpRes] = await Promise.all([
      apiGet({ action: "getFlags" }),
      apiGet({ action: "getHelp" })
    ]);
    state.flags     = (flagsRes && flagsRes.flags) ? flagsRes.flags : [];
    state.helpItems = (helpRes  && helpRes.items)  ? helpRes.items  : [];
    renderFiazFlagsPanel();
    renderFiazHelpList();
    net(null);
  } catch (err) {
    net("Couldn't load help data.", "error");
  }
}

function renderFiazFlagsPanel() {
  const host = $("#f-flags-list");
  if (!host) return;
  const list = state.flags.slice().reverse();
  if (!list.length) {
    host.innerHTML = '<div class="empty">No help requests from Minahil yet.</div>';
    return;
  }
  host.innerHTML = list.map(function (f) {
    return '<div class="flag-card flag--' + escapeHtml(f.status) + '">' +
      '<div class="flag-meta">' +
        '<span class="flag-date">' + escapeHtml(f.date) + '</span>' +
        '<span class="flag-status-badge flag-status--' + escapeHtml(f.status) + '">' +
          (f.status === "pending" ? "Pending" : "Resolved") +
        '</span>' +
      '</div>' +
      '<p class="flag-msg">' + escapeHtml(f.message) + '</p>' +
    '</div>';
  }).join("");
}

function renderFiazHelpList() {
  const host = $("#f-help-list");
  if (!host) return;
  const items = state.helpItems.slice().reverse();
  if (!items.length) {
    host.innerHTML = '<div class="empty">No materials added yet.</div>';
    return;
  }
  host.innerHTML = items.map(function (item) {
    const d = item.timestamp ? new Date(item.timestamp) : null;
    const dateStr = d && !isNaN(d) ? fmtShortDate(d) : (item.date || "");
    return '<div class="f-help-item">' +
      '<div class="f-help-item-info">' +
        '<span class="f-help-item-title">' + escapeHtml(item.title) + '</span>' +
        (dateStr ? '<span class="f-help-item-date">' + escapeHtml(dateStr) + '</span>' : '') +
      '</div>' +
      '<a href="' + escapeHtml(item.driveLink) + '" target="_blank" rel="noopener noreferrer" class="btn btn--ghost btn--small">Open ↗</a>' +
    '</div>';
  }).join("");
}

async function submitHelpMaterial(e) {
  e.preventDefault();
  const title     = $("#f-help-title").value.trim();
  const driveLink = $("#f-help-url").value.trim();
  const errEl = $("#f-help-error");
  const okEl  = $("#f-help-success");
  if (!title || !driveLink) { errEl.hidden = false; okEl.hidden = true; return; }
  errEl.hidden = true; okEl.hidden = true;
  const btn = $("[type=submit]", e.target);
  btn.disabled = true; btn.textContent = "Adding…";
  try {
    const res = await apiPost({ action: "submitHelp", title: title, driveLink: driveLink });
    if (!res || !res.ok) throw new Error(res && res.error ? res.error : "Failed");
    state.helpItems.push(res.item);
    $("#f-help-title").value = "";
    $("#f-help-url").value = "";
    okEl.hidden = false;
    setTimeout(function () { okEl.hidden = true; }, 3000);
    renderFiazHelpList();
  } catch (err) {
    net("Couldn't add material: " + err.message, "error");
  } finally {
    btn.disabled = false; btn.textContent = "Add Material to Board";
  }
}

/* =============================================================
   EVENT WIRING + INIT
   ============================================================= */
function bind() {
  // landing role buttons
  $$(".role-btn").forEach(function (b) { b.addEventListener("click", function () { openGate(b.dataset.role); }); });

  // display names
  $$("[data-bind='studentName']").forEach(function (n) { n.textContent = CONFIG.STUDENT_NAME; });
  $$("[data-bind='parentName']").forEach(function (n) { n.textContent = CONFIG.PARENT_NAME; });

  // gate
  $("#gate-form").addEventListener("submit", tryUnlock);
  $("[data-close-gate]").addEventListener("click", closeGate);
  $("#gate").addEventListener("click", function (e) { if (e.target.id === "gate") closeGate(); });

  // logout / refresh
  $$("[data-logout]").forEach(function (b) { b.addEventListener("click", logout); });
  $("[data-refresh]").addEventListener("click", loadAllEntries);

  // toast undo
  $("#toast-undo").addEventListener("click", undoLast);

  // Fiaz tabs
  $$(".tab").forEach(function (tab) {
    tab.addEventListener("click", function () {
      $$(".tab").forEach(function (t) { t.classList.remove("is-active"); });
      tab.classList.add("is-active");
      const name = tab.dataset.tab;
      $$(".tab-panel").forEach(function (p) {
        const on = p.dataset.panel === name;
        p.classList.toggle("is-active", on); p.hidden = !on;
      });
      if (name === "help") loadFiazHelpData();
    });
  });

  // Minahil tabs
  $$(".m-tab").forEach(function (tab) {
    tab.addEventListener("click", function () {
      $$(".m-tab").forEach(function (t) { t.classList.remove("is-active"); });
      tab.classList.add("is-active");
      const name = tab.dataset.mtab;
      $$(".m-tab-panel").forEach(function (p) {
        const on = p.dataset.mpanel === name;
        p.classList.toggle("is-active", on); p.hidden = !on;
      });
      if (name === "help") loadHelpData(true);
    });
  });

  // flag form (Minahil)
  $("#m-flag-form").addEventListener("submit", submitFlag);
  $("#m-add-flag-btn").addEventListener("click", showFlagForm);
  $("#m-flag-cancel").addEventListener("click", hideFlagForm);
  $("#m-help-refresh").addEventListener("click", function () { loadHelpData(true); });

  // help material form (Fiaz)
  $("#f-help-form").addEventListener("submit", submitHelpMaterial);

  // history range
  $$("#f-range .seg").forEach(function (seg) {
    seg.addEventListener("click", function () {
      $$("#f-range .seg").forEach(function (s) { s.classList.remove("is-active"); });
      seg.classList.add("is-active");
      state.hist.range = seg.dataset.range;
      state.hist.anchor = new Date();
      renderHistory();
    });
  });
  $$("#f-range-nav [data-step]").forEach(function (b) {
    b.addEventListener("click", function () { stepRange(Number(b.dataset.step)); });
  });

  // subjects
  $("#f-subject").addEventListener("change", function (e) { renderSubject(e.target.value); });

  // search
  $("#f-search").addEventListener("input", function (e) {
    clearTimeout(searchT);
    const v = e.target.value;
    searchT = setTimeout(function () { runSearch(v); }, 180);
  });

  // resume session if still logged in
  let saved = null;
  try { saved = sessionStorage.getItem("st_role"); } catch (_) {}
  if (saved === "minahil" || saved === "fiaz") enterRole(saved);
  else showScreen("landing");
}

document.addEventListener("DOMContentLoaded", bind);
