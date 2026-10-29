// when is a routine due? (pure, tested in test/schedule.test.js)
// <when> formats: "daily 07:00", "weekdays 21:00", "weekends 10:00", "mon 08:00", "mon,thu 18:00", "every 3h"
// returns a key for this run (so it only fires once), or null if it isn't due right now.
const DAYS = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
function routineDue(r, n) {
  const w = String(r.when || '').toLowerCase();
  const hm = `${String(n.getHours()).padStart(2, '0')}:${String(n.getMinutes()).padStart(2, '0')}`;
  const ev = w.match(/every\s+(\d+)\s*h/);
  if (ev) { const key = `${n.toDateString()}-${Math.floor(n.getHours() / Number(ev[1]))}`; return r.last !== key && n.getMinutes() < 2 ? key : null; }
  const t = (w.match(/(\d{1,2}):(\d{2})/) || [])[0];
  if (!t || t.padStart(5, '0') !== hm) return null;
  const d = n.getDay();
  const dayOk = /daily|every ?day/.test(w) || (/weekdays/.test(w) && d >= 1 && d <= 5) || (/weekends/.test(w) && (d === 0 || d === 6)) ||
    Object.entries(DAYS).some(([k, v]) => w.includes(k) && v === d);
  const key = n.toDateString() + hm;
  return dayOk && r.last !== key ? key : null;
}
module.exports = { routineDue, DAYS };
