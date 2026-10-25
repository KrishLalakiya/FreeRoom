const DEFAULT_TIME_ZONE = 'Asia/Kolkata';

const formatterCache = new Map();

function pad(n) {
  return String(n).padStart(2, '0');
}

function getFormatter(timeZone) {
  if (!formatterCache.has(timeZone)) {
    formatterCache.set(
      timeZone,
      new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
      })
    );
  }
  return formatterCache.get(timeZone);
}

function campusTimeZone() {
  return process.env.CAMPUS_TIMEZONE || DEFAULT_TIME_ZONE;
}

function zonedParts(date, timeZone = campusTimeZone()) {
  const parts = getFormatter(timeZone).formatToParts(date);
  const out = {};
  for (const part of parts) {
    if (part.type !== 'literal') out[part.type] = Number(part.value);
  }
  return {
    year: out.year,
    month: out.month,
    day: out.day,
    hour: out.hour,
    minute: out.minute,
    second: out.second,
  };
}

export function toDateStr(date = new Date(), timeZone = campusTimeZone()) {
  const p = zonedParts(date, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

export function isValidDateStr(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const probe = new Date(Date.UTC(year, month - 1, day));
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

export function dayOfWeekForDateStr(dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function dayOfWeekInTz(date = new Date(), timeZone = campusTimeZone()) {
  return dayOfWeekForDateStr(toDateStr(date, timeZone));
}

export function addDaysToDateStr(dateStr, days) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
}

export function getOffsetMinutes(timeZone, date) {
  const p = zonedParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - date.getTime()) / 60000);
}

export function zonedTimeToUtc(dateStr, timeStr, timeZone = campusTimeZone()) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const [hours, minutes, seconds = 0] = String(timeStr).split(':').map(Number);
  const wallClock = Date.UTC(year, month - 1, day, hours, minutes, seconds);

  let guess = wallClock;
  for (let i = 0; i < 3; i += 1) {
    const offset = getOffsetMinutes(timeZone, new Date(guess));
    const next = wallClock - offset * 60000;
    if (next === guess) break;
    guess = next;
  }
  return new Date(guess);
}
