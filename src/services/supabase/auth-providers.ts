import "server-only";

/**
 * Le bouton Google n'apparaît que si le fournisseur est activé dans Supabase : avant le branchement
 * (ou s'il est coupé), aucun bouton ne mène à une erreur. Réglage public de Supabase Auth, relu au plus
 * toutes les cinq minutes ; en cas de panne, pas de bouton (la connexion par mot de passe reste).
 */
export async function isGoogleLoginEnabled(): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return false;
  try {
    const response = await fetch(`${url}/auth/v1/settings`, {
      headers: { apikey: key },
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(2_000),
    });
    if (!response.ok) return false;
    const settings = (await response.json()) as { external?: { google?: unknown } };
    return settings.external?.google === true;
  } catch {
    return false;
  }
}
