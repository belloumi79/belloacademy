/**
 * Internationalisation légère (aucune dépendance externe).
 *
 * Le français est la langue initiale ; l'anglais est fourni et l'arabe est
 * préparé (direction RTL gérée par la mise en page). L'ajout d'une langue
 * consiste à fournir un dictionnaire complet dans `dictionaries.ts`.
 */

import { fr } from "./dictionaries/fr";
import type { TranslationDictionary } from "./dictionaries/fr";
import { en } from "./dictionaries/en";
import { ar } from "./dictionaries/ar";

export const LOCALES = ["fr", "en", "ar"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "fr";
export const LOCALE_COOKIE_NAME = "belloacademy_locale";

export const LOCALE_LABELS: Record<Locale, string> = {
  fr: "Français",
  en: "English",
  ar: "العربية",
};

export const RTL_LOCALES: readonly Locale[] = ["ar"];

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

export function resolveLocale(value: string | null | undefined): Locale {
  if (!value) return DEFAULT_LOCALE;
  const primary = value.split(",")[0]?.split("-")[0]?.trim().toLowerCase();
  return isLocale(primary) ? primary : DEFAULT_LOCALE;
}

export function isRtl(locale: Locale): boolean {
  return RTL_LOCALES.includes(locale);
}

export function dir(locale: Locale): "rtl" | "ltr" {
  return isRtl(locale) ? "rtl" : "ltr";
}

type Dictionary = TranslationDictionary;

const DICTIONARIES: Record<Locale, Partial<Dictionary>> = { fr, en, ar };

export type TranslationKey = keyof Dictionary;

/**
 * Traduit une clé. Les variables `{nom}` sont interpolées.
 * Une clé absente retombe sur le français, puis sur la clé elle-même : l'interface
 * ne casse jamais à cause d'une traduction manquante.
 */
export function translate(
  locale: Locale,
  key: TranslationKey,
  variables?: Record<string, string | number>,
): string {
  const dictionary = DICTIONARIES[locale] ?? DICTIONARIES[DEFAULT_LOCALE];
  const template = dictionary[key] ?? DICTIONARIES[DEFAULT_LOCALE][key] ?? String(key);
  if (!variables) return template;
  return template.replace(/\{(\w+)\}/g, (_match, name: string) =>
    Object.prototype.hasOwnProperty.call(variables, name) ? String(variables[name]) : `{${name}}`,
  );
}

export type Translator = (key: TranslationKey, variables?: Record<string, string | number>) => string;

export function createTranslator(locale: Locale): Translator {
  return (key, variables) => translate(locale, key, variables);
}
