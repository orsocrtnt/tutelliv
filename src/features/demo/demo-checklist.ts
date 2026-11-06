"use client";

import { useAuthStore } from "@/stores/auth.store";
import {
  clearDemoChecklist,
  DEMO_CHECKLIST_EVENT,
  recordDemoChecklistStep,
  type DemoChecklistStepId,
} from "@/lib/demo/demo-checklist";

function tabStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/** Coche une étape « À essayer » ; sans effet hors démo ou dans une autre vue que celle de l'étape. */
export function markDemoChecklistStep(id: DemoChecklistStepId): void {
  const demo = useAuthStore.getState().demo;
  const storage = tabStorage();
  if (!demo?.isDemo || !storage) return;
  try {
    if (recordDemoChecklistStep(storage, id, demo.persona)) {
      // Annonce décalée d'un tour : rendue pendant la fermeture du choix de livreur (Radix Select),
      // la mise à jour de la barre faisait planter la page (« removeChild », relevé sur tutelliv.fr).
      window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent(DEMO_CHECKLIST_EVENT, { detail: { id } }));
      }, 0);
    }
  } catch {
    /* stockage plein ou refusé : la liste reste simplement non cochée */
  }
}

/** Démo neuve ou réinitialisée : la liste repart de zéro. */
export function resetDemoChecklist(): void {
  const storage = tabStorage();
  if (!storage) return;
  try {
    clearDemoChecklist(storage);
    window.dispatchEvent(new CustomEvent(DEMO_CHECKLIST_EVENT));
  } catch {
    /* ignore */
  }
}
