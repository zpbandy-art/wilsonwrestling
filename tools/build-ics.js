#!/usr/bin/env node
// Builds calendar.ics (meets only) from data/*.csv at deploy time.
// No dependencies. Run from anywhere: node tools/build-ics.js
// Output is NOT committed; GitHub Actions generates it on every deploy.
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SITE = "https://zpbandy-art.github.io/wilsonwrestling/";
const CAL_NAME = "Wilson Memorial Wrestling";
// Assumed lengths for timed single-day meets (hours).
const HOURS = { dual: 2.5, tri: 3, duals: 8, tournament: 8 };

function parseCSV(text) {
  const rows = []; let row = [], field = "", q = false;
  text = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
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
function load(name) {
  const f = path.join(ROOT, "data", name + ".csv");
  return fs.existsSync(f) ? parseCSV(fs.readFileSync(f, "utf8")) : [];
}

const events = load("events");
const venues = Object.fromEntries(load("venues").map(v => [v.slug, v]));
const schools = Object.fromEntries(load("schools").map(s => [s.slug, s]));
const isYes = v => /^(y|yes|true|1|x)$/i.test(v || "");
const schoolName = s => (schools[s] || {}).short || (schools[s] || {}).name || s;

function title(ev) {
  if (ev.name) return ev.name;
  const opps = (ev.opponents || "").split("|").filter(Boolean).map(schoolName);
  const home = isYes((venues[ev.venue] || {}).home);
  return opps.length ? `${home ? "vs" : "@"} ${opps.join(" & ")}` : "Wrestling meet";
}

// --- iCalendar helpers ---
const esc = s => String(s || "").replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
function fold(line) {               // fold at 75 octets
  const out = []; let cur = "", n = 0;
  for (const ch of line) {
    const b = Buffer.byteLength(ch);
    if (n + b > (out.length ? 74 : 75)) { out.push(cur); cur = ""; n = 0; }
    cur += ch; n += b;
  }
  out.push(cur);
  return out.join("\r\n ");
}
const ymd = d => d.replace(/-/g, "");
function addDays(d, n) {
  const [y, m, dd] = d.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, dd + n));
  return t.toISOString().slice(0, 10);
}
function localStamp(date, time, addHours = 0) {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d, hh, mm) + addHours * 3600e3);
  const p = n => String(n).padStart(2, "0");
  return `${t.getUTCFullYear()}${p(t.getUTCMonth() + 1)}${p(t.getUTCDate())}T${p(t.getUTCHours())}${p(t.getUTCMinutes())}00`;
}
function fmt12(time) {
  const [h, m] = time.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
}

const now = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
const L = [
  "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Wilson Memorial Wrestling//Schedule//EN",
  "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
  `X-WR-CALNAME:${esc(CAL_NAME)}`, "X-WR-TIMEZONE:America/New_York",
  "REFRESH-INTERVAL;VALUE=DURATION:PT6H", "X-PUBLISHED-TTL:PT6H",
  "BEGIN:VTIMEZONE", "TZID:America/New_York",
  "BEGIN:DAYLIGHT", "TZOFFSETFROM:-0500", "TZOFFSETTO:-0400", "TZNAME:EDT",
  "DTSTART:19700308T020000", "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU", "END:DAYLIGHT",
  "BEGIN:STANDARD", "TZOFFSETFROM:-0400", "TZOFFSETTO:-0500", "TZNAME:EST",
  "DTSTART:19701101T020000", "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU", "END:STANDARD",
  "END:VTIMEZONE",
];

for (const ev of events) {
  if (!ev.id || !ev.date) continue;
  const v = venues[ev.venue] || {};
  const multi = ev.end_date && ev.end_date !== ev.date;
  const url = `${SITE}event.html?id=${encodeURIComponent(ev.id)}`;
  const notes = [];
  if (multi && ev.time) notes.push(`Starts ${fmt12(ev.time)} on day 1.`);
  if (!ev.time) notes.push("Start time TBA.");
  if (ev.notes) notes.push(ev.notes);
  if (/^https:\/\/(www\.)?(flowrestling\.org|trackwrestling\.com)\//.test(ev.flo || "")) notes.push(`Brackets & live results: ${ev.flo}`);
  notes.push(`Details and results: ${url}`);

  L.push("BEGIN:VEVENT", `UID:wilsonwrestling-event-${ev.id}@zpbandy-art.github.io`, `DTSTAMP:${now}`);
  if (ev.time && !multi) {
    L.push(`DTSTART;TZID=America/New_York:${localStamp(ev.date, ev.time)}`,
           `DTEND;TZID=America/New_York:${localStamp(ev.date, ev.time, HOURS[ev.type] || 3)}`);
  } else {               // all-day (multi-day tournaments or TBA time); DTEND is exclusive
    L.push(`DTSTART;VALUE=DATE:${ymd(ev.date)}`, `DTEND;VALUE=DATE:${ymd(addDays(ev.end_date || ev.date, 1))}`);
  }
  L.push(`SUMMARY:${esc("Wrestling: " + title(ev))}`);
  const loc = [v.name, v.address].filter(Boolean).join(", ");
  if (loc) L.push(`LOCATION:${esc(loc)}`);
  L.push(`DESCRIPTION:${esc(notes.join("\n"))}`, `URL:${url}`, "END:VEVENT");
}
L.push("END:VCALENDAR");

fs.writeFileSync(path.join(ROOT, "calendar.ics"), L.map(fold).join("\r\n") + "\r\n");
console.log(`calendar.ics: ${events.length} events`);
