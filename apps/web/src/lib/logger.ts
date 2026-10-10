/**
 * Journalisation structurée (JSON sur une ligne) avec rédaction des données sensibles.
 *
 * Aucun mot de passe, jeton, en-tête d'autorisation ou cookie ne doit apparaître
 * dans les journaux : les clés sensibles sont remplacées avant sérialisation.
 */

import { env } from "@/env";

type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const REDACTED_KEYS = new Set([
  "password",
  "passwordHash",
  "currentPassword",
  "newPassword",
  "token",
  "tokenHash",
  "accessToken",
  "refreshToken",
  "authorization",
  "cookie",
  "set-cookie",
  "secret",
  "apiKey",
  "clientSecret",
  "webhookSecret",
  "jwt",
  "csrf",
  "verificationCode",
  "code",
]);

const REDACTED = "[rédigé]";

function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[profondeur maximale]";
  if (value === null || value === undefined) return value;
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      output[key] = REDACTED_KEYS.has(key) ? REDACTED : redact(item, depth + 1);
    }
    return output;
  }
  if (typeof value === "string" && value.length > 2000) return `${value.slice(0, 2000)}…`;
  return value;
}

export type LogContext = Record<string, unknown>;

function shouldLog(level: LogLevel): boolean {
  let configured: LogLevel = "info";
  try {
    configured = env().LOG_LEVEL;
  } catch {
    configured = "info";
  }
  return LEVEL_ORDER[level] >= LEVEL_ORDER[configured];
}

function write(level: LogLevel, message: string, context?: LogContext) {
  if (!shouldLog(level)) return;
  const payload = {
    level,
    time: new Date().toISOString(),
    message,
    ...(context ? (redact(context) as LogContext) : {}),
  };
  const line = JSON.stringify(payload);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (message: string, context?: LogContext) => write("debug", message, context),
  info: (message: string, context?: LogContext) => write("info", message, context),
  warn: (message: string, context?: LogContext) => write("warn", message, context),
  error: (message: string, context?: LogContext) => write("error", message, context),
  /** Journal lié à une requête HTTP. */
  request: (message: string, context?: LogContext) => write("info", message, context),
};

export { redact };
