import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { prisma } from "../../src/services/prisma/client";
import {
  COMPANY_ERASURE_AUTHORIZATION,
  eraseCompany,
  scheduleCompanyErasure,
} from "../../src/domains/data-lifecycle/company-erasure.service";

/**
 * DATA-02, outil opérateur (jamais appelé par une route ni par le cron).
 *   schedule <companyId> --export-confirmed-at <date ISO>   date l'export confirmé, effacement possible 30 jours après
 *   erase <companyId>                                       simulation : dit ce qui serait effacé, ne touche à rien
 *   erase <companyId> --apply                               efface ; exige COMPANY_ERASURE_ENABLED=pilot-company-erasure-v1
 * Le manifeste (sans donnée personnelle) est écrit dans outputs/data02/erasure-<companyId>.json.
 */
async function main() {
  const [command, companyId, ...rest] = process.argv.slice(2);
  if (!companyId || !/^[A-Za-z0-9_-]+$/.test(companyId)) throw new Error("INVALID_ARGUMENTS");
  if (command === "schedule") {
    if (rest.length !== 2 || rest[0] !== "--export-confirmed-at") throw new Error("INVALID_ARGUMENTS");
    const result = await scheduleCompanyErasure(companyId, { exportConfirmedAt: new Date(rest[1] ?? "") });
    console.log(JSON.stringify(result));
    if (!result.ok) process.exitCode = 2;
    return;
  }
  if (command !== "erase" || rest.some((arg) => arg !== "--apply") || rest.length > 1) throw new Error("INVALID_ARGUMENTS");
  const apply = rest.includes("--apply");
  if (apply && process.env.COMPANY_ERASURE_ENABLED !== COMPANY_ERASURE_AUTHORIZATION) throw new Error("EXPLICIT_ACTIVATION_REQUIRED");
  const result = await eraseCompany(companyId, { apply, authorization: process.env.COMPANY_ERASURE_ENABLED });
  if (result.status === "erased") {
    const path = resolve(`outputs/data02/erasure-${companyId}.json`);
    await mkdir(resolve("outputs/data02"), { recursive: true });
    await writeFile(path, `${JSON.stringify(result.manifest, null, 2)}\n`, "utf8");
  }
  console.log(JSON.stringify(result.status === "erased" ? { status: "erased", deleted: result.manifest.deleted, keptInvoices: result.manifest.kept.invoices } : result));
  if (result.status === "blocked" || result.status === "missing") process.exitCode = 2;
}
main()
  .catch((error) => { console.error(error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : "COMPANY_ERASURE_FAILED"); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
