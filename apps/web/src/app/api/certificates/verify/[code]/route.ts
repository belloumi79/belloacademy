/**
 * Vérification publique d'un certificat : /api/certificates/verify/:code
 *
 * Route ouverte (aucune session requise) : c'est le point d'entrée utilisé par
 * la page publique de vérification. Elle ne divulgue que ce qui figure déjà sur
 * le certificat — intitulé de la formation, organisation émettrice, date,
 * numéro de série et validité. Aucune adresse e-mail, aucun identifiant interne.
 *
 * La limitation de débit est volontairement basse : le code de vérification est
 * aléatoire, mais rien ne justifie d'autoriser l'énumération.
 */

import { route, jsonOk } from "@/lib/http/api";
import { verifyCertificate } from "@/server/services/certificates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(
  async ({ params }) => {
    const result = await verifyCertificate(params.code ?? "");
    return jsonOk(result);
  },
  { csrf: false, rateLimit: "emailVerification" },
);
