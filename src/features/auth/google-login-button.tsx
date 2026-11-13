"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/services/supabase/client";
import {
  GOOGLE_CALLBACK_PATH,
  GOOGLE_CLIENT_ID,
  GOOGLE_ID_TOKEN_PATH,
  isGoogleLoginRefusal,
  type GoogleLoginRefusal,
} from "@/lib/auth/google-login";

const GSI_SCRIPT_URL = "https://accounts.google.com/gsi/client";
/** Au-delà, le script de Google est jugé bloqué (extension, réseau) : bouton de secours par redirection. */
const GSI_LOAD_TIMEOUT_MS = 6_000;

type GoogleCredentialResponse = { credential?: string };
type GoogleAccountsId = {
  initialize: (options: Record<string, unknown>) => void;
  renderButton: (parent: HTMLElement, options: Record<string, unknown>) => void;
};
declare global {
  interface Window {
    google?: { accounts?: { id?: GoogleAccountsId } };
  }
}

let gsiScript: Promise<GoogleAccountsId> | null = null;

function loadGoogleIdentity(): Promise<GoogleAccountsId> {
  if (window.google?.accounts?.id) return Promise.resolve(window.google.accounts.id);
  gsiScript ??= new Promise<GoogleAccountsId>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("GSI_TIMEOUT")), GSI_LOAD_TIMEOUT_MS);
    const script = document.createElement("script");
    script.src = GSI_SCRIPT_URL;
    script.async = true;
    script.onload = () => {
      window.clearTimeout(timer);
      const api = window.google?.accounts?.id;
      if (api) resolve(api);
      else reject(new Error("GSI_MISSING"));
    };
    script.onerror = () => {
      window.clearTimeout(timer);
      reject(new Error("GSI_FAILED"));
    };
    document.head.appendChild(script);
  }).catch((error) => {
    gsiScript = null;
    throw error;
  });
  return gsiScript;
}

/** Nonce brut (envoyé au serveur) et son empreinte SHA-256 (remise à Google, recopiée dans le jeton). */
async function createNonce(): Promise<{ raw: string; hashed: string }> {
  const bytes = window.crypto.getRandomValues(new Uint8Array(32));
  const raw = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  const digest = await window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  const hashed = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return { raw, hashed };
}

/** Logo Google officiel (quatre couleurs), pour le bouton de secours. */
function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" aria-hidden focusable="false">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

/** Secours : redirection vers Google via Supabase, retour sur `/auth/callback` (la fenêtre Google affiche alors le domaine Supabase). */
function GoogleRedirectButton({ onError }: { onError: (reason: GoogleLoginRefusal) => void }) {
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const release = (event: PageTransitionEvent) => {
      if (event.persisted) setPending(false);
    };
    window.addEventListener("pageshow", release);
    return () => window.removeEventListener("pageshow", release);
  }, []);

  const start = async () => {
    if (pending) return;
    setPending(true);
    try {
      const callback = new URL(GOOGLE_CALLBACK_PATH, window.location.origin);
      callback.searchParams.set("from", window.location.pathname);
      const { error } = await createClient().auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: callback.toString(), queryParams: { prompt: "select_account" } },
      });
      if (error) throw error;
    } catch {
      setPending(false);
      onError("error");
    }
  };

  return (
    <Button
      type="button"
      variant="outline"
      size="lg"
      className="h-[52px] w-full gap-3 rounded-full text-base font-semibold [&_svg]:size-5"
      loading={pending}
      onClick={() => { void start(); }}
    >
      {!pending && <GoogleMark />}
      Continuer avec Google
    </Button>
  );
}

/**
 * Connexion par Google (AUTH-GOOGLE) avec le bouton officiel de Google : la fenêtre Google affiche
 * « tutelliv.fr ». Le jeton reçu est vérifié par Supabase côté serveur (`/api/auth/google`), qui décide
 * de l'accès : invitation ouverte acceptée, compte Google sans profil TutelLiv refusé.
 */
export function GoogleLoginButton({ onError }: { onError: (reason: GoogleLoginRefusal) => void }) {
  const slot = useRef<HTMLDivElement>(null);
  const nonce = useRef<string | null>(null);
  const [mode, setMode] = useState<"loading" | "official" | "fallback">("loading");
  const [signingIn, setSigningIn] = useState(false);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  // Un nonce par essai : après un refus, le bouton est redessiné avec un nonce neuf.
  const render = useCallback(async () => {
    const api = await loadGoogleIdentity();
    const element = slot.current;
    if (!element) return;
    const { raw, hashed } = await createNonce();
    nonce.current = raw;
    api.initialize({
      client_id: GOOGLE_CLIENT_ID,
      nonce: hashed,
      ux_mode: "popup",
      use_fedcm_for_button: true,
      itp_support: true,
      callback: (response: GoogleCredentialResponse) => {
        void submit(response.credential);
      },
    });
    const dark = document.documentElement.classList.contains("dark");
    element.replaceChildren();
    api.renderButton(element, {
      type: "standard",
      theme: dark ? "filled_black" : "outline",
      size: "large",
      text: "continue_with",
      shape: "pill",
      logo_alignment: "center",
      locale: "fr",
      width: Math.min(400, Math.max(200, Math.floor(element.clientWidth || 400))),
    });
    setMode("official");
    // `submit` est stable (référence d'effet) : pas de dépendance circulaire.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = useCallback(async (credential: string | undefined) => {
    const rawNonce = nonce.current;
    if (!credential || !rawNonce) {
      onErrorRef.current("error");
      return;
    }
    setSigningIn(true);
    try {
      const response = await fetch(GOOGLE_ID_TOKEN_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credential, nonce: rawNonce }),
      });
      const json = (await response.json().catch(() => null)) as { redirectTo?: string; reason?: unknown } | null;
      if (response.ok && typeof json?.redirectTo === "string" && json.redirectTo.startsWith("/")) {
        // Navigation complète : l'espace relit la session fraîche côté serveur.
        window.location.assign(json.redirectTo);
        return;
      }
      setSigningIn(false);
      onErrorRef.current(isGoogleLoginRefusal(json?.reason) ? json.reason : response.status >= 500 ? "service" : "error");
    } catch {
      setSigningIn(false);
      onErrorRef.current("service");
    }
    void render().catch(() => setMode("fallback"));
  }, [render]);

  useEffect(() => {
    let cancelled = false;
    render().catch(() => {
      if (!cancelled) setMode("fallback");
    });
    return () => { cancelled = true; };
  }, [render]);

  if (mode === "fallback") return <GoogleRedirectButton onError={onError} />;

  return (
    <div className="relative flex min-h-[52px] w-full items-center justify-center">
      <div ref={slot} className="flex w-full max-w-[400px] justify-center" aria-busy={mode === "loading" || signingIn} />
      {(mode === "loading" || signingIn) && (
        <div className="absolute inset-0 flex items-center justify-center gap-2 rounded-full border bg-card text-sm font-semibold text-text-secondary">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          {signingIn ? "Connexion…" : "Continuer avec Google"}
        </div>
      )}
    </div>
  );
}
