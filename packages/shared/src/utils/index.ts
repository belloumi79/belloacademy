import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "../domain/index";

/** Normalise un e-mail : minuscules + trim. Utilisé partout (inscription, connexion, invitations). */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/** Slug unique : ajoute un suffixe court si nécessaire. */
export function uniqueSlug(base: string, exists: (candidate: string) => boolean, maxAttempts = 25): string {
  const root = slugify(base) || "item";
  if (!exists(root)) return root;
  for (let i = 2; i <= maxAttempts; i += 1) {
    const candidate = `${root}-${i}`;
    if (!exists(candidate)) return candidate;
  }
  return `${root}-${randomSuffix(6)}`;
}

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

export function randomSuffix(length = 8): string {
  let out = "";
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  for (let i = 0; i < length; i += 1) {
    out += ALPHABET[bytes[i]! % ALPHABET.length];
  }
  return out;
}

/**
 * Identifiant de salle Jitsi : imprévisible, mais jamais utilisé comme
 * contrôle d'accès (voir decideLiveAccess).
 */
export function buildRoomName(prefix = "belloacademy"): string {
  return `${prefix}-${randomSuffix(12)}-${randomSuffix(12)}`;
}

export type Pagination = { page: number; pageSize: number; skip: number; take: number };

export function parsePagination(
  searchParams: URLSearchParams | Record<string, string | string[] | undefined>,
  defaults: { page?: number; pageSize?: number } = {},
): Pagination {
  const get = (key: string): string | undefined => {
    if (searchParams instanceof URLSearchParams) return searchParams.get(key) ?? undefined;
    const value = searchParams[key];
    return Array.isArray(value) ? value[0] : value;
  };
  const rawPage = Number.parseInt(get("page") ?? "", 10);
  const rawSize = Number.parseInt(get("pageSize") ?? "", 10);
  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : (defaults.page ?? 1);
  const pageSizeRaw = Number.isFinite(rawSize) && rawSize > 0 ? rawSize : (defaults.pageSize ?? DEFAULT_PAGE_SIZE);
  const pageSize = Math.min(pageSizeRaw, MAX_PAGE_SIZE);
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

export function paginationMeta(total: number, pagination: Pagination) {
  return {
    total,
    page: pagination.page,
    pageSize: pagination.pageSize,
    pageCount: Math.max(1, Math.ceil(total / pagination.pageSize)),
  };
}

const TND = new Intl.NumberFormat("fr-TN", {
  style: "currency",
  currency: "TND",
  minimumFractionDigits: 3,
  maximumFractionDigits: 3,
});

/** Les montants sont stockés en centimes de dinar (entiers). */
export function formatMoney(cents: number, currency = "TND"): string {
  const amount = cents / 100;
  if (currency === "TND") return TND.format(amount);
  try {
    return new Intl.NumberFormat("fr-TN", { style: "currency", currency }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

export function formatDate(date: Date | string, locale = "fr-TN"): string {
  const value = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(value);
}

export function formatDateTime(date: Date | string, locale = "fr-TN", timeZone?: string): string {
  const value = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    ...(timeZone ? { timeZone } : {}),
  }).format(value);
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0 min";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  if (hours === 0) return `${minutes} min`;
  if (minutes === 0) return `${hours} h`;
  return `${hours} h ${minutes} min`;
}

export function percent(part: number, total: number): number {
  if (!total || total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((part / total) * 100)));
}

/** Formatte une date dans un fuseau donné au format `YYYY-MM-DDTHH:mm`. */
export function toLocalInputValue(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
  return parts.replace(" ", "T");
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("fr-TN", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Empêche les redirections ouvertes : seuls les chemins internes sont acceptés. */
export function safeRedirectPath(candidate: string | null | undefined, fallback = "/dashboard"): string {
  if (!candidate) return fallback;
  if (!candidate.startsWith("/")) return fallback;
  if (candidate.startsWith("//")) return fallback;
  if (candidate.includes("\\")) return fallback;
  if (/[\u0000-\u001f]/.test(candidate)) return fallback;
  return candidate;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function initials(name: string | null | undefined, fallback = "?"): string {
  if (!name) return fallback;
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return fallback;
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0]!}${parts[parts.length - 1]![0]!}`.toUpperCase();
}

export function truncate(value: string, max = 160): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

export function uniqBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const k = key(item);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}

export function groupBy<T>(items: T[], key: (item: T) => string): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const item of items) {
    const k = key(item);
    (out[k] ??= []).push(item);
  }
  return out;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}
