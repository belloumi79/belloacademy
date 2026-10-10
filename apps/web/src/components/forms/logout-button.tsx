"use client";

/**
 * Bouton de déconnexion.
 *
 * La mutation est protégée par CSRF : le jeton est lu depuis le cookie
 * `belloacademy_csrf` puis transmis dans l'en-tête `x-csrf-token`.
 */

import { useRouter } from "next/navigation";
import { useState } from "react";

import { apiFetch } from "@/lib/client/api";
import { buttonClass } from "@/components/ui";

export function LogoutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function logout() {
    setPending(true);
    try {
      await apiFetch("/api/auth/logout", { method: "POST" });
      router.push("/");
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <button type="button" className={buttonClass("ghost", "sm")} onClick={logout} disabled={pending}>
      {pending ? "Déconnexion…" : "Déconnexion"}
    </button>
  );
}
