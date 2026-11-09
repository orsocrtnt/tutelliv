"use client";

import { useState } from "react";
import { AlertTriangle, ScrollText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAdminAccessEvents } from "@/features/admin/hooks";
import { Badge } from "@/components/ui/badge";
import { ROLE_LABELS_SINGULAR } from "@/features/admin/company/company-file-format";
import { isInitialQueryLoading } from "@/lib/query/is-initial-loading";

/** Pages de la console, en clair (AUDIT-0411 : plus de codes bruts à l'écran). */
const RESOURCES = [
  { value: "OVERVIEW", label: "Tableau de bord" },
  { value: "SAAS_HEALTH", label: "Détail SaaS" },
  { value: "SERVICE_HEALTH", label: "Santé des services" },
  { value: "COMPANIES", label: "Entreprises" },
  { value: "COMPANY_DETAIL", label: "Fiche entreprise" },
  { value: "USERS", label: "Utilisateurs" },
  { value: "SUBSCRIPTIONS", label: "Souscriptions" },
  { value: "SUPPORT_TICKETS", label: "Support plateforme" },
  { value: "OPERATION_JOBS", label: "Exploitation" },
  { value: "INCIDENTS", label: "Incidents" },
  { value: "ACCESS_EVENTS", label: "Journal d'accès" },
  { value: "CONTACT_MESSAGES", label: "Messages Contact" },
  { value: "SALES_CODES", label: "Codes commerciaux" },
  { value: "SALES_COMMISSIONS", label: "Commissions commerciales" },
  { value: "PROSPECT_CAMPAIGNS", label: "Campagnes de prospection" },
] as const;

const DECISIONS = [
  { value: "ALLOWED", label: "Autorisé" },
  { value: "DENIED", label: "Refusé" },
] as const;

const resourceLabel: Record<string, string> = Object.fromEntries(RESOURCES.map((item) => [item.value, item.label]));
const decisionLabel: Record<string, string> = Object.fromEntries(DECISIONS.map((item) => [item.value, item.label]));
const dateFormat = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Paris" });

export default function AdminAccessEventsPage() {
  const [resource, setResource] = useState("");
  const [decision, setDecision] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const { data, isLoading, error } = useAdminAccessEvents({ resource, decision, page, pageSize });

  if (isInitialQueryLoading(isLoading, data)) return <PageSkeleton />;

  if (error || !data) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="Journal indisponible"
        description="Impossible de charger le journal des accès plateforme."
      />
    );
  }

  const pageCount = Math.max(1, Math.ceil(data.total / data.pageSize));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{"Journal d'accès"}</h1>
        <p className="mt-1 text-sm text-muted-foreground max-md:hidden">
          {"Lecture seule. Qui a ouvert quelle page de la console, et si l’accès a été autorisé. Heures de Paris ; entrées gardées 90 jours."}
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-sm">
          Page
          <Select value={resource || "ALL"} onValueChange={(value) => { setResource(value === "ALL" ? "" : value); setPage(1); }}>
            <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Toutes</SelectItem>
              {RESOURCES.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </label>
        <label className="grid gap-1 text-sm">
          Décision
          <Select value={decision || "ALL"} onValueChange={(value) => { setDecision(value === "ALL" ? "" : value); setPage(1); }}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Toutes</SelectItem>
              {DECISIONS.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </label>
      </div>

      {data.total === 0 ? (
        <EmptyState icon={ScrollText} title="Aucun accès journalisé" description="Aucune entrée ne correspond à ces filtres." />
      ) : (
        <Table surface>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Qui</TableHead>
              <TableHead>Rôle</TableHead>
              <TableHead>Page</TableHead>
              <TableHead>Décision</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="whitespace-nowrap">{dateFormat.format(new Date(row.occurredAt))}</TableCell>
                <TableCell className="font-medium">{row.actorName ?? "Compte supprimé"}</TableCell>
                <TableCell>{ROLE_LABELS_SINGULAR[row.role] ?? "Rôle inconnu"}</TableCell>
                <TableCell>{resourceLabel[row.resource] ?? "Page inconnue"}</TableCell>
                <TableCell>
                  <Badge variant={row.decision === "DENIED" ? "destructive" : "secondary"}>{decisionLabel[row.decision] ?? "Inconnue"}</Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <div className={data.total === 0 ? "hidden" : "flex flex-wrap items-center justify-between gap-3"}>
        <label className="flex items-center gap-2 text-sm">
          Lignes
          <Select value={String(pageSize)} onValueChange={(value) => { setPageSize(Number(value)); setPage(1); }}>
            <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="25">25</SelectItem>
              <SelectItem value="50">50</SelectItem>
              <SelectItem value="100">100</SelectItem>
            </SelectContent>
          </Select>
        </label>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>Précédent</Button>
          <span className="text-sm text-muted-foreground">Page {page} / {pageCount}</span>
          <Button type="button" variant="outline" disabled={page >= pageCount} onClick={() => setPage((current) => current + 1)}>Suivant</Button>
        </div>
      </div>
    </div>
  );
}
