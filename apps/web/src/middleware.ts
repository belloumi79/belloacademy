/**
 * Intergiciel HTTP : en-têtes de sécurité, politique de sécurité du contenu,
 * jeton CSRF et protection des routes privées.
 *
 * S'exécute sur le runtime Edge : uniquement des API Web (pas de `node:crypto`,
 * pas d'accès à la base). La vérification de session approfondie reste faite
 * côté serveur (les pages et l'API revérifient toujours les droits).
 */

import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE_NAME = "belloacademy_session";
const CSRF_COOKIE_NAME = "belloacademy_csrf";

/** Routes privées : une absence de cookie de session renvoie vers la connexion. */
const PRIVATE_PREFIXES = [
  "/tableau-de-bord",
  "/tableau-bord",
  "/onboarding",
  "/organisation",
];

function generateCsrfToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function jitsiOrigins(): string {
  const domain = (process.env.JITSI_DOMAIN ?? "meet.jit.si")
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");
  return `https://${domain}`;
}

function contentSecurityPolicy(): string {
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  const jitsi = jitsiOrigins();
  const isDev = process.env.NODE_ENV !== "production";
  const scriptSrc = isDev
    ? "'self' 'unsafe-inline' 'unsafe-eval'"
    : "'self' 'unsafe-inline'";
  const connectSrc = ["'self'", appUrl, jitsi, "https://*.jitsi.net"].join(" ");

  return [
    "default-src 'self'",
    `script-src ${scriptSrc} ${jitsi}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src ${connectSrc}`,
    `frame-src 'self' ${jitsi}`,
    "media-src 'self' blob: https:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

function applySecurityHeaders(response: NextResponse): void {
  response.headers.set("Content-Security-Policy", contentSecurityPolicy());
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("X-DNS-Prefetch-Control", "off");
  response.headers.set(
    "Permissions-Policy",
    "camera=(self), microphone=(self), display-capture=(self), geolocation=()",
  );
  if ((process.env.APP_URL ?? "").startsWith("https://")) {
    response.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
}

export function middleware(request: NextRequest): NextResponse {
  const { pathname, search } = request.nextUrl;

  // Les webhooks et les fichiers statiques ne reçoivent pas de cookie CSRF.
  const isWebhook = pathname.startsWith("/api/webhooks/");
  const isStatic = pathname.startsWith("/_next") || pathname === "/favicon.ico";

  if (!isStatic && PRIVATE_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    const hasSession = request.cookies.has(SESSION_COOKIE_NAME);
    if (!hasSession) {
      const url = request.nextUrl.clone();
      url.pathname = "/connexion";
      url.search = `?suivant=${encodeURIComponent(pathname + search)}`;
      const redirect = NextResponse.redirect(url);
      applySecurityHeaders(redirect);
      return redirect;
    }
  }

  const response = NextResponse.next();

  if (!isWebhook && !isStatic && !request.cookies.has(CSRF_COOKIE_NAME)) {
    response.cookies.set({
      name: CSRF_COOKIE_NAME,
      value: generateCsrfToken(),
      httpOnly: false,
      sameSite: "lax",
      secure: (process.env.APP_URL ?? "").startsWith("https://"),
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });
  }

  applySecurityHeaders(response);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
