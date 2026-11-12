"use client";

import { useState, type FormEvent } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Part { name: string; bytes: number; url: string }

const megabytes = (bytes: number) => `${Math.max(0.1, bytes / 1024 / 1024).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} Mo`;

/** DATA-02 — formulaire du code, puis liens de téléchargement (valables 10 minutes, rouvrir avec le code ensuite). */
export function ExportDownloadForm({ token }: { token: string }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parts, setParts] = useState<Part[] | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/export/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = (await response.json().catch(() => null)) as { parts?: Part[]; error?: string } | null;
      if (response.ok && data?.parts) setParts(data.parts);
      else setError(data?.error ?? "Service momentanément indisponible.");
    } catch {
      setError("Connexion impossible. Vérifiez votre réseau puis réessayez.");
    } finally {
      setBusy(false);
    }
  }

  if (parts) {
    return (
      <Card>
        <CardContent className="space-y-4 pt-6">
          <p className="text-sm">
            {parts.length > 1 ? `Votre export est en ${parts.length} fichiers : téléchargez-les tous.` : "Votre export est prêt."}
            {" "}Ces boutons marchent 10 minutes ; ensuite, saisissez à nouveau le code.
          </p>
          <ul className="space-y-2">
            {parts.map((part) => (
              <li key={part.name}>
                <Button asChild variant="outline" className="w-full justify-between">
                  <a href={part.url} download={part.name} rel="noreferrer">
                    <span className="flex items-center gap-2"><Download className="size-4" aria-hidden />{part.name}</span>
                    <span className="text-muted-foreground">{megabytes(part.bytes)}</span>
                  </a>
                </Button>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">Ouvrez le fichier LISEZMOI.txt : il explique le contenu. Ces fichiers contiennent des données personnelles.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="export-code">Code à 8 caractères</Label>
            <Input
              id="export-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              autoComplete="one-time-code"
              autoCapitalize="characters"
              spellCheck={false}
              placeholder="ABCD-EFGH"
              maxLength={20}
              required
              error={Boolean(error)}
              aria-describedby={error ? "export-error" : undefined}
            />
          </div>
          {error && <p id="export-error" role="alert" className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={busy || code.trim().length < 8}>
            {busy ? "Vérification…" : "Afficher mes fichiers"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
