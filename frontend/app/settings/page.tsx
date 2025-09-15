"use client";

import { useState } from "react";

export default function SettingsPage() {
  const [email, setEmail] = useState("mjpm@example.com");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setMessage("✅ Paramètres sauvegardés !");
  };

  return (
    <div className="p-6 max-w-xl mx-auto space-y-6">
      <h1 className="text-3xl font-bold">⚙️ Paramètres du compte</h1>

      {message && (
        <div className="bg-green-100 text-green-700 p-2 rounded">{message}</div>
      )}

      <form onSubmit={handleSave} className="space-y-4">
        {/* Email */}
        <div>
          <label className="block text-sm font-medium">Adresse email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 block w-full border rounded p-2"
          />
        </div>

        {/* Mot de passe */}
        <div>
          <label className="block text-sm font-medium">Nouveau mot de passe</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 block w-full border rounded p-2"
            placeholder="Laissez vide si inchangé"
          />
        </div>

        {/* Bouton */}
        <div className="text-right">
          <button
            type="submit"
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
          >
            Sauvegarder
          </button>
        </div>
      </form>
    </div>
  );
}
