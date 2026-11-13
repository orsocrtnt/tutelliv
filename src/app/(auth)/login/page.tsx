import { Suspense } from "react";
import { AuthForm } from "@/features/auth/auth-form";
import { resolveLoginView } from "@/features/auth/login-space";
import { googleRefusalFrom } from "@/lib/auth/google-login";
import { isGoogleLoginEnabled } from "@/services/supabase/auth-providers";

/**
 * Connexion directe : un seul formulaire pour tous les comptes. Le serveur relit le rôle en base et ouvre
 * le bon espace (super admin, entreprise, client, livreur). `?espace=` d'un ancien lien n'adapte que l'en-tête.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const view = resolveLoginView(params);
  const googleEnabled = await isGoogleLoginEnabled();
  return (
    <Suspense>
      <AuthForm
        key={view.context}
        mode="login"
        loginContext={view.context}
        prefillDemo={view.prefillDemo}
        googleEnabled={googleEnabled}
        googleRefusal={googleRefusalFrom(params)}
      />
    </Suspense>
  );
}
