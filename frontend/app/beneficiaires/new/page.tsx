"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createBeneficiary } from "@/lib/api";

type FormState = {
  first_name: string;
  last_name: string;
  address: string;
  city: string;
  postal_code: string;
  phone: string;
  photo_url: string;
  is_active: boolean;
};

export default function NewBeneficiaryPage() {
  const router = useRouter();
  const [form, setForm] = useState<FormState>({
    first_name: "",
    last_name: "",
    address: "",
    city: "",
    postal_code: "",
    phone: "",
    photo_url: "",
    is_active: true,
  });

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [localFileName, setLocalFileName] = useState<string>("");

  function onChange<K extends keyof FormState>(k: K) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));
  }

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setLocalFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || "");
      setForm((f) => ({ ...f, photo_url: dataUrl }));
    };
    reader.readAsDataURL(file);
  }

  const photoPreview = useMemo(() => form.photo_url || "", [form.photo_url]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await createBeneficiary({
        id: Date.now(),
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        address: form.address.trim(),
        city: form.city.trim() || null,
        postal_code: form.postal_code.trim() || null,
        phone: form.phone.trim() || null,
        photo_url: form.photo_url || null,
        is_active: form.is_active,
      } as any);

      router.push("/beneficiaires");
    } catch (e: any) {
      setErr(e?.message ?? "Erreur");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Nouveau protégé</h1>

      {err && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-red-700">
          {err}
        </div>
      )}

      <form onSubmit={onSubmit} className="rounded-xl border bg-white">
        <div className="p-5 grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* Colonne gauche */}
          <div className="lg:col-span-3 space-y-4">
            <section className="space-y-3">
              <h2 className="text-sm font-medium text-gray-700">Identité</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="label">Prénom</label>
                  <input
                    className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={form.first_name}
                    onChange={onChange("first_name")}
                    required
                  />
                </div>
                <div>
                  <label className="label">Nom</label>
                  <input
                    className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={form.last_name}
                    onChange={onChange("last_name")}
                    required
                  />
                </div>
              </div>
            </section>

            <section className="space-y-3">
              <h2 className="text-sm font-medium text-gray-700">Coordonnées</h2>
              <div>
                <label className="label">Adresse</label>
                <input
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={form.address}
                  onChange={onChange("address")}
                  required
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="md:col-span-2">
                  <label className="label">Ville</label>
                  <input
                    className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={form.city}
                    onChange={onChange("city")}
                  />
                </div>
                <div>
                  <label className="label">CP</label>
                  <input
                    className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={form.postal_code}
                    onChange={onChange("postal_code")}
                    placeholder="ex : 13001"
                  />
                </div>
              </div>
              <div>
                <label className="label">Téléphone (optionnel)</label>
                <input
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={form.phone}
                  onChange={onChange("phone")}
                  inputMode="tel"
                  placeholder="+33 6 12 34 56 78"
                />
              </div>
            </section>

            <div className="flex items-center gap-2 pt-2">
              <input
                id="is_active"
                type="checkbox"
                checked={form.is_active}
                onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
              />
              <label htmlFor="is_active" className="label">
                Actif
              </label>
            </div>
          </div>

          {/* Colonne droite : Photo */}
          <div className="lg:col-span-2">
            <section className="space-y-4 rounded-lg border p-4">
              <h2 className="text-sm font-medium text-gray-700">Photo</h2>

              <div className="flex items-center gap-4">
                <div className="h-24 w-24 rounded-full bg-gray-100 border overflow-hidden">
                  {photoPreview ? (
                    <img
                      src={photoPreview}
                      alt="Aperçu"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="h-full w-full grid place-items-center text-gray-400 text-xs">
                      Aperçu
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <label className="label">Importer un fichier</label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={onPickFile}
                  className="block w-full text-sm text-gray-600"
                />
              </div>

              <div>
                <label className="label">Ou URL de la photo</label>
                <input
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="https://…"
                  value={form.photo_url}
                  onChange={onChange("photo_url")}
                />
              </div>
            </section>
          </div>
        </div>

        <div className="px-5 pb-5 flex gap-3">
          <button className="btn btn-primary" disabled={busy}>
            {busy ? "Enregistrement..." : "Créer"}
          </button>
          <a href="/beneficiaires" className="btn btn-secondary">
            Annuler
          </a>
        </div>
      </form>
    </div>
  );
}
