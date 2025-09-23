"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { listMissions, listBeneficiaries, getStats } from "@/lib/api";
import type { Mission, Beneficiary, Stats } from "@/lib/types";
import MissionsCalendar from "@/components/MissionsCalendar";
import { connectEvents } from "@/lib/realtime"; // ✅ SSE

export default function DashboardMjpmPage() {
  const [missions, setMissions] = useState<Mission[]>([]);
  const [beneficiaries, setBeneficiaries] = useState<Beneficiary[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);

  const [loading, setLoading] = useState(true);
  const [loadingStats, setLoadingStats] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [errStats, setErrStats] = useState<string | null>(null);

  async function loadData() {
    setLoading(true);
    setErr(null);
    try {
      const [ms, bs] = await Promise.all([listMissions(), listBeneficiaries()]);
      setMissions(ms);
      setBeneficiaries(bs);
    } catch (e: any) {
      setErr(e?.message ?? "Erreur lors du chargement");
    } finally {
      setLoading(false);
    }
  }

  async function loadStats() {
    setLoadingStats(true);
    setErrStats(null);
    try {
      const s = await getStats();
      setStats(s);
    } catch (e: any) {
      setErrStats(e?.message ?? "Erreur lors du chargement des statistiques");
    } finally {
      setLoadingStats(false);
    }
  }

  async function loadAll() {
    await Promise.allSettled([loadData(), loadStats()]);
  }

  useEffect(() => {
    loadAll();
    // ✅ Abonnement temps réel
    const unsubscribe = connectEvents((msg) => {
      if (
        msg.type === "mission.created" ||
        msg.type === "mission.updated" ||
        msg.type === "mission.deleted" ||
        msg.type === "invoice.updated"
      ) {
        loadAll();
      }
    });
    return () => unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onRefresh = () => loadAll();

  return (
    <div className="space-y-6">
      {/* --- Header --- */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl sm:text-2xl font-semibold">Tableau de bord – MJPM</h1>
        <div className="flex flex-wrap gap-2">
          <Link href="/missions/new" className="btn-primary">Nouvelle mission</Link>
          <Link href="/beneficiaires/new" className="btn-primary">Nouveau protégé</Link>
          <button className="btn-secondary" onClick={onRefresh}>Rafraîchir</button>
        </div>
      </div>

      {/* --- Widgets --- */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Missions en cours */}
        <div className="rounded-xl border bg-white p-4">
          <div className="text-sm text-gray-500">Missions en cours</div>
          {loadingStats ? (
            <div className="h-8 w-16 animate-pulse bg-gray-200 rounded mt-1" />
          ) : errStats ? (
            <div className="text-red-600 text-sm mt-1">{errStats}</div>
          ) : (
            <div className="text-2xl sm:text-3xl font-semibold mt-1">
              {stats?.missions_in_progress ?? 0}
            </div>
          )}
        </div>

        {/* Protégés actifs (30j) */}
        <div className="rounded-xl border bg-white p-4">
          <div className="text-sm text-gray-500">Protégés actifs (30j)</div>
          {loadingStats ? (
            <div className="h-8 w-16 animate-pulse bg-gray-200 rounded mt-1" />
          ) : errStats ? (
            <div className="text-red-600 text-sm mt-1">{errStats}</div>
          ) : (
            <div className="text-2xl sm:text-3xl font-semibold mt-1">
              {stats?.beneficiaries_active ?? 0}
            </div>
          )}
        </div>

        {/* Factures en attente */}
        <div className="rounded-xl border bg-white p-4">
          <div className="text-sm text-gray-500">Factures en attente</div>
          {loadingStats ? (
            <div className="h-8 w-16 animate-pulse bg-gray-200 rounded mt-1" />
          ) : errStats ? (
            <div className="text-red-600 text-sm mt-1">{errStats}</div>
          ) : (
            <div className="text-2xl sm:text-3xl font-semibold mt-1">
              {stats?.invoices_pending ?? 0}
            </div>
          )}
        </div>
      </div>

      {/* Meta stats */}
      {!loadingStats && !errStats && stats?.generated_at && (
        <div className="text-xs text-gray-500">
          Données générées le {new Date(stats.generated_at).toLocaleString("fr-FR")}
        </div>
      )}

      {/* Erreur données */}
      {err && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-red-700">
          {err}
        </div>
      )}

      {/* Calendrier */}
      {!loading && !err && (
        <MissionsCalendar missions={missions} beneficiaries={beneficiaries} role="mjpm" />
      )}
    </div>
  );
}
