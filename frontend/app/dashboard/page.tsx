"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { health, getStats } from "@/lib/api";
import type { Stats } from "@/lib/types";

export default function DashboardPage() {
  const [apiOk, setApiOk] = useState<null | boolean>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setErr(null);
    setLoading(true);
    try {
      await health();
      setApiOk(true);
    } catch {
      setApiOk(false);
    }
    try {
      const s = await getStats();
      setStats(s);
    } catch (e: any) {
      setErr(e?.message ?? "Erreur de chargement des statistiques");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let t: ReturnType<typeof setInterval> | null = null;
    (async () => {
      await refresh();
      t = setInterval(refresh, 10000);
    })();
    return () => {
      if (t) clearInterval(t);
    };
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Tableau de bord</h1>
        <button onClick={refresh} className="btn btn-secondary">Rafraîchir</button>
      </div>

      {err && (
        <div className="rounded-lg border p-3 text-red-600">{err}</div>
      )}

      <div className="grid md:grid-cols-3 gap-4">
        <Card title="Missions en cours" value={stats?.missions_in_progress ?? 0} loading={loading} />
        <Card title="Bénéficiaires actifs (30j)" value={stats?.beneficiaries_active ?? 0} loading={loading} />
        <Card title="Factures en attente" value={stats?.invoices_pending ?? 0} loading={loading} />
      </div>

      <div className="flex gap-3">
        <Link href="/missions/new" className="btn btn-primary">Créer une nouvelle livraison</Link>
        <Link href="/beneficiaires/new" className="btn btn-secondary">Nouveau protégé</Link>
      </div>

      <div className="text-sm text-gray-500">
        API: {apiOk === null ? "..." : apiOk ? "OK ✅" : "Erreur ❌"}
        {stats?.generated_at && (
          <> · Actualisé: {new Date(stats.generated_at).toLocaleString("fr-FR")}</>
        )}
      </div>
    </div>
  );
}

function Card({ title, value, loading }: { title: string; value: number; loading?: boolean }) {
  return (
    <div className="rounded-lg border bg-white">
      <div className="p-4">
        <div className="text-sm text-gray-500">{title}</div>
        <div className="text-3xl font-bold mt-1">{loading ? "…" : value}</div>
      </div>
    </div>
  );
}
