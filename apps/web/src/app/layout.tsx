import type { Metadata, Viewport } from "next";

import "./globals.css";

import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { getTranslator } from "@/lib/i18n/server";

export const metadata: Metadata = {
  title: {
    default: "BelloAcademy — plateforme de formation en ligne",
    template: "%s · BelloAcademy",
  },
  description:
    "BelloAcademy : créez et vendez vos formations, animez vos classes virtuelles avec Jitsi Meet, évaluez vos apprenants et délivrez des certificats vérifiables.",
  applicationName: "BelloAcademy",
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#4338ca",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { locale, t, dir } = await getTranslator();
  // Le contexte est lu sans lever d'erreur : l'en-tête s'adapte aux visiteurs
  // anonymes comme aux comptes connectés.

  return (
    <html lang={locale} dir={dir}>
      <body className="flex min-h-screen flex-col">
        <a
          href="#contenu"
          className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-brand-600 focus:px-4 focus:py-2 focus:text-white"
        >
          {t("a11y.skipToContent")}
        </a>
        <SiteHeader />
        <main id="contenu" className="flex-1">
          {children}
        </main>
        <SiteFooter />
      </body>
    </html>
  );
}
