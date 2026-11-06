import sharp from "sharp";
import { prisma } from "@/services/prisma/client";
import { purgeDemoPoolStorage } from "@/domains/data-lifecycle/demo-cleanup.service";
import { uploadPodPhoto } from "@/lib/storage/pod";
import { uploadPodSignature } from "@/lib/storage/pod-signature";

/**
 * DEMO-REFONTE : photo et signature des preuves de la journée de démonstration.
 *
 * Les images sont dessinées ici (SVG rendu par sharp, sans police ni fichier à embarquer) puis
 * déposées par les mêmes fonctions que l'application livreur : chemins, contrôles et nettoyage
 * des métadonnées identiques à une vraie preuve. Réservé aux espaces du stock de démonstration,
 * dont le dossier de preuves est vidé à chaque recyclage ; l'espace de base et les anciennes
 * sessions n'en reçoivent pas (leur ménage refuse un espace qui contient des fichiers).
 */

const DOOR_COLORS = ["#2f4f46", "#5a3b2e", "#1f3a5f", "#4a4a4a"] as const;
const WALL_COLORS = ["#e8e2d6", "#ddd8cf", "#e6dfd2", "#d9d4ca"] as const;

/** Colis posé devant une porte, avec étiquette d'expédition. Variante par numéro. */
export function demoProofPhotoSvg(variant: number): string {
  const door = DOOR_COLORS[variant % DOOR_COLORS.length];
  const wall = WALL_COLORS[variant % WALL_COLORS.length];
  const boxWidth = 300 + (variant % 3) * 40;
  const boxHeight = 210 + (variant % 2) * 40;
  const boxX = 600 - boxWidth / 2 + (variant % 2 === 0 ? -60 : 70);
  const boxY = 760 - boxHeight;
  const barcode = Array.from({ length: 22 }, (_, index) => {
    const width = (index * 7 + variant) % 3 === 0 ? 4 : 2;
    return `<rect x="${boxX + 40 + index * 6}" y="${boxY + 92}" width="${width}" height="34" fill="#222"/>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900" viewBox="0 0 1200 900">
  <defs>
    <linearGradient id="wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${wall}"/><stop offset="1" stop-color="#c9c2b5"/></linearGradient>
    <linearGradient id="floor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9c9184"/><stop offset="1" stop-color="#7d7368"/></linearGradient>
    <linearGradient id="box" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d1a56c"/><stop offset="1" stop-color="#b98a51"/></linearGradient>
    <radialGradient id="light" cx="0.5" cy="0.2" r="0.8"><stop offset="0" stop-color="#ffffff" stop-opacity="0.25"/><stop offset="1" stop-color="#000000" stop-opacity="0.18"/></radialGradient>
  </defs>
  <rect width="1200" height="640" fill="url(#wall)"/>
  <rect x="0" y="630" width="1200" height="270" fill="url(#floor)"/>
  ${Array.from({ length: 7 }, (_, index) => `<line x1="${index * 200}" y1="640" x2="${index * 200 - 120}" y2="900" stroke="#6f665c" stroke-width="2"/>`).join("")}
  <line x1="0" y1="760" x2="1200" y2="760" stroke="#6f665c" stroke-width="2"/>
  <rect x="380" y="70" width="440" height="570" fill="#efe9de"/>
  <rect x="405" y="95" width="390" height="545" fill="${door}"/>
  <rect x="440" y="130" width="320" height="200" rx="6" fill="none" stroke="#000" stroke-opacity="0.18" stroke-width="6"/>
  <rect x="440" y="370" width="320" height="230" rx="6" fill="none" stroke="#000" stroke-opacity="0.18" stroke-width="6"/>
  <rect x="738" y="350" width="14" height="70" rx="7" fill="#c8b98f"/>
  <circle cx="745" cy="455" r="9" fill="#a8996f"/>
  <rect x="890" y="200" width="70" height="44" rx="4" fill="#cfc6b6" stroke="#8d8577" stroke-width="3"/>
  <rect x="905" y="214" width="40" height="6" rx="3" fill="#5d564b"/>
  <rect x="430" y="640" width="340" height="60" rx="8" fill="#5b4a3a"/>
  <rect x="${boxX + 18}" y="${boxY + boxHeight - 12}" width="${boxWidth}" height="26" rx="12" fill="#000" fill-opacity="0.25"/>
  <rect x="${boxX}" y="${boxY}" width="${boxWidth}" height="${boxHeight}" rx="6" fill="url(#box)"/>
  <polygon points="${boxX},${boxY} ${boxX + boxWidth},${boxY} ${boxX + boxWidth - 30},${boxY - 36} ${boxX + 30},${boxY - 36}" fill="#dcb47c"/>
  <rect x="${boxX + boxWidth / 2 - 22}" y="${boxY - 36}" width="44" height="${boxHeight + 36}" fill="#c9a26a" fill-opacity="0.9"/>
  <rect x="${boxX + 28}" y="${boxY + 30}" width="170" height="110" rx="4" fill="#fbfaf7"/>
  <rect x="${boxX + 40}" y="${boxY + 44}" width="110" height="9" fill="#555"/>
  <rect x="${boxX + 40}" y="${boxY + 62}" width="140" height="7" fill="#888"/>
  <rect x="${boxX + 40}" y="${boxY + 76}" width="90" height="7" fill="#888"/>
  ${barcode}
  <rect width="1200" height="900" fill="url(#light)"/>
</svg>`;
}

/** Tracés de signature manuscrite (sans police : le serveur n'en garantit aucune). Initiales des réceptionnaires du jour, dans l'ordre du scénario : M(arie Dubois), C(abinet), L(éa Martin), H(ugo Lambert). */
const SIGNATURE_PATHS = [
  "M50 160 C60 110 70 60 85 50 C95 45 92 90 100 130 C108 90 120 45 132 52 C142 60 135 120 140 150 C150 120 165 110 175 125 C182 138 170 150 168 140 C166 125 190 110 200 128 C206 140 214 140 222 120 C232 90 240 40 252 45 C262 52 250 110 245 140 C260 120 272 112 280 128 C286 142 300 140 310 118 C318 100 330 95 336 112 C342 128 334 145 326 135 C318 120 345 105 360 125 C372 140 395 128 420 110 M60 178 C180 170 320 176 440 160",
  "M120 80 C90 60 50 80 55 120 C60 160 110 168 135 140 C145 128 150 140 158 150 C168 160 178 120 190 124 C202 128 192 152 205 152 C220 152 224 120 238 122 C250 124 244 150 258 150 C272 150 276 118 292 120 C304 122 298 150 312 150 C328 150 336 70 350 55 C362 45 362 90 352 130 C346 152 360 160 380 140 C400 120 420 150 450 140 C470 132 470 175 430 172 C380 168 250 175 150 182",
  "M80 60 C70 110 60 150 70 165 C80 178 110 160 120 150 C130 140 135 150 128 160 C122 168 140 172 155 150 C165 135 170 120 180 128 C190 136 178 158 190 156 C205 154 210 120 222 70 C228 45 240 50 232 85 C225 115 222 145 232 152 C245 160 255 130 265 128 C278 126 270 155 285 152 C300 149 305 120 318 122 C330 124 322 150 336 148 C352 146 365 120 400 112 C430 106 460 112 490 104",
  "M70 70 C65 110 60 140 62 165 M70 118 C100 112 120 112 140 116 M140 60 C135 100 130 140 132 168 C140 140 160 125 172 132 C182 140 168 158 178 160 C192 162 200 130 214 128 C228 126 222 150 234 152 C248 154 256 118 270 60 C276 40 286 50 280 80 C272 120 268 150 280 156 C295 162 305 130 320 132 C340 134 330 160 350 150 C380 136 420 140 470 128",
] as const;

export function demoProofSignatureSvg(variant: number): string {
  const path = SIGNATURE_PATHS[variant % SIGNATURE_PATHS.length];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="200" viewBox="0 0 600 200">
  <path d="${path}" fill="none" stroke="#1d2433" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
}

export async function renderDemoProofFiles(variant: number): Promise<{ photo: Buffer; signature: Buffer }> {
  const [photo, signature] = await Promise.all([
    sharp(Buffer.from(demoProofPhotoSvg(variant))).jpeg({ quality: 82, mozjpeg: true }).toBuffer(),
    sharp(Buffer.from(demoProofSignatureSvg(variant))).png().toBuffer(),
  ]);
  return { photo, signature };
}

export type DemoProofFilesResult =
  | { status: "attached"; count: number }
  | { status: "skipped"; reason: "NOT_A_POOL_ENVIRONMENT" | "NO_PROOF" }
  | { status: "failed"; reason: string };

type Dependencies = {
  isPoolCompany: (companyId: string) => Promise<boolean>;
  purge: (companyId: string) => Promise<unknown>;
  render: (variant: number) => Promise<{ photo: Buffer; signature: Buffer }>;
  uploadPhoto: (params: { companyId: string; deliveryId: string; bytes: Buffer; contentType: string }) => Promise<string>;
  uploadSignature: (params: { companyId: string; deliveryId: string; bytes: Buffer; contentType: string }) => Promise<string>;
  attach: (params: { companyId: string; deliveryId: string; photoPath: string; signaturePath: string }) => Promise<void>;
};

const defaultDependencies: Dependencies = {
  isPoolCompany: async (companyId) =>
    Boolean(await prisma.demoPoolEnvironment.findUnique({ where: { companyId }, select: { id: true } })),
  purge: (companyId) => purgeDemoPoolStorage(companyId),
  render: renderDemoProofFiles,
  uploadPhoto: uploadPodPhoto,
  uploadSignature: uploadPodSignature,
  attach: async ({ companyId, deliveryId, photoPath, signaturePath }) => {
    await prisma.delivery.updateMany({
      where: { id: deliveryId, companyId, podOutcome: "SUCCESS" },
      data: { podPhotoPath: photoPath, podSignaturePath: signaturePath },
    });
  },
};

/**
 * Vide le dossier de preuves de l'espace (photos laissées par le visiteur précédent, dont les
 * livraisons viennent d'être supprimées), puis joint une photo et une signature à chaque
 * livraison livrée de la journée. Ne lève jamais : sans fichiers, la démo garde des preuves
 * avec nom, heure et position, comme avant.
 */
export async function attachDemoProofFiles(
  companyId: string,
  deliveryIds: string[],
  dependencies: Partial<Dependencies> = {}
): Promise<DemoProofFilesResult> {
  const deps = { ...defaultDependencies, ...dependencies };
  try {
    if (!(await deps.isPoolCompany(companyId))) return { status: "skipped", reason: "NOT_A_POOL_ENVIRONMENT" };
    await deps.purge(companyId);
    if (deliveryIds.length === 0) return { status: "skipped", reason: "NO_PROOF" };
    await Promise.all(deliveryIds.map(async (deliveryId, variant) => {
      const files = await deps.render(variant);
      const [photoPath, signaturePath] = await Promise.all([
        deps.uploadPhoto({ companyId, deliveryId, bytes: files.photo, contentType: "image/jpeg" }),
        deps.uploadSignature({ companyId, deliveryId, bytes: files.signature, contentType: "image/png" }),
      ]);
      await deps.attach({ companyId, deliveryId, photoPath, signaturePath });
    }));
    return { status: "attached", count: deliveryIds.length };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "UNKNOWN";
    console.warn("[demo] preuves sans photo ni signature", { companyId, reason });
    return { status: "failed", reason };
  }
}
