import { straightLineSeconds, type GeoPoint } from "@/lib/dispatch/travel-time";

/**
 * DISPATCH-5 — temps avant qu'un livreur soit libre, file comprise. Module pur.
 *
 * La mesure du 9 novembre 2026 (`docs/operations/dispatch5/MESURE_2026-11-09.md`) a montré que le score
 * qui regardait la position actuelle du livreur, sans ses missions en cours, choisissait le livreur proche
 * mais occupé. On estime donc la fin de sa file : retrait (s'il n'est pas déjà fait) puis livraison de
 * chaque mission, dans l'ordre de l'application livreur, à vol d'oiseau et 5 min par arrêt.
 */

export const QUEUE_STOP_SECONDS = 5 * 60;
/** Mission sans coordonnées, ou livreur sans position : même forfait que les tournées. */
export const QUEUE_MISSION_FALLBACK_SECONDS = 15 * 60;

export type QueueMission = {
  /** `IN_DELIVERY` : colis déjà à bord, seul reste la livraison. */
  status: string;
  pickup: GeoPoint | null;
  destination: GeoPoint | null;
};

export type DriverQueue = {
  seconds: number;
  missions: number;
  /** Dernier arrêt connu : départ du trajet vers la nouvelle livraison. */
  end: GeoPoint;
};

export function estimateDriverQueue(start: GeoPoint, missions: QueueMission[]): DriverQueue {
  let position = start;
  let seconds = 0;
  for (const mission of missions) {
    if (!mission.destination) {
      seconds += QUEUE_MISSION_FALLBACK_SECONDS;
      continue;
    }
    const stops = mission.status !== "IN_DELIVERY" && mission.pickup ? [mission.pickup, mission.destination] : [mission.destination];
    for (const stop of stops) {
      seconds += straightLineSeconds(position, stop) + QUEUE_STOP_SECONDS;
      position = stop;
    }
  }
  return { seconds, missions: missions.length, end: position };
}
