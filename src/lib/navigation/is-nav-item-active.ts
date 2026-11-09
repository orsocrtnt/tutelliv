/**
 * Pages sans entrée de menu propre, rattachées à l'entrée qui y mène (AUDIT-0411, mauvais menu surligné) :
 * la fiche d'une livraison relève du dispatch, l'ancienne carte des livreurs de la carte unique.
 * L'alias ne s'applique que si l'entrée cible existe dans le menu affiché.
 */
const NAV_ALIASES: { prefix: string; target: string }[] = [
  { prefix: "/dashboard/deliveries", target: "/dispatch" },
  { prefix: "/dispatch/drivers", target: "/dispatch/map" },
];

function aliasedPath(pathname: string, allHrefs: string[]): string {
  for (const { prefix, target } of NAV_ALIASES) {
    const matches = pathname === prefix || pathname.startsWith(`${prefix}/`);
    if (matches && !allHrefs.includes(prefix) && allHrefs.includes(target)) return target;
  }
  return pathname;
}

/** Active si la route correspond exactement, ou si c'est un enfant sans match plus spécifique dans le menu. */
export function isNavItemActive(
  rawPathname: string,
  href: string,
  allHrefs: string[]
): boolean {
  const pathname = aliasedPath(rawPathname, allHrefs);
  if (pathname === href) return true;
  if (!pathname.startsWith(`${href}/`)) return false;

  const hasMoreSpecificMatch = allHrefs.some(
    (other) =>
      other !== href &&
      other.startsWith(`${href}/`) &&
      (pathname === other || pathname.startsWith(`${other}/`))
  );

  return !hasMoreSpecificMatch;
}
