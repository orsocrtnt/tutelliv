"use client";
import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
type ServiceState = { active: boolean; startedAt: string | null; endedAt: string | null };
async function serviceRequest(active?: boolean): Promise<ServiceState> {
  const response = await fetch("/api/driver/service", { cache: "no-store", ...(active === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ active }) }) });
  const json = await response.json(); if (!response.ok) throw new Error(json.error ?? "Service indisponible."); return json.data;
}
export function useDriverService() { return useQuery({ queryKey: ["driver-service"], queryFn: () => serviceRequest(), refetchInterval: 10_000, retry: false }); }
/**
 * Carte unique « service + position » en haut de l'app livreur (AUDIT-0411) : une ligne GPS courte
 * quand tout va bien ; le bandeau GPS complet (avec « Réessayer ») seulement en cas de problème.
 */
export function DriverServiceControl({ gps, gpsProblem }: { gps?: ReactNode; gpsProblem?: ReactNode } = {}) {
  const query = useDriverService(), cache = useQueryClient(); const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  async function toggle() {
    if (!query.data || busy) return; setBusy(true); setError(null);
    try { const state = await serviceRequest(!query.data.active); cache.setQueryData(["driver-service"], state); await cache.invalidateQueries({ queryKey: ["order-tracking"] }); }
    catch (e) { setError((e as Error).message); await query.refetch(); } finally { setBusy(false); }
  }
  const title = query.error ? "État du service indisponible" : !query.data ? "Chargement du service…" : query.data.active ? "Service ouvert" : "Service arrêté";
  return <section className="mx-4 mb-3 mt-3 rounded-xl border border-border bg-card px-3 py-2 text-sm" aria-label="Service et partage de position">
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="font-medium">{title}</p>
        {gps && <div className="text-xs text-muted-foreground">{gps}</div>}
      </div>
      <Button variant={query.data?.active ? "outline" : "default"} size="sm" className="shrink-0" disabled={!query.data || busy || Boolean(query.error)} onClick={toggle} aria-describedby="driver-service-hint">{busy ? "Enregistrement…" : query.data?.active ? "Terminer le service" : "Commencer le service"}</Button>
    </div>
    <p id="driver-service-hint" className="sr-only">Position partagée uniquement pendant une mission démarrée. Terminer le service arrête ce partage pour toutes vos missions ; cela ne clôture pas les livraisons.</p>
    {gpsProblem && <div className="mt-2">{gpsProblem}</div>}
    {(error || query.error) && <p role="alert" className="mt-2 text-destructive">{error ?? query.error?.message}</p>}
  </section>;
}
