// Formatting helpers shared by the server renderer and the client components.
// Every display string is produced here so the SSR pass and the 60s poll always
// agree byte-for-byte (which is what hydration requires).

const two = (n: number): string => String(n).padStart(2, "0");

export const fmtTime = (d: Date): string => `${two(d.getHours())}:${two(d.getMinutes())}`;

export const fmtDate = (d: Date): string => `${d.getMonth() + 1}-${two(d.getDate())}`;

/** 7_200_000 -> "2小时"; 3d5h -> "3天 5小时"; negative input clamps at 0. */
export function fmtCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (d > 0) return `${d}天 ${h}小时`;
  if (h > 0) return `${h}小时 ${m}分`;
  return `${m}分`;
}

/** 1_000_479_997 -> "10.0亿"; keeps the panel narrow and stable-width. */
export function fmtTokens(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n >= 1e8) return `${(n / 1e8).toFixed(n >= 1e9 ? 1 : 2)}亿`;
  if (n >= 1e4) return `${(n / 1e4).toFixed(1)}万`;
  return String(n);
}

/** Locale is pinned: bare toLocaleString() drifts between Node and Firefox. */
export const fmtInt = (n: number): string => (Number.isFinite(n) ? n.toLocaleString("en-US") : "—");

/** Reset moment: "HH:MM" within 24h, "M-DD HH:MM" beyond, "未知" when absent. */
export function resetAtText(resetMs: number | null, now: number): string {
  if (resetMs === null || !Number.isFinite(resetMs)) return "未知";
  const d = new Date(resetMs);
  return (resetMs - now) / 3_600_000 > 24 ? `${fmtDate(d)} ${fmtTime(d)}` : fmtTime(d);
}

/** Reset countdown with suffix: "2小时 3分 后重置" / "重置时间未知". */
export function resetInText(resetMs: number | null, now: number): string {
  if (resetMs === null || !Number.isFinite(resetMs)) return "重置时间未知";
  return `${fmtCountdown(resetMs - now)} 后重置`;
}

/** Navbar health slot; the client may override it with a transient flash. */
export const healthText = (ok: boolean): string => (ok ? "正常" : "⚠ 数据陈旧");

const WEEKDAYS = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];

/** Date-wall label: "10月15日". */
export const fmtMonthDay = (d: Date): string => `${d.getMonth() + 1}月${d.getDate()}日`;

/** "星期四" — from getDay() so it never depends on ICU/locale data. */
export const fmtWeekday = (d: Date): string => WEEKDAYS[d.getDay()];
