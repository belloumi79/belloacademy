/**
 * Routes d'authentification : /api/auth/[...path]
 *
 * Toutes les mutations sont protégées par CSRF (couche `route()`), et les
 * parcours sensibles (connexion, inscription, réinitialisation) portent une
 * limitation de débit dédiée, appliquée ici en plus de la limite générique.
 */
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  verifyEmailSchema,
} from "@belloacademy/shared";
import { getAuthContext, requireAuth } from "@/lib/auth/authorization";
import { clearSessionCookie, createSession } from "@/lib/auth/session";
import { clearCsrfToken, issueCsrfToken } from "@/lib/csrf";
import { clientIp, jsonOk, parseBody } from "@/lib/http/api";
import { createDispatcher, unsupportedMethod } from "@/lib/http/dispatch";
import { enforceRateLimit } from "@/lib/rate-limit";
import {
  changePassword,
  getUserProfile,
  login,
  logout,
  register,
  requestPasswordReset,
  resendVerification,
  resetPassword,
  verifyEmail,
} from "@/server/services/accounts";
const dispatch = createDispatcher([
  {
    method: "GET",
    pattern: "session",
    handler: async () => {
      const context = await getAuthContext();
      if (!context) return jsonOk({ authenticated: false, user: null, memberships: [] });
      return jsonOk({
        authenticated: true,
        user: context.user,
        memberships: context.memberships,
      });
    },
  },
  {
    method: "POST",
    pattern: "register",
    handler: async ({ request }) => {
      await enforceRateLimit("register", clientIp(request));
      const input = await parseBody(request, registerSchema);
      const user = await register(input);
      await createSession(user.id);
      await issueCsrfToken();
      return jsonOk({ user }, { status: 201 });
    },
  },
  {
    method: "POST",
    pattern: "login",
    handler: async ({ request }) => {
      await enforceRateLimit("login", clientIp(request));
      const input = await parseBody(request, loginSchema);
      const result = await login(input);
      return jsonOk({ user: result.user });
    },
  },
  {
    method: "POST",
    pattern: "logout",
    handler: async () => {
      const context = await requireAuth();
      await logout(context.sessionId, context.user.id);
      await clearSessionCookie();
      await clearCsrfToken();
      return jsonOk({ ok: true });
    },
  },
  {
    method: "POST",
    pattern: "verify-email",
    handler: async ({ request }) => {
      await enforceRateLimit("emailVerification", clientIp(request));
      const { token } = await parseBody(request, verifyEmailSchema);
      const user = await verifyEmail(token);
      return jsonOk({ user });
    },
  },
  {
    method: "POST",
    pattern: "resend-verification",
    handler: async () => {
      const context = await requireAuth();
      await enforceRateLimit("emailVerification", context.user.id);
      await resendVerification(context.user.id);
      return jsonOk({ ok: true });
    },
  },
  {
    method: "POST",
    pattern: "forgot-password",
    handler: async ({ request }) => {
      await enforceRateLimit("passwordReset", clientIp(request));
      const { email } = await parseBody(request, forgotPasswordSchema);
      await requestPasswordReset(email);
      // Réponse identique que l'adresse existe ou non (pas d'énumération de comptes).
      return jsonOk({ ok: true });
    },
  },
  {
    method: "POST",
    pattern: "reset-password",
    handler: async ({ request }) => {
      await enforceRateLimit("passwordReset", clientIp(request));
      const input = await parseBody(request, resetPasswordSchema);
      await resetPassword(input);
      return jsonOk({ ok: true });
    },
  },
  {
    method: "POST",
    pattern: "change-password",
    handler: async ({ request }) => {
      const context = await requireAuth();
      const input = await parseBody(request, changePasswordSchema);
      await changePassword({
        userId: context.user.id,
        currentPassword: input.currentPassword,
        newPassword: input.newPassword,
        currentSessionId: context.sessionId,
      });
      return jsonOk({ ok: true });
    },
  },
  {
    method: "GET",
    pattern: "profile",
    handler: async () => {
      const context = await requireAuth();
      return jsonOk({ user: await getUserProfile(context.user.id) });
    },
  },
]);
export const GET = dispatch.GET;
export const POST = dispatch.POST;
/** Réponse explicite pour les méthodes non exposées sur cette ressource. */
export const PATCH = unsupportedMethod("Méthode non supportée sur /api/auth.");
