/**
 * Mise en forme des dates, durées et nombres pour l'interface.
 *
 * Tout est affiché dans le fuseau horaire de l'utilisateur (par défaut
 * `Africa/Tunis`) et en français. Les dates sont stockées en UTC et ne sont
 * converties qu'à l'affichage : aucune date n'est enregistrée en heure locale.
 */

export const DEFAULT_TIMEZONE = "Africa/Tunis";
export const DEFAULT_LOCALE = "fr-TN";

function toDate(value: Date | string | number): Date {
  return value instanceof Date ? value : new Date(value);
}

/** Date courte : « 12 mars 2026 ». */
export function formatDate(
  value: Date | string | number,
  options: { timeZone?: string; locale?: string } = {},
): string {
  const date = toDate(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(options.locale ?? DEFAULT_LOCALE, {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: options.timeZone ?? DEFAULT_TIMEZONE,
  }).format(date);
}

/** Date et heure : « 12 mars 2026 à 18:30 ». */
export function formatDateTime(
  value: Date | string | number,
  options: { timeZone?: string; locale?: string } = {},
): string {
  const date = toDate(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(options.locale ?? DEFAULT_LOCALE, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: options.timeZone ?? DEFAULT_TIMEZONE,
  }).format(date);
}

/** Heure seule : « 18:30 ». */
export function formatTime(
  value: Date | string | number,
  options: { timeZone?: string; locale?: string } = {},
): string {
  const date = toDate(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(options.locale ?? DEFAULT_LOCALE, {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: options.timeZone ?? DEFAULT_TIMEZONE,
  }).format(date);
}

/** Date relative lisible : « dans 2 heures », « il y a 3 jours ». */
export function formatRelative(value: Date | string | number, now: Date = new Date()): string {
  const date = toDate(value);
  if (Number.isNaN(date.getTime())) return "—";
  const deltaMs = date.getTime() - now.getTime();
  const minutes = Math.round(deltaMs / 60_000);
  const formatter = new Intl.RelativeTimeFormat(DEFAULT_LOCALE, { numeric: "auto" });

  if (Math.abs(minutes) < 60) return formatter.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return formatter.format(hours, "hour");
  const days = Math.round(hours / 24);
  if (Math.abs(days) < 30) return formatter.format(days, "day");
  const months = Math.round(days / 30);
  if (Math.abs(months) < 12) return formatter.format(months, "month");
  return formatter.format(Math.round(months / 12), "year");
}

/** Durée pédagogique : « 1 h 25 min » ou « 45 min ». */
export function formatDuration(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) return "—";
  const totalMinutes = Math.round(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes} min`;
  if (minutes === 0) return `${hours} h`;
  return `${hours} h ${minutes.toString().padStart(2, "0")} min`;
}

/** Nombre avec séparateurs français : « 1 250 ». */
export function formatNumber(value: number): string {
  return new Intl.NumberFormat(DEFAULT_LOCALE).format(value);
}

/** Pourcentage borné : « 72 % ». */
export function formatPercent(value: number): string {
  const clamped = Math.max(0, Math.min(100, value));
  return `${Math.round(clamped)} %`;
}
