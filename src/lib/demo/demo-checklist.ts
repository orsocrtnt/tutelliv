import type { DemoPersona } from "@/lib/demo/constants";

/**
 * Liste « À essayer » de la barre de démo (DEMO-REFONTE, partie 3).
 * L'état reste dans l'onglet (`sessionStorage`) : aucun suivi n'est envoyé au serveur.
 */
export const DEMO_CHECKLIST_STEPS = [
  { id: "assign", label: "Affecter une livraison en attente", persona: "admin", path: "/dispatch" },
  { id: "track", label: "Suivre le livreur sur la carte", persona: "client", path: "/portal/deliveries" },
  { id: "deliver", label: "Livrer une mission avec preuve", persona: "driver", path: "/driver" },
  { id: "invoice", label: "Ouvrir la facture et la preuve", persona: "client", path: "/portal/invoices" },
] as const satisfies readonly { id: string; label: string; persona: DemoPersona; path: string }[];

export type DemoChecklistStepId = (typeof DEMO_CHECKLIST_STEPS)[number]["id"];

export const DEMO_CHECKLIST_STORAGE_KEY = "tutelliv-demo-checklist";
export const DEMO_CHECKLIST_EVENT = "tutelliv-demo-checklist";

type KeyValueStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const STEP_IDS = new Set<string>(DEMO_CHECKLIST_STEPS.map((step) => step.id));

export function demoChecklistStep(id: DemoChecklistStepId) {
  return DEMO_CHECKLIST_STEPS.find((step) => step.id === id)!;
}

/** Étapes faites, dans l'ordre de la liste ; une valeur abîmée ou inconnue est ignorée. */
export function readDemoChecklist(storage: KeyValueStorage): DemoChecklistStepId[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(storage.getItem(DEMO_CHECKLIST_STORAGE_KEY) ?? "[]");
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const done = new Set(parsed.filter((id): id is string => typeof id === "string" && STEP_IDS.has(id)));
  return DEMO_CHECKLIST_STEPS.filter((step) => done.has(step.id)).map((step) => step.id);
}

/**
 * Coche une étape si la vue active est celle de l'étape (une preuve ouverte par l'administrateur ne coche
 * pas l'étape du client). Renvoie vrai seulement si l'étape vient d'être cochée.
 */
export function recordDemoChecklistStep(
  storage: KeyValueStorage,
  id: DemoChecklistStepId,
  persona: DemoPersona
): boolean {
  if (demoChecklistStep(id).persona !== persona) return false;
  const done = readDemoChecklist(storage);
  if (done.includes(id)) return false;
  storage.setItem(DEMO_CHECKLIST_STORAGE_KEY, JSON.stringify([...done, id]));
  return true;
}

export function clearDemoChecklist(storage: KeyValueStorage): void {
  storage.removeItem(DEMO_CHECKLIST_STORAGE_KEY);
}

/** Étape cochée par la simple ouverture d'une page : carte des livraisons, détail d'une facture. */
export function demoChecklistStepForPath(pathname: string): DemoChecklistStepId | null {
  if (pathname === "/portal/deliveries" || pathname.startsWith("/portal/deliveries/")) return "track";
  if (pathname.startsWith("/portal/invoices/")) return "invoice";
  return null;
}
