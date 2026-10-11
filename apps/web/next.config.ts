import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { NextConfig } from "next";

// Racine du monorepo : nécessaire à la sortie `standalone` pour que les
// dépendances du workspace soient tracées et copiées dans l'image Docker.
const monorepoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

// Origine du serveur Jitsi autorisée à utiliser caméra, micro et partage
// d'écran depuis l'iframe de classe virtuelle. Sans cette autorisation
// explicite, `Permissions-Policy` bloque le périphérique dans l'iframe
// (origine croisée) et les cours en direct restent muets et sans image.
const jitsiOrigins = (process.env.JITSI_DOMAIN ?? "meet.jit.si")
  .split(",")
  .map((domain) => domain.trim())
  .filter(Boolean)
  .map((domain) => `https://${domain.replace(/^https?:\/\//, "")}`)
  .join(" ")
  .trim();

const mediaOrigins = `'self'${jitsiOrigins ? ` ${jitsiOrigins}` : ""}`;

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Sortie autonome : le bundle embarque son propre node_modules minimal,
  // ce qui produit une image Docker légère sans installation de dépendances.
  output: "standalone",
  outputFileTracingRoot: monorepoRoot,
  // Le paquet partagé est distribué en TypeScript (pas d'étape de build) :
  // Next le compile directement.
  transpilePackages: ["@belloacademy/shared"],
  serverExternalPackages: ["pg", "@prisma/adapter-pg", "ioredis", "nodemailer"],
  experimental: {
    serverActions: {
      bodySizeLimit: "4mb",
    },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-DNS-Prefetch-Control", value: "off" },
          {
            key: "Permissions-Policy",
            // La délégation vers l'origine Jitsi est indispensable : les
            // iframes de classe virtuelle sont servies depuis un autre domaine.
            value: `camera=(${mediaOrigins}), microphone=(${mediaOrigins}), display-capture=(${mediaOrigins}), geolocation=()`,
          },
        ],
      },
    ];
  },
};

export default nextConfig;
