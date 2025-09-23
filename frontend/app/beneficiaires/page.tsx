"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { listBeneficiaries } from "@/lib/api";
import type { Beneficiary } from "@/lib/types";

export default function BeneficiairesPage() {
  const [items, setItems] = useState<Beneficiary[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    listBeneficiaries()
      .then(setItems)
      .catch((e) => setErr(e.message || "Erreur"))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl sm:text-2xl font-semibold">Protégés</h1>
        <Link href="/beneficiaires/new" className="btn-primary">
          Nouveau protégé
        </Link>
      </div>

      {loading && (
        <div className="card">
          <div className="card-body">Chargement…</div>
        </div>
      )}
      {err && (
        <div className="card">
          <div className="card-body text-red-600">{err}</div>
        </div>
      )}

      {!loading && !err && (
        <div className="card">
          <div className="card-body overflow-x-auto">
            {items.length === 0 ? (
              <div className="text-gray-500">Aucun protégé.</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500">
                    <th className="py-2">Photo</th>
                    <th className="py-2">Nom</th>
                    <th className="py-2">Téléphone</th>
                    <th className="py-2 hidden sm:table-cell">Adresse</th>
                    <th className="py-2 hidden md:table-cell">Ville</th>
                    <th className="py-2 hidden md:table-cell">CP</th>
                    <th className="py-2 hidden lg:table-cell">ID</th>
                    <th className="py-2 text-right">Profil</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((b) => (
                    <tr key={b.id} className="border-t hover:bg-gray-50">
                      {/* Photo (téléchargeable) */}
                      <td className="py-2">
                        {b.photo_url ? (
                          <a
                            href={b.photo_url}
                            target="_blank"
                            rel="noreferrer"
                            download
                            title="Télécharger la photo"
                            className="inline-block"
                          >
                            <img
                              src={b.photo_url}
                              alt={`${b.first_name} ${b.last_name}`}
                              className="h-10 w-10 rounded-full object-cover border"
                            />
                          </a>
                        ) : (
                          <div className="h-10 w-10 rounded-full bg-gray-200 grid place-items-center text-xs text-gray-600">
                            —
                          </div>
                        )}
                      </td>

                      {/* Nom → lien vers la fiche */}
                      <td className="py-2">
                        <Link
                          href={`/beneficiaires/${b.id}`}
                          className="font-medium text-blue-700 hover:underline focus:outline-none focus:ring-2 focus:ring-blue-400 rounded px-0.5"
                          title="Ouvrir le profil"
                        >
                          {b.last_name?.toUpperCase()} {b.first_name}
                        </Link>
                      </td>

                      {/* Téléphone (clic tel:) */}
                      <td className="py-2">
                        {b.phone ? (
                          <a
                            href={`tel:${b.phone.replace(/\s+/g, "")}`}
                            className="text-blue-600 hover:underline"
                          >
                            {b.phone}
                          </a>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>

                      {/* Adresse */}
                      <td className="py-2 hidden sm:table-cell">
                        {b.address || <span className="text-gray-400">—</span>}
                      </td>

                      {/* Ville */}
                      <td className="py-2 hidden md:table-cell">
                        {b.city || <span className="text-gray-400">—</span>}
                      </td>

                      {/* CP */}
                      <td className="py-2 hidden md:table-cell">
                        {b.postal_code || <span className="text-gray-400">—</span>}
                      </td>

                      {/* ID */}
                      <td className="py-2 hidden lg:table-cell font-mono">
                        {String(b.id)}
                      </td>

                      {/* CTA Profil explicite */}
                      <td className="py-2 text-right">
                        <Link
                          href={`/beneficiaires/${b.id}`}
                          className="inline-flex items-center gap-1 text-sm text-blue-700 hover:underline focus:outline-none focus:ring-2 focus:ring-blue-400 rounded px-1"
                          title="Voir le profil"
                        >
                          Voir
                          <span aria-hidden>↗</span>
                          <span className="sr-only">
                            Ouvrir le profil de {b.first_name} {b.last_name}
                          </span>
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
