import type { DemoPersona } from "@/lib/demo/constants";

/**
 * Liste « À essayer » de la barre de démo (DEMO-REFONTE, partie 3).
 * L'état reste dans l'onglet (`sessionStorage`) : aucun suivi n'est envoyé au serveur.
 * Chaque étape se coche toute seule quand le geste est fait, quelle que soit la vue active.
 */
export const DEMO_CHECKLIST_STEPS = [
  {
    id: "assign",
    label: "Affecter une livraison",
    how: "Dans Dispatch, choisissez un livreur pour une livraison « Sans livreur ».",
    persona: "admin",
    path: "/dispatch",
  },
  {
    id: "track",
    label: "Suivre le livreur en direct",
    how: "Sur la carte, ouvrez « Livraisons en cours » en haut à gauche, puis cliquez une livraison : le livreur avance en direct.",
    persona: "client",
    path: "/portal/deliveries",
  },
  {
    id: "deliver",
    label: "Livrer avec preuve",
    how: "Ouvrez une mission en cours, puis « Confirmer la livraison » avec photo, signature et nom.",
    persona: "driver",
    path: "/driver",
  },
  {
    id: "invoice",
    label: "Voir la facture et la preuve",
    how: "Ouvrez une facture, ou la preuve PDF d'une livraison livrée (photo et signature).",
    persona: "client",
    path: "/portal/invoices",
  },
] as const satisfies readonly { id: string; label: string; how: string; persona: DemoPersona; path: string }[];

export type DemoChecklistStepId = (typeof DEMO_CHECKLIST_STEPS)[number]["id"];
export type DemoChecklistStep = (typeof DEMO_CHECKLIST_STEPS)[number];

export const DEMO_CHECKLIST_STORAGE_KEY = "tutelliv-demo-checklist";
/** Étape ouverte depuis la liste : la bande « étape en cours » la rappelle jusqu'à ce qu'elle soit faite. */
export const DEMO_CHECKLIST_ACTIVE_KEY = "tutelliv-demo-checklist-active";
export const DEMO_CHECKLIST_EVENT = "tutelliv-demo-checklist";

type KeyValueStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const STEP_IDS = new Set<string>(DEMO_CHECKLIST_STEPS.map((step) => step.id));

function isStepId(value: unknown): value is DemoChecklistStepId {
  return typeof value === "string" && STEP_IDS.has(value);
}

export function demoChecklistStep(id: DemoChecklistStepId): DemoChecklistStep {
  return DEMO_CHECKLIST_STEPS.find((step) => step.id === id)!;
}

/** Numéro de l'étape dans la liste (1 à 4). */
export function demoChecklistStepNumber(id: DemoChecklistStepId): number {
  return DEMO_CHECKLIST_STEPS.findIndex((step) => step.id === id) + 1;
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
  const done = new Set(parsed.filter(isStepId));
  return DEMO_CHECKLIST_STEPS.filter((step) => done.has(step.id)).map((step) => step.id);
}

/** Première étape pas encore faite, dans l'ordre de la liste. */
export function nextDemoChecklistStep(done: readonly DemoChecklistStepId[]): DemoChecklistStep | null {
  return DEMO_CHECKLIST_STEPS.find((step) => !done.includes(step.id)) ?? null;
}

/**
 * Coche une étape, quelle que soit la vue active (une facture ouverte par l'administrateur compte aussi).
 * Renvoie vrai seulement si l'étape vient d'être cochée ; l'étape en cours, si c'était elle, est terminée.
 */
export function recordDemoChecklistStep(storage: KeyValueStorage, id: DemoChecklistStepId): boolean {
  const done = readDemoChecklist(storage);
  if (done.includes(id)) return false;
  storage.setItem(DEMO_CHECKLIST_STORAGE_KEY, JSON.stringify([...done, id]));
  if (readActiveDemoChecklistStep(storage) === id) storage.removeItem(DEMO_CHECKLIST_ACTIVE_KEY);
  return true;
}

/** Étape en cours, si elle n'est pas déjà faite. */
export function readActiveDemoChecklistStep(storage: KeyValueStorage): DemoChecklistStepId | null {
  const value = storage.getItem(DEMO_CHECKLIST_ACTIVE_KEY);
  if (!isStepId(value)) return null;
  return readDemoChecklist(storage).includes(value) ? null : value;
}

export function writeActiveDemoChecklistStep(storage: KeyValueStorage, id: DemoChecklistStepId | null): void {
  if (id) storage.setItem(DEMO_CHECKLIST_ACTIVE_KEY, id);
  else storage.removeItem(DEMO_CHECKLIST_ACTIVE_KEY);
}

export function clearDemoChecklist(storage: KeyValueStorage): void {
  storage.removeItem(DEMO_CHECKLIST_STORAGE_KEY);
  storage.removeItem(DEMO_CHECKLIST_ACTIVE_KEY);
}

/**
 * Étape cochée par l'ouverture d'une page : détail d'une livraison (client) ou carte en direct (administrateur)
 * pour le suivi, détail d'une facture pour la facture. Arriver sur la carte client ne coche rien (le clic sur
 * une livraison de sa liste, si) : le visiteur lit d'abord la consigne de la bande « étape en cours ».
 */
export function demoChecklistStepForPath(pathname: string): DemoChecklistStepId | null {
  if (/^\/portal\/deliveries\/[^/]+/.test(pathname) || pathname === "/dispatch/map") return "track";
  if (/^\/portal\/invoices\/[^/]+/.test(pathname)) return "invoice";
  return null;
}
