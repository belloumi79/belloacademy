"use client";

/**
 * Salle Jitsi Meet embarquée (API IFrame officielle).
 *
 * Le script `external_api.js` est chargé depuis le domaine Jitsi configuré, et
 * la salle n'est rejointe qu'après autorisation côté serveur : c'est l'API qui
 * décide (`/api/live-sessions/:id/join`) et qui renvoie le nom de salle réel
 * ainsi qu'un éventuel jeton signé. Le navigateur ne connaît jamais le nom de
 * salle avant cette autorisation.
 *
 * Références : https://jitsi.github.io/handbook/docs/dev-guide/dev-guide-iframe/
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { Alert, Button, Spinner } from "@/components/ui";
import { apiFetch, ApiError } from "@/lib/client/api";

type JoinDescriptor = {
  domain: string;
  roomName: string;
  jwt: string | null;
  displayName: string;
  isModerator: boolean;
};

type JitsiApi = {
  dispose: () => void;
  executeCommand: (command: string, ...args: unknown[]) => void;
  addListener: (event: string, listener: (...args: unknown[]) => void) => void;
};

type JitsiApiConstructor = new (domain: string, options: Record<string, unknown>) => JitsiApi;

declare global {
  interface Window {
    JitsiMeetExternalAPI?: JitsiApiConstructor;
  }
}

const SCRIPT_ID = "jitsi-external-api";

function loadJitsiScript(domain: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.JitsiMeetExternalAPI) {
      resolve();
      return;
    }
    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    const script = existing ?? document.createElement("script");
    script.id = SCRIPT_ID;
    script.src = `https://${domain}/external_api.js`;
    script.async = true;
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener("error", () => reject(new Error("Script Jitsi inaccessible")), { once: true });
    if (!existing) document.head.appendChild(script);
  });
}

export function JitsiRoom({
  sessionId,
  organizationId,
  courseSlug,
  title,
}: {
  sessionId: string;
  organizationId: string;
  courseSlug: string | null;
  title: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const apiRef = useRef<JitsiApi | null>(null);
  const [descriptor, setDescriptor] = useState<JoinDescriptor | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [joined, setJoined] = useState(false);

  const leave = useCallback(async () => {
    setJoined(false);
    apiRef.current?.dispose();
    apiRef.current = null;
    try {
      await apiFetch(`/api/live-sessions/${sessionId}/leave`, { method: "POST", organizationId });
    } catch {
      // L'appel de sortie est informatif : son échec ne doit pas bloquer l'UI.
    }
  }, [organizationId, sessionId]);

  async function join() {
    setLoading(true);
    setError(null);
    try {
      const result = await apiFetch<{ descriptor: JoinDescriptor }>(`/api/live-sessions/${sessionId}/join`, {
        method: "POST",
        body: {},
        organizationId,
      });
      setDescriptor(result.descriptor);
      setJoined(true);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Impossible de rejoindre la session.");
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!joined || !descriptor) return;
    let cancelled = false;

    async function boot() {
      try {
        await loadJitsiScript(descriptor!.domain);
        if (cancelled || !containerRef.current) return;
        const Ctor = window.JitsiMeetExternalAPI;
        if (!Ctor) throw new Error("API Jitsi indisponible");

        const api = new Ctor(descriptor!.domain, {
          roomName: descriptor!.roomName,
          parentNode: containerRef.current,
          ...(descriptor!.jwt ? { jwt: descriptor!.jwt } : {}),
          userInfo: { displayName: descriptor!.displayName },
          configOverwrite: {
            prejoinPageEnabled: true,
            disableDeepLinking: true,
            startWithAudioMuted: !descriptor!.isModerator,
            startWithVideoMuted: true,
            enableWelcomePage: false,
          },
          interfaceConfigOverwrite: {
            SHOW_JITSI_WATERMARK: false,
            DEFAULT_BACKGROUND: "#0f172a",
          },
        });
        apiRef.current = api;
        api.addListener("videoConferenceLeft", () => {
          void leave();
        });
        api.addListener("readyToClose", () => {
          void leave();
        });
        setLoading(false);
      } catch {
        setError(
          "Le module Jitsi n'a pas pu être chargé. Vérifiez la configuration JITSI_DOMAIN et la connectivité réseau.",
        );
        setLoading(false);
      }
    }

    void boot();
    return () => {
      cancelled = true;
      apiRef.current?.dispose();
      apiRef.current = null;
    };
  }, [descriptor, joined, leave]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-ink-900">{title}</h2>
          <p className="text-xs text-ink-500">
            La réunion se déroule dans une salle dédiée ; l&apos;accès est réservé aux personnes autorisées.
          </p>
        </div>
        <div className="flex gap-2">
          {!joined ? (
            <Button onClick={join} disabled={loading}>
              {loading ? "Connexion…" : "Rejoindre la classe virtuelle"}
            </Button>
          ) : (
            <Button variant="secondary" onClick={() => void leave()}>
              Quitter la réunion
            </Button>
          )}
          {courseSlug ? (
            <a
              href={`/tableau-de-bord/formations/${courseSlug}`}
              className="inline-flex items-center rounded-lg px-3 py-2 text-sm font-medium text-ink-700 hover:text-brand-700"
            >
              Retour à la formation
            </a>
          ) : null}
        </div>
      </div>

      {error ? (
        <Alert tone="danger" title="Accès à la session">
          {error}
        </Alert>
      ) : null}

      <div
        ref={containerRef}
        className="min-h-[28rem] overflow-hidden rounded-xl border border-ink-200 bg-ink-900"
      >
        {loading ? (
          <div className="flex min-h-[28rem] items-center justify-center gap-3 text-sm text-ink-300">
            <Spinner /> Préparation de la salle…
          </div>
        ) : null}
      </div>
    </div>
  );
}
