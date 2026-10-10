/**
 * Accès à la langue et au traducteur côté serveur.
 *
 * La langue est résolue depuis le cookie `belloacademy_locale`, puis depuis
 * l'en-tête `Accept-Language`. Le français reste la langue par défaut.
 */

import { cookies, headers } from "next/headers";

import { env } from "@/env";
import {
  createTranslator,
  dir,
  resolveLocale,
  translate,
  type Locale,
  type TranslationKey,
  type Translator,
} from "@/lib/i18n";

export const LOCALE_COOKIE = "belloacademy_locale";

export async function getLocale(): Promise<Locale> {
  const cookieStore = await cookies();
  const fromCookie = cookieStore.get(LOCALE_COOKIE)?.value;
  if (fromCookie) return resolveLocale(fromCookie);

  const headerList = await headers();
  return resolveLocale(headerList.get("accept-language")) ?? resolveLocale(env().DEFAULT_LOCALE);
}

export type ServerI18n = {
  locale: Locale;
  t: Translator;
  dir: "ltr" | "rtl";
  /** Traduit une clé pour une autre langue (listes déroulantes, etc.). */
  translateIn: (locale: Locale, key: TranslationKey) => string;
};

export async function getTranslator(): Promise<ServerI18n> {
  const locale = await getLocale();
  return {
    locale,
    t: createTranslator(locale),
    dir: dir(locale),
    translateIn: (target, key) => translate(target, key),
  };
}
