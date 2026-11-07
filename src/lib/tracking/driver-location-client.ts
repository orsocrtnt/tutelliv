export type DriverLocationClientStatus =
  | "stopped"
  | "requesting"
  | "synced"
  | "stale"
  | "denied"
  | "unavailable"
  | "timeout"
  | "unsupported"
  | "offline"
  | "sync-error";

export type DriverLocationPublication = {
  updatedAt: string;
};

export class DriverLocationPublishError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null
  ) {
    super(message);
    this.name = "DriverLocationPublishError";
  }
}

export function geolocationErrorStatus(code: number): DriverLocationClientStatus {
  if (code === 1) return "denied";
  if (code === 3) return "timeout";
  return "unavailable";
}

export function locationIsStale(
  lastSyncedAt: string | null,
  staleAfterMs: number,
  now = Date.now()
) {
  if (!lastSyncedAt) return false;
  const timestamp = Date.parse(lastSyncedAt);
  return Number.isFinite(timestamp) && now - timestamp >= staleAfterMs;
}

export async function publishDriverLocation(
  coordinates: { latitude: number; longitude: number; accuracy?: number | null },
  fetcher: typeof fetch = fetch
): Promise<DriverLocationPublication> {
  let response: Response;
  try {
    response = await fetcher("/api/driver/location", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(coordinates),
    });
  } catch {
    throw new DriverLocationPublishError("Impossible de joindre TutelLiv.");
  }

  const text = await response.text();
  let body: { data?: { updatedAt?: unknown }; error?: unknown } = {};
  if (text) {
    try {
      body = JSON.parse(text) as typeof body;
    } catch {
      throw new DriverLocationPublishError("Réponse de synchronisation invalide.", response.status);
    }
  }
  if (!response.ok) {
    throw new DriverLocationPublishError(
      typeof body.error === "string" ? body.error : `Synchronisation refusée (${response.status}).`,
      response.status
    );
  }
  if (typeof body.data?.updatedAt !== "string" || !Number.isFinite(Date.parse(body.data.updatedAt))) {
    throw new DriverLocationPublishError("Confirmation de synchronisation invalide.", response.status);
  }
  return { updatedAt: body.data.updatedAt };
}

export function driverLocationStatusMessage(input: {
  status: DriverLocationClientStatus;
  lastPositionAt?: string | null;
  lastSyncedAt?: string | null;
  error?: string | null;
}) {
  const suffix = input.lastSyncedAt
    ? ` Dernière synchronisation : ${new Date(input.lastSyncedAt).toLocaleString("fr-FR")}.`
    : "";
  switch (input.status) {
    case "stopped": return "Partage GPS arrêté.";
    case "requesting": return "Recherche du signal GPS et synchronisation…";
    case "synced": return `Position synchronisée avec TutelLiv.${suffix}`;
    case "stale": return `Position périmée : aucun signal récent n’a été synchronisé.${suffix}`;
    case "denied": return "Localisation refusée. Autorisez-la dans les réglages du navigateur puis réessayez.";
    case "unavailable": return "Signal GPS indisponible. Vérifiez la localisation de l’appareil puis réessayez.";
    case "timeout": return "Le GPS n’a pas répondu à temps. Réessayez dans un endroit dégagé.";
    case "unsupported": return "La localisation n’est pas disponible dans ce navigateur.";
    case "offline": return `Appareil hors ligne : la position n’est pas synchronisée.${suffix}`;
    case "sync-error": return `${input.error ?? "Synchronisation GPS impossible."}${suffix}`;
  }
}

const PARIS_TIME = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });

/** États GPS qui demandent une action du livreur : ils gardent le bandeau complet avec « Réessayer ». */
export function driverLocationNeedsAttention(status: DriverLocationClientStatus): boolean {
  return ["denied", "unavailable", "timeout", "offline", "sync-error", "stale", "unsupported"].includes(status);
}

/**
 * Ligne courte sous « Service ouvert » quand tout va bien (AUDIT-0411 : la mission en cours
 * arrivait sous quatre bandeaux sur téléphone). Heure de Paris, comme le reste de l'application.
 */
export function driverLocationShortLabel(input: {
  status: DriverLocationClientStatus;
  serviceActive: boolean;
  hasActiveMission: boolean;
  lastSyncedAt?: string | null;
}): string {
  if (input.status === "requesting") return "Recherche du signal GPS…";
  if (!input.serviceActive) return "Position non partagée";
  if (!input.hasActiveMission) return "Position partagée dès qu’une mission démarre";
  if (input.status === "synced") {
    return input.lastSyncedAt ? `Position envoyée à ${PARIS_TIME.format(new Date(input.lastSyncedAt))}` : "Position envoyée";
  }
  return driverLocationStatusMessage({ status: input.status, lastSyncedAt: input.lastSyncedAt });
}
