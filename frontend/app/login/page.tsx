"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// ✅ On passe par le proxy Next.js : /api → (rewrites) → http://192.168.1.58:8001
const API = "/api";

export default function LoginPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);

    try {
      const res = await fetch(`${API}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Si ton back lit des cookies à la connexion, garde credentials:
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });

      if (!res.ok) {
        let msg = "Identifiants invalides";
        try {
          const j = await res.json();
          if (j?.detail) msg = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail);
        } catch {}
        throw new Error(msg);
      }

      const data = (await res.json()) as {
        token: string;
        user: { role: "mjpm" | "deliverer"; [k: string]: any };
      };

      // Cookies côté front (HTTP local → pas de Secure)
      document.cookie = `tutelliv_token=${encodeURIComponent(
        data.token
      )}; path=/; max-age=${60 * 60 * 24}`;
      document.cookie = `tutelliv_role=${encodeURIComponent(
        data.user.role
      )}; path=/; max-age=${60 * 60 * 24}`;

      localStorage.setItem("tutelliv_token", data.token);

      if (data.user?.role === "deliverer") {
        router.push("/courier/dashboard");
      } else {
        router.push("/dashboard");
      }
    } catch (err: any) {
      setError(err?.message || "Erreur lors de la connexion");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-50 px-4">
      <form
        onSubmit={handleSubmit}
        className="bg-white p-6 md:p-8 rounded-xl border shadow-sm w-full max-w-md space-y-4"
      >
        <h1 className="text-2xl font-semibold text-center">Connexion</h1>

        <p className="text-xs text-gray-500 text-center">
          MJPM : <code>mjpm@example.com</code> / <code>mjpm123</code> — Livreur :{" "}
          <code>livreur@example.com</code> / <code>livreur123</code>
        </p>

        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-red-700 text-sm">
            {error}
          </div>
        )}

        <div>
          <label className="block text-sm font-medium mb-1">Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full border border-gray-300 px-3 py-2 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            required
            autoFocus
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Mot de passe</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full border border-gray-300 px-3 py-2 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            required
          />
        </div>

        <button
          type="submit"
          className="w-full btn btn-primary disabled:opacity-60"
          disabled={busy}
        >
          {busy ? "Connexion…" : "Se connecter"}
        </button>
      </form>
    </div>
  );
}
