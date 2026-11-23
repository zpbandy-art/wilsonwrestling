/* Wilson Memorial Wrestling - shared helpers. Loaded by every page. */
"use strict";

const SITE = {
  team: "Wilson Memorial",
  mascot: "Hornets",
  season: "2026-27",
  // Photo gallery switch. false = Photos tab, gallery page and meet-page photo links are hidden.
  photosEnabled: false,
};

/* ---------- CSV ---------- */
function parseCSV(text) {
  const rows = [];
  let row = [], field = "", q = false;
  text = text.replace(/^﻿/, "");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else q = false;
      } else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some(v => v.trim() !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some(v => v.trim() !== "")) rows.push(row);
  if (!rows.length) return [];
  const head = rows.shift().map(h => h.trim());
  return rows.map(r => Object.fromEntries(head.map((h, i) => [h, (r[i] || "").trim()])));
}

async function loadCSV(name, optional = false) {
  try {
    const res = await fetch(`data/${name}.csv`, { cache: "no-cache" });
    if (!res.ok) throw new Error(`${name}.csv: ${res.status}`);
    return parseCSV(await res.text());
  } catch (e) {
    if (optional) return [];
    throw e;
  }
}

async function loadAll() {
  const [roster, events, bouts, venues, schools, photos] = await Promise.all([
    loadCSV("roster"), loadCSV("events"), loadCSV("bouts", true),
    loadCSV("venues", true), loadCSV("schools", true),
    SITE.photosEnabled ? loadCSV("photos", true) : Promise.resolve([]),
  ]);
  const data = {
    roster, events, bouts, venues, schools, photos,
    wrestlerById: Object.fromEntries(roster.map(w => [w.id, w])),
    eventById: Object.fromEntries(events.map(e => [e.id, e])),
    venueBySlug: Object.fromEntries(venues.map(v => [v.slug, v])),
    schoolBySlug: Object.fromEntries(schools.map(s => [s.slug, s])),
  };
  events.sort((a, b) => (a.date + (a.time || "")).localeCompare(b.date + (b.time || "")));
  return data;
}

/* ---------- Rules ---------- */
// Methods that are recorded but never shown on the public site.
const HIDDEN_METHODS = new Set(["FF", "DF", "SCR"]);
// Team points a bout win is worth in a dual.
const DUAL_POINTS = { F: 6, TF: 5, MD: 4, D: 3, FF: 6, DF: 6, DQ: 6 };
const METHOD_LABEL = { F: "Fall", TF: "Tech Fall", MD: "Major Dec.", D: "Decision", DQ: "DQ", FF: "Forfeit", DF: "Default", SCR: "Scratch" };
const isYes = v => /^(y|yes|true|1|x)$/i.test(v || "");

// Shown publicly: has one of our wrestlers and isn't a hidden method.
function isVisible(b) {
  return b.wrestler && !HIDDEN_METHODS.has(b.method);
}
// Counts toward an individual's record.
function countsForRecord(b) {
  return isVisible(b) && !isYes(b.exhibition) && (b.result === "W" || b.result === "L");
}

function wrestlerStats(id, bouts) {
  const s = { W: 0, L: 0, F: 0, TF: 0, MD: 0, D: 0, matches: 0 };
  for (const b of bouts) {
    if (b.wrestler !== id || !countsForRecord(b)) continue;
    s.matches++;
    s[b.result]++;
    if (b.result === "W" && s[b.method] !== undefined) s[b.method]++;
  }
  return s;
}

function eventOpponents(ev, bouts) {
  const listed = (ev.opponents || "").split("|").map(x => x.trim()).filter(Boolean);
  if (listed.length) return listed;
  return [...new Set(bouts.filter(b => b.event === ev.id && b.opp_school).map(b => b.opp_school))];
}

const isDualType = ev => ev.type === "dual" || ev.type === "tri" || ev.type === "duals";
// Every school attending (for the "teams attending" popup).
const eventField = ev => (ev.field || "").split("|").map(x => x.trim()).filter(Boolean);

// Dual scores per opponent, calculated from bouts (including hidden ones).
function dualScores(ev, bouts) {
  if (!isDualType(ev)) return [];
  return eventOpponents(ev, bouts).map(opp => {
    let us = 0, them = 0, n = 0;
    for (const b of bouts) {
      if (b.event !== ev.id || b.opp_school !== opp || isYes(b.exhibition)) continue;
      n++;
      const pts = DUAL_POINTS[b.method] || 0;
      if (b.result === "W") us += pts;
      else if (b.result === "L") them += pts;
    }
    return { opp, us, them, played: n > 0 };
  });
}

function teamRecord(data) {
  let W = 0, L = 0, T = 0;
  for (const ev of data.events) {
    for (const d of dualScores(ev, data.bouts)) {
      if (!d.played) continue;
      if (d.us > d.them) W++; else if (d.us < d.them) L++; else T++;
    }
  }
  return { W, L, T };
}

/* ---------- Formatting ---------- */
const blank = n => (n ? String(n) : "");          // zero stats show blank
const fullName = w => (w ? `${w.first} ${w.last}` : "");
const schoolName = (data, slug) => (data.schoolBySlug[slug] || {}).name || slug || "";
const schoolShort = (data, slug) => {
  const s = data.schoolBySlug[slug] || {};
  return s.short || s.name || slug || "";
};

// School logo tile (white tile so dark logos survive dark mode). Empty if no logo.
function schoolLogo(data, slug, cls = "crest") {
  if (slug === "wilson") return `<img class="${cls}" src="logos/hornet.png?v=2" alt="">`;
  const s = data.schoolBySlug[slug];
  return s && isYes(s.logo) ? `<img class="${cls}" src="logos/${encodeURIComponent(slug)}.png" alt="">` : "";
}

function parseDate(s) {
  const [y, m, d] = (s || "").split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}
function fmtDate(s, opts = { weekday: "short", month: "short", day: "numeric" }) {
  return s ? parseDate(s).toLocaleDateString("en-US", opts) : "";
}
function fmtTime(t) {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  const ap = h >= 12 ? "PM" : "AM";
  return `${((h + 11) % 12) + 1}:${String(m || 0).padStart(2, "0")} ${ap}`;
}
// Last day of a meet (multi-day tournaments use end_date).
const eventEnd = ev => ev.end_date || ev.date;
// "Fri, Dec 18 – Sat, Dec 19" style range, or a single date.
function fmtDateRange(ev, opts) {
  if (!ev.end_date || ev.end_date === ev.date) return fmtDate(ev.date, opts);
  return `${fmtDate(ev.date, opts)} – ${fmtDate(ev.end_date, opts)}`;
}
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function eventTitle(data, ev) {
  if (isDualType(ev) && !ev.name) {
    const opps = eventOpponents(ev, data.bouts).map(o => schoolShort(data, o));
    return opps.length ? "vs " + opps.join(" & ") : "Dual";
  }
  return ev.name || "";
}
function isHome(data, ev) {
  return isYes((data.venueBySlug[ev.venue] || {}).home);
}
function venueName(data, ev) {
  return (data.venueBySlug[ev.venue] || {}).name || ev.venue || "";
}

// Bout result text like "Fall 1:23" or "Dec. 7-3".
function boutDetail(b) {
  const m = METHOD_LABEL[b.method] || b.method || "";
  if (b.method === "F" && b.time) return `${m} ${b.time}`;
  if (b.score) return `${m} ${b.score}`;
  return m;
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ---------- Page chrome ---------- */
function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem("theme"); } catch (e) {}
  if (saved) document.documentElement.setAttribute("data-theme", saved);
  const btn = document.getElementById("themeBtn");
  if (!btn) return;
  btn.addEventListener("click", () => {
    const dark = document.documentElement.getAttribute("data-theme") === "dark" ||
      (!document.documentElement.getAttribute("data-theme") && matchMedia("(prefers-color-scheme: dark)").matches);
    const next = dark ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem("theme", next); } catch (e) {}
  });
}

// Show the Photos tab only when the gallery is switched on.
function initPhotosNav() {
  const t = document.getElementById("navPhotos");
  if (t && SITE.photosEnabled) t.hidden = false;
}
const photosFor = (data, eventId) => data.photos.filter(p => p.event === eventId && p.file);

function setFooter(version) {
  const f = document.getElementById("footer");
  if (f) f.innerHTML = `${esc(SITE.team)} ${esc(SITE.mascot)} Wrestling &middot; ${esc(SITE.season)} &middot; v${esc(version)}`;
}

function showError(el, e) {
  console.error(e);
  el.innerHTML = `<p class="empty">Couldn't load data. Pull down to refresh.</p>`;
}

document.addEventListener("DOMContentLoaded", () => { initTheme(); initPhotosNav(); });
