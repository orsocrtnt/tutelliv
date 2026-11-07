/**
 * Numéro de téléphone lisible à l'écran : « 06 12 34 56 78 » ou « +33 6 12 34 56 78 ».
 * Le numéro stocké ne change pas ; un format non reconnu (étranger, incomplet) est affiché tel quel.
 */
export function formatPhoneDisplay(value: string | null | undefined): string {
  const raw = value?.trim() ?? "";
  const digits = raw.replace(/[^\d+]/g, "");
  const national = /^0[1-9]\d{8}$/.test(digits) ? digits : null;
  if (national) return national.replace(/(\d{2})(?=\d)/g, "$1 ");
  const international = digits.match(/^(?:\+33|0033)([1-9]\d{8})$/);
  if (international) return `+33 ${international[1]!.replace(/^(\d)(\d{2})(\d{2})(\d{2})(\d{2})$/, "$1 $2 $3 $4 $5")}`;
  return raw;
}

/** Cible d'un lien `tel:` : chiffres et « + » seulement. */
export function phoneHref(value: string): string {
  return `tel:${value.replace(/[^\d+]/g, "")}`;
}
