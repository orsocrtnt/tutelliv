/**
 * Affichage de la TVA des abonnements TutelLiv, piloté par le taux du catalogue (`vatRateBps`).
 * Taux 0 = franchise en base de TVA (micro-entreprise, décision du propriétaire du 13 novembre 2026) :
 * le prix affiché est le prix payé, sans « HT » ni « TTC ». Taux inconnu : on garde « HT » (prudent).
 */
export const VAT_FRANCHISE_MENTION = "TVA non applicable, art. 293 B du CGI";

export function isVatFranchise(vatRateBps: number | null | undefined): boolean {
  return vatRateBps === 0;
}

/** Suffixe d'un prix unitaire : « HT » quand la TVA s'ajoute, rien en franchise. */
export function priceTaxSuffix(vatRateBps: number | null | undefined): string {
  return isVatFranchise(vatRateBps) ? "" : " HT";
}

/** Suffixe d'un total à payer : « TTC » quand la TVA s'ajoute, rien en franchise. */
export function totalTaxSuffix(vatRateBps: number | null | undefined): string {
  return isVatFranchise(vatRateBps) ? "" : " TTC";
}
