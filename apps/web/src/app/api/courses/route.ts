/**
 * Catalogue des formations à la racine de la ressource : /api/courses
 *
 * Le répartiteur vit dans `./[...path]/route.ts`, où le motif `""` correspond
 * exactement au chemin vide. Ce fichier ne fait que réexposer les mêmes
 * gestionnaires : sans lui, Next.js ne route pas `/api/courses` (sans segment)
 * et le catalogue public renverrait 404.
 */

export { GET, POST, PATCH, DELETE } from "./[...path]/route";

export const dynamic = "force-dynamic";
