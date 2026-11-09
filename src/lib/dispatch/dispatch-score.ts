import type { DispatchProximityStatus } from "@/lib/dispatch/dispatch-proximity";
import { QUEUE_MISSION_FALLBACK_SECONDS } from "@/lib/dispatch/driver-queue";
import { TRAVEL_FALLBACK_LABELS, type TravelEstimate } from "@/lib/dispatch/travel-time";

/**
 * DISPATCH-4, revu par DISPATCH-5 (9 novembre 2026) — score d'affectation explicable (0 à 100), calculé
 * sur les livreurs déjà éligibles (règles dures et plafonds de charge respectés). Poids documentés :
 *
 * - heure d'arrivée : 80 % — temps pour finir les livraisons en cours, puis trajet jusqu'au retrait (ou
 *   jusqu'à l'adresse de livraison si le retrait n'est pas saisi). 0 min = 1, 4 h ou plus = 0, linéaire.
 *   Pour une livraison à créneau, arriver avant le début du créneau ne rapporte rien de plus : tous ceux
 *   qui tiennent le créneau sont à égalité, et le plus occupé d'entre eux passe devant, pour garder les
 *   autres libres pour les urgences. Trajet inconnu : 20 min si personne n'a de position utilisable
 *   (GPS non utilisé, livraison sans coordonnées), 30 min en service sans position récente ;
 *   la file est alors estimée à 15 min par livraison en cours. Hors service = 0 (ne travaille pas) ;
 * - zone : 10 % — livreur attitré de la zone = 1, zone couverte par sa règle = 0,75, sans
 *   restriction de zone = 0,5 ;
 * - priorité réglée : 10 % — 1/priorité (priorité 1 = 1), sans règle = 0.
 *
 * La charge n'a plus de poids propre : elle est déjà comptée dans l'heure d'arrivée (la mesure du
 * 9 novembre montre qu'un poids de charge en plus dégrade la ponctualité). Le plafond de charge reste
 * une règle dure. À score égal : arrivée la plus tôt (créneau compris), puis le plus occupé qui tient le
 * créneau, puis trajet connu le plus court, charge la plus faible, ordre stable (id).
 */
export const DISPATCH_SCORE_WEIGHTS = { arrival: 0.8, zone: 0.1, priority: 0.1 } as const;
export const ARRIVAL_SCORE_HORIZON_SECONDS = 4 * 60 * 60;
export const DISPATCH_SUGGESTION_COUNT = 3;

/** Raison recopiée dans l'historique visible du client : aucun chiffre ni position. */
export const BEST_SCORE_HISTORY_REASON = "Meilleur score (heure d'arrivée, zone)";
export const SUGGESTION_HISTORY_REASON = "Suggestion validée par le dispatch";

export type ScoreZoneMatch = "PREFERRED" | "COVERED" | "ANY";

export type ScoreCandidate = {
  id: string;
  load: number;
  maxLoad: number;
  priority: number | null;
  zone: ScoreZoneMatch;
  zoneName: string | null;
  /** Trajet jusqu'au point visé, depuis la fin de la file du livreur. */
  travel: TravelEstimate | null;
  positionStatus: DispatchProximityStatus;
  /** Temps pour finir les livraisons en cours ; absent : 15 min par livraison en cours. */
  queueSeconds?: number;
  /** Point visé : le retrait, ou l'adresse de livraison quand le retrait n'est pas saisi. */
  target?: "PICKUP" | "DROPOFF";
  /** Créneau à venir : début dans `startsInSeconds`, livraison `afterArrivalSeconds` après l'arrivée. */
  slot?: { startsInSeconds: number; afterArrivalSeconds: number } | null;
};

export type RankedCandidate = ScoreCandidate & {
  rank: number;
  score: number;
  explanation: string;
  /** Minutes avant l'arrivée au point visé, file comprise ; `null` si le trajet est inconnu. */
  arrivalMinutes: number | null;
};

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

const POSITION_LABELS: Partial<Record<DispatchProximityStatus, string>> = {
  OFF_DUTY: "hors service",
  STALE: "position trop ancienne",
  NO_POSITION: "aucune position",
  NO_PICKUP: "livraison sans coordonnées",
  DISABLED: "GPS non utilisé",
};

/** Trajet inconnu : personne n'a d'information (neutre) ou ce livreur n'a pas de position récente. */
const UNKNOWN_TRAVEL_SECONDS: Partial<Record<DispatchProximityStatus, number>> = {
  DISABLED: 20 * 60,
  NO_PICKUP: 20 * 60,
  NO_POSITION: 30 * 60,
  STALE: 30 * 60,
};

/** Secondes avant d'arriver au point visé, file comprise ; `null` hors service. */
export function arrivalSeconds(candidate: ScoreCandidate): number | null {
  if (candidate.positionStatus === "OFF_DUTY" && !candidate.travel) return null;
  const queue = candidate.queueSeconds ?? candidate.load * QUEUE_MISSION_FALLBACK_SECONDS;
  const leg = candidate.travel?.seconds ?? UNKNOWN_TRAVEL_SECONDS[candidate.positionStatus] ?? 30 * 60;
  return queue + leg;
}

/** Arrivée retenue pour le score : jamais avant le début du créneau (arriver plus tôt ne sert à rien). */
function effectiveArrival(candidate: ScoreCandidate): number | null {
  const arrival = arrivalSeconds(candidate);
  if (arrival === null) return null;
  const slot = candidate.slot;
  return slot ? Math.max(arrival + slot.afterArrivalSeconds, slot.startsInSeconds) : arrival;
}

function fitsSlot(candidate: ScoreCandidate): boolean {
  const arrival = arrivalSeconds(candidate);
  const slot = candidate.slot;
  return Boolean(slot && arrival !== null && arrival + slot.afterArrivalSeconds <= slot.startsInSeconds);
}

export function arrivalScore(candidate: ScoreCandidate): number {
  const seconds = effectiveArrival(candidate);
  return seconds === null ? 0 : clamp01(1 - seconds / ARRIVAL_SCORE_HORIZON_SECONDS);
}

const ZONE_SCORES: Record<ScoreZoneMatch, number> = { PREFERRED: 1, COVERED: 0.75, ANY: 0.5 };

export function priorityScore(priority: number | null): number {
  return priority && priority >= 1 ? 1 / priority : 0;
}

export function scoreCandidate(candidate: ScoreCandidate): number {
  const w = DISPATCH_SCORE_WEIGHTS;
  const total =
    w.arrival * arrivalScore(candidate) +
    w.zone * ZONE_SCORES[candidate.zone] +
    w.priority * priorityScore(candidate.priority);
  return Math.round(total * 100);
}

export function formatTravelMinutes(seconds: number): string {
  return seconds < 60 ? "moins d'une minute" : `${Math.round(seconds / 60)} min`;
}

/** « Pourquoi ce livreur » en une phrase, pour le dispatcher uniquement. */
export function explainCandidate(candidate: ScoreCandidate): string {
  const parts: string[] = [];
  const travel = candidate.travel;
  const where = candidate.target === "DROPOFF" ? "à l'adresse de livraison" : "au retrait";
  if (travel) {
    const arrival = arrivalSeconds(candidate)!;
    const queued = arrival - travel.seconds >= 60;
    const when = arrival < 60 ? "dans moins d'une minute" : `dans environ ${formatTravelMinutes(arrival)}`;
    const leg = travel.source === "ROUTE"
      ? queued ? `dont ${formatTravelMinutes(travel.seconds)} de trajet routier` : "trajet routier"
      : `${queued ? `dont ${formatTravelMinutes(travel.seconds)} ` : ""}à vol d'oiseau, ${TRAVEL_FALLBACK_LABELS[travel.fallbackReason]}`;
    parts.push(`arrivée ${where} ${when} (${leg})`);
  } else {
    parts.push(`trajet inconnu (${POSITION_LABELS[candidate.positionStatus] ?? "aucune position"})`);
  }
  parts.push(
    candidate.load === 0
      ? "aucune livraison en cours"
      : `${candidate.load} livraison${candidate.load > 1 ? "s" : ""} en cours sur ${candidate.maxLoad}`
  );
  if (travel && fitsSlot(candidate)) parts.push("à temps pour le créneau");
  if (candidate.zone === "PREFERRED") parts.push(`attitré à la zone « ${candidate.zoneName ?? "—"} »`);
  else if (candidate.zone === "COVERED") parts.push("couvre la zone de la livraison");
  if (candidate.priority) parts.push(`priorité ${candidate.priority}`);
  const sentence = parts.join(", ");
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
}

const INFINITE = Number.POSITIVE_INFINITY;

/**
 * Ordre total et transitif : score, arrivée retenue, puis — si les deux tiennent le créneau — le plus
 * occupé d'abord, trajet connu le plus court, charge, id.
 */
export function rankDispatchCandidates(candidates: ScoreCandidate[]): RankedCandidate[] {
  return candidates
    .map((candidate) => ({
      candidate,
      score: scoreCandidate(candidate),
      effective: effectiveArrival(candidate) ?? INFINITE,
      arrival: arrivalSeconds(candidate) ?? INFINITE,
      fits: fitsSlot(candidate),
    }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.effective - b.effective ||
        (a.fits && b.fits ? b.arrival - a.arrival : 0) ||
        (a.candidate.travel?.seconds ?? INFINITE) - (b.candidate.travel?.seconds ?? INFINITE) ||
        a.candidate.load - b.candidate.load ||
        a.candidate.id.localeCompare(b.candidate.id)
    )
    .map(({ candidate, score, arrival }, index) => ({
      ...candidate,
      rank: index + 1,
      score,
      explanation: explainCandidate(candidate),
      arrivalMinutes: candidate.travel && Number.isFinite(arrival) ? Math.max(1, Math.round(arrival / 60)) : null,
    }));
}
