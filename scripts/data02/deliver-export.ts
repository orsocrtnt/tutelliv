import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { prisma } from "../../src/services/prisma/client";
import {
  formatExportCode,
  getCompanyExportDelivery,
  prepareCompanyExportDelivery,
  revokeCompanyExportDelivery,
} from "../../src/domains/data-lifecycle/company-export-delivery.service";

/**
 * DATA-02, remise de l'export à une entreprise (outil opérateur, jamais appelé par une route).
 *   prepare <companyId> <dossier d'archive> <empreinte du manifeste>   vérifie l'archive, la met en .zip, rend lien + code
 *   status <companyId>                                                expiration, codes faux, ouvertures (sans secret)
 *   revoke <companyId>                                                ferme le lien et efface ses fichiers
 * Le code ne s'affiche qu'ici, une fois : l'envoyer par SMS ou le dire au téléphone, jamais dans le mail du lien.
 */
async function main() {
  const [command, companyId, archiveDir, manifestSha256, ...extra] = process.argv.slice(2);
  if (!companyId || !/^[A-Za-z0-9_-]+$/.test(companyId) || extra.length) throw new Error("INVALID_ARGUMENTS");
  if (command === "status" && !archiveDir) {
    console.log(JSON.stringify(await getCompanyExportDelivery(companyId), null, 2));
    return;
  }
  if (command === "revoke" && !archiveDir) {
    console.log(JSON.stringify({ revoked: await revokeCompanyExportDelivery(companyId) }));
    return;
  }
  if (command !== "prepare" || !archiveDir || !/^[a-f0-9]{64}$/.test(manifestSha256 ?? "")) throw new Error("INVALID_ARGUMENTS");
  const directory = resolve(archiveDir);
  // Même contrôle hors ligne que la procédure d'archive : rien n'est remis si un fichier manque ou a changé.
  const verified = spawnSync(process.execPath, [resolve("scripts/data02/verify-archive.mjs"), directory, manifestSha256!], { stdio: "inherit" });
  if (verified.status !== 0) throw new Error("ARCHIVE_VERIFICATION_FAILED");
  const result = await prepareCompanyExportDelivery(companyId, directory);
  if (!result.ok) {
    console.log(JSON.stringify(result));
    process.exitCode = 2;
    return;
  }
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "https://tutelliv.fr").replace(/\/$/, "");
  console.log(JSON.stringify({ expiresAt: result.expiresAt, parts: result.parts.map(({ name, bytes }) => ({ name, bytes })) }));
  console.log(`\nLien (à envoyer par e-mail) : ${base}/export/${result.token}`);
  console.log(`Code (par SMS ou au téléphone, jamais dans le même message) : ${formatExportCode(result.code)}\n`);
}
main()
  .catch((error) => { console.error(error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : "EXPORT_DELIVERY_FAILED"); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
