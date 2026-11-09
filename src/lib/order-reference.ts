import type { DeliveryCategory } from "@prisma/client";
import { prisma } from "@/services/prisma/client";

const ORDER_PREFIX: Record<DeliveryCategory, string> = {
  STANDARD: "CMD",
  COURIER: "CRS",
  SPECIAL_MISSION: "MIS",
};

function randomEightDigits(): string {
  return String(Math.floor(10_000_000 + Math.random() * 90_000_000));
}

async function generateUniqueReference(
  prefix: string,
  exists: (reference: string) => Promise<boolean>
): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const reference = `${prefix}-${randomEightDigits()}`;
    if (!(await exists(reference))) return reference;
  }
  throw new Error("REFERENCE_GENERATION_FAILED");
}

/**
 * Un numéro de commande ne doit exister ni comme commande ni comme livraison : depuis
 * AUDIT-0411, la livraison porte le numéro de sa commande.
 */
async function isReferenceTaken(reference: string): Promise<boolean> {
  const [order, delivery] = await Promise.all([
    prisma.order.findUnique({ where: { reference }, select: { id: true } }),
    prisma.delivery.findUnique({ where: { reference }, select: { id: true } }),
  ]);
  return !!order || !!delivery;
}

export async function generateOrderReference(
  category: DeliveryCategory = "STANDARD"
): Promise<string> {
  return generateUniqueReference(ORDER_PREFIX[category], isReferenceTaken);
}

/**
 * Une commande donne une seule livraison, qui porte le même numéro (« CMD-… », « CRS-… »,
 * « MIS-… ») : l'équipe et le client voient un seul numéro partout. Décision du propriétaire
 * du 9 novembre 2026 (AUDIT-0411). Les livraisons créées avant gardent leur « LIV-… ».
 */
export function deliveryReferenceForOrder(orderReference: string): string {
  return orderReference;
}

/** Plusieurs références uniques en une lecture par tour (créations en lot de la démo). */
async function generateUniqueReferences(
  prefix: string,
  count: number,
  taken: (references: string[]) => Promise<string[]>
): Promise<string[]> {
  const result = new Set<string>();
  for (let attempt = 0; attempt < 20 && result.size < count; attempt++) {
    const candidates = new Set<string>();
    while (candidates.size < count - result.size) {
      const reference = `${prefix}-${randomEightDigits()}`;
      if (!result.has(reference)) candidates.add(reference);
    }
    const used = new Set(await taken([...candidates]));
    for (const reference of candidates) if (!used.has(reference)) result.add(reference);
  }
  if (result.size < count) throw new Error("REFERENCE_GENERATION_FAILED");
  return [...result];
}

export async function generateOrderReferences(category: DeliveryCategory, count: number): Promise<string[]> {
  return generateUniqueReferences(ORDER_PREFIX[category], count, async (references) => {
    const [orders, deliveries] = await Promise.all([
      prisma.order.findMany({ where: { reference: { in: references } }, select: { reference: true } }),
      prisma.delivery.findMany({ where: { reference: { in: references } }, select: { reference: true } }),
    ]);
    return [...orders, ...deliveries].map((row) => row.reference);
  });
}
