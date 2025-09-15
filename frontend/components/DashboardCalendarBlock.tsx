"use client";

import { useEffect, useState } from "react";
import { listMissions, listBeneficiaries } from "@/lib/api";
import type { Mission, Beneficiary } from "@/lib/types";
import MissionsCalendar from "@/components/MissionsCalendar";

export default function DashboardCalendarBlock({ role }: { role: "mjpm" | "deliverer" }) {
  const [missions, setMissions] = useState<Mission[]>([]);
  const [beneficiaries, setBeneficiaries] = useState<Beneficiary[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const [ms, bs] = await Promise.all([listMissions(), listBeneficiaries()]);
      setMissions(ms);
      setBeneficiaries(bs);
    } catch (e: any) {
      setErr(e?.message ?? "Erreur lors du chargement du calendrier");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // Optionnel : polling si tu veux auto-refresh
    // const t = setInterval(load, 15000);
    // return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return (
      <div className="card">
        <div className="card-body">Chargement du calendrier…</div>
      </div>
    );
  }

  if (err) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-red-700 flex items-center justify-between">
        <span>{err}</span>
        <button className="btn btn-secondary" onClick={load}>Réessayer</button>
      </div>
    );
  }

  return (
    <MissionsCalendar missions={missions} beneficiaries={beneficiaries} role={role} />
  );
}

