"use client";

export const dynamic = "force-dynamic";
export const dynamicParams = true;
export const revalidate = 0;

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { getBeneficiary, listMissions, listInvoices } from "@/lib/api";
import type { Beneficiary, Mission, Invoice } from "@/lib/types";

const CAT_FR: Record<string, string> = {
  FOOD: "Alimentaire",
  HYGIENE: "Hygiène",
  TOBACCO_MANDATE: "Tabac (mandat)",
  CASH_DELIVERY: "Livraison espèces",
  OTHER: "Autre",
};

export default function BeneficiaryProfilePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();

  const beneId = useMemo(() => {
    const raw =
      typeof params?.id === "string"
        ? params.id
        : Array.isArray(params?.id)
        ? params?.id?.[0]
        : "";
    return raw;
  }, [params?.id]);

  const [bene, setBene] = useState<Beneficiary | null>(null);
  const [missions, setMissions] = useState<Mission[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    if (!beneId) {
      setErr("Identifiant de protégé manquant.");
      setLoading(false);
      return;
    }

    (async () => {
      try {
        setErr(null);
        setLoading(true);

        // ✅ charge le protégé via /beneficiaries/{id}
        const [b, ms, invs] = await Promise.all([
          getBeneficiary(beneId),
          listMissions(),
          listInvoices(),
        ]);
        if (!mounted) return;

        setBene(b);

        const filteredMissions = ms.filter(
          (m) => String(m.beneficiary_id) === String(b.id)
        );
        setMissions(filteredMissions);

        const filteredInvoices = invs.filter((i) => {
          const m = ms.find((mm) => mm.id === i.mission_id);
          return m && String(m.beneficiary_id) === String(b.id);
        });
        setInvoices(filteredInvoices);
      } catch (e: any) {
        if (!mounted) return;
        setErr(e?.message ?? "Erreur lors du chargement du profil");
      } finally {
        if (!mounted) return;
        setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [beneId]);

  const fullName = useMemo(() => {
    if (!bene) return "Protégé";
    return `${bene.last_name?.toUpperCase() ?? ""} ${bene.first_name ?? ""}`.trim();
  }, [bene]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="text-sm text-gray-500">
          <button className="btn btn-secondary" onClick={() => router.back()}>
            ← Retour
          </button>
        </div>
        <div className="card">
          <div className="card-body">Chargement…</div>
        </div>
      </div>
    );
  }

  if (err) {
    return (
      <div className="space-y-4">
        <div className="text-sm text-gray-500">
          <button className="btn btn-secondary" onClick={() => router.back()}>
            ← Retour
          </button>
        </div>
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-red-700">
          {err}
        </div>
        <div>
          <Link href="/beneficiaires" className="text-blue-700 hover:underline">
            ← Retour à la liste des protégés
          </Link>
        </div>
      </div>
    );
  }

  if (!bene) {
    return (
      <div className="space-y-4">
        <div className="text-sm text-gray-500">
          <button className="btn btn-secondary" onClick={() => router.back()}>
            ← Retour
          </button>
        </div>
        <div className="card">
          <div className="card-body">Protégé introuvable.</div>
        </div>
        <div>
          <Link href="/beneficiaires" className="text-blue-700 hover:underline">
            ← Retour à la liste des protégés
          </Link>
        </div>
      </div>
    );
  }

  const mapsHref = bene.address
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
        `${bene.address} ${bene.postal_code ?? ""} ${bene.city ?? ""}`
      )}`
    : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="h-16 w-16 rounded-full overflow-hidden border bg-gray-100">
            {bene.photo_url ? (
              <img
                src={bene.photo_url}
                alt={fullName}
                className="h-full w-full object-cover"
              />
            ) : null}
          </div>
          <div>
            <h1 className="text-2xl font-semibold">{fullName}</h1>
            <div className="text-sm text-gray-600">ID: {String(bene.id)}</div>
          </div>
        </div>
        <button className="btn btn-secondary" onClick={() => router.back()}>
          ← Retour
        </button>
      </div>

      {/* Infos */}
      <div className="grid md:grid-cols-2 gap-4">
        <div className="rounded-lg border bg-white p-4 space-y-2">
          <h2 className="text-sm font-semibold text-gray-700">Coordonnées</h2>
          <div>
            <span className="text-gray-500">Adresse :</span> {bene.address}
          </div>
          <div>
            <span className="text-gray-500">Ville :</span> {bene.city ?? "—"}
          </div>
          <div>
            <span className="text-gray-500">CP :</span> {bene.postal_code ?? "—"}
          </div>
          <div>
            <span className="text-gray-500">Téléphone :</span>{" "}
            {bene.phone ? (
              <a
                href={`tel:${bene.phone.replace(/\s+/g, "")}`}
                className="text-blue-700 hover:underline"
              >
                {bene.phone}
              </a>
            ) : (
              "—"
            )}
          </div>
          {mapsHref && (
            <div>
              <a
                href={mapsHref}
                target="_blank"
                className="text-blue-700 hover:underline"
              >
                Voir l’itinéraire
              </a>
            </div>
          )}
        </div>

        <div className="rounded-lg border bg-white p-4 space-y-2">
          <h2 className="text-sm font-semibold text-gray-700">Statut</h2>
          <div>Actif : {bene.is_active ? "Oui" : "Non"}</div>
          <div>
            <Link href="/beneficiaires" className="text-blue-700 hover:underline">
              Voir la liste des protégés
            </Link>
          </div>
        </div>
      </div>

      {/* Missions liées */}
      <div className="rounded-lg border bg-white">
        <div className="p-4 border-b">
          <h2 className="text-sm font-semibold text-gray-700">Missions</h2>
        </div>
        <div className="p-4 overflow-x-auto">
          {missions.length === 0 ? (
            <div className="text-gray-500 text-sm">Aucune mission.</div>
          ) : (
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500">
                  <th className="py-2">Créée le</th>
                  <th className="py-2">Catégories</th>
                  <th className="py-2">Statut</th>
                </tr>
              </thead>
              <tbody>
                {missions
                  .slice()
                  .sort(
                    (a, b) =>
                      new Date(b.created_at ?? 0).getTime() -
                      new Date(a.created_at ?? 0).getTime()
                  )
                  .map((m) => {
                    const cats = m.categories?.length
                      ? m.categories
                      : m.category
                      ? [m.category]
                      : [];
                    const date = m.created_at
                      ? new Date(m.created_at).toLocaleString("fr-FR")
                      : "—";
                    return (
                      <tr key={m.id} className="border-t">
                        <td className="py-2">{date}</td>
                        <td className="py-2">
                          <div className="flex flex-wrap gap-1">
                            {cats.map((c) => (
                              <span
                                key={c}
                                className="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-xs"
                              >
                                {CAT_FR[c] ?? c}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="py-2">{m.status}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Factures liées (résumé) */}
      <div className="rounded-lg border bg-white">
        <div className="p-4 border-b">
          <h2 className="text-sm font-semibold text-gray-700">Factures</h2>
        </div>
        <div className="p-4 overflow-x-auto">
          {invoices.length === 0 ? (
            <div className="text-gray-500 text-sm">Aucune facture.</div>
          ) : (
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500">
                  <th className="py-2">Date</th>
                  <th className="py-2">Montant</th>
                  <th className="py-2">Statut</th>
                </tr>
              </thead>
              <tbody>
                {invoices
                  .slice()
                  .sort(
                    (a, b) =>
                      new Date(b.created_at ?? 0).getTime() -
                      new Date(a.created_at ?? 0).getTime()
                  )
                  .map((inv) => (
                    <tr key={inv.id} className="border-t">
                      <td className="py-2">
                        {inv.created_at
                          ? new Date(inv.created_at).toLocaleDateString("fr-FR")
                          : "—"}
                      </td>
                      <td className="py-2">{(inv.amount ?? 0).toFixed(2)} €</td>
                      <td className="py-2">{inv.status}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
