// Business-hours aware SLA maths.
// Times are interpreted in the server's local time zone — set TZ in the environment
// (for example TZ=Europe/London) so business hours match your office.

const MIN = 60_000;

function hm(s) {
  const [h, m] = String(s).split(':').map(Number);
  return { h: h || 0, m: m || 0 };
}

function ymd(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function is24x7(cfg) {
  if (!cfg || !Array.isArray(cfg.workdays) || cfg.workdays.length === 0) return true;
  return cfg.start === cfg.end;
}

function isWorkday(d, cfg) {
  return cfg.workdays.includes(d.getDay()) && !(cfg.holidays || []).includes(ymd(d));
}

function at(d, t) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), t.h, t.m, 0, 0);
}

function nextDayStart(d, start) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, start.h, start.m, 0, 0);
}

/** Add `minutes` of business time to `from`, returning the resulting Date. */
export function addBusinessMinutes(from, minutes, cfg) {
  const startT = new Date(from);
  if (minutes <= 0) return startT;
  if (is24x7(cfg)) return new Date(startT.getTime() + minutes * MIN);

  const s = hm(cfg.start);
  const e = hm(cfg.end);
  let t = startT;
  let remaining = minutes;
  for (let guard = 0; guard < 3700; guard++) {
    if (!isWorkday(t, cfg)) { t = nextDayStart(t, s); continue; }
    const dayStart = at(t, s);
    const dayEnd = at(t, e);
    if (t < dayStart) t = dayStart;
    if (t >= dayEnd) { t = nextDayStart(t, s); continue; }
    const available = (dayEnd - t) / MIN;
    if (remaining <= available) return new Date(t.getTime() + remaining * MIN);
    remaining -= available;
    t = nextDayStart(t, s);
  }
  throw new Error('Business hours configuration has no working time');
}

/** Business minutes elapsed between two instants. */
export function businessMinutesBetween(a, b, cfg) {
  let t = new Date(a);
  const end = new Date(b);
  if (end <= t) return 0;
  if (is24x7(cfg)) return Math.round((end - t) / MIN);

  const s = hm(cfg.start);
  const e = hm(cfg.end);
  let total = 0;
  for (let guard = 0; guard < 3700 && t < end; guard++) {
    if (isWorkday(t, cfg)) {
      const from = Math.max(t, at(t, s));
      const to = Math.min(end, at(t, e));
      if (to > from) total += (to - from) / MIN;
    }
    t = nextDayStart(t, { h: 0, m: 0 });
  }
  return Math.round(total);
}
