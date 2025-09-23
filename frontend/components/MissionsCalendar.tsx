// frontend/components/MissionsCalendar.tsx
"use client";

import { useMemo, useEffect, useState, useCallback } from "react";
import dynamic from "next/dynamic";
import type { Mission, Beneficiary } from "@/lib/types";

// 🔹 On charge uniquement le composant React de FullCalendar en dynamic
const FullCalendar = dynamic(
  () => import("@fullcalendar/react").then((m) => m.default),
  { ssr: false }
);

// 🔹 Les plugins ne sont pas des composants → imports normaux
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import listPlugin from "@fullcalendar/list";

type Props = {
  missions: Mission[];
  beneficiaries: Beneficiary[];
  role: "mjpm" | "deliverer";
};

const CAT_FR: Record<string, string> = {
  FOOD: "Alimentaire",
  HYGIENE: "Hygiène",
  TOBACCO_MANDATE: "Tabac (mandat)",
  CASH_DELIVERY: "Livraison espèces",
  OTHER: "Autre",
};

const STATUS_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  pending:     { bg: "#FDE68A", border: "#F59E0B", text: "#7C2D12" },
  in_progress: { bg: "#93C5FD", border: "#3B82F6", text: "#1E3A8A" },
  delivered:   { bg: "#86EFAC", border: "#22C55E", text: "#14532D" },
};

export default function MissionsCalendar({ missions, beneficiaries }: Props) {
  // On évite tout décalage SSR/CSR
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // ✅ Détection responsive (même breakpoint que Tailwind: sm = 640px)
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 640);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const beneMap = useMemo(() => {
    const m = new Map<number, Beneficiary>();
    (beneficiaries ?? []).forEach((b) => m.set(Number(b.id), b));
    return m;
  }, [beneficiaries]);

  const events = useMemo(() => {
    return (missions ?? []).map((m) => {
      const bene = beneMap.get(Number(m.beneficiary_id));
      const who = bene
        ? `${(bene.last_name ?? "").toUpperCase()} ${bene.first_name ?? ""}`.trim()
        : `#${m.beneficiary_id}`;
      const cats = m.categories?.length ? m.categories : m.category ? [m.category] : [];
      const catsLabel = cats.map((c) => CAT_FR[c] ?? c).join(", ");
      const start = m.calendar_start ?? m.created_at;
      const end = m.calendar_end ?? m.created_at;
      const c = STATUS_COLORS[m.status] ?? STATUS_COLORS.pending;

      return {
        id: m.id,
        title: `${who} — ${catsLabel || "Mission"}`,
        start,
        end,
        allDay: true,
        backgroundColor: c.bg,
        borderColor: c.border,
        textColor: c.text,
        extendedProps: { status: m.status, beneId: m.beneficiary_id, cats },
      };
    });
  }, [missions, beneMap]);

  const eventContent = useCallback((arg: any) => {
    const title = String(arg.event.title ?? "");
    return {
      html: `<div style="padding:2px 4px; font-size:12px; line-height:1.2; overflow:hidden; text-overflow:ellipsis;">
               ${title.replace(/</g, "&lt;").replace(/>/g, "&gt;")}
             </div>`,
    };
  }, []);

  // 🔹 Header compact sur mobile, complet sur desktop
  const headerToolbar = useMemo(
    () =>
      isMobile
        ? { left: "prev,next", center: "title", right: "dayGridMonth,listWeek" }
        : { left: "prev,next today", center: "title", right: "dayGridMonth,timeGridWeek,timeGridDay,listWeek" },
    [isMobile]
  );

  // 🔹 Boutons plus courts + formats de titre adaptés
  const buttonText = useMemo(
    () =>
      isMobile
        ? { today: "Auj.", month: "Mois", week: "Liste", day: "Jour", list: "Liste" }
        : { today: "Aujourd'hui", month: "Mois", week: "Semaine", day: "Jour", list: "Liste" },
    [isMobile]
  );

  // 🔹 Options d’affichage différentes selon la taille
  const height = "auto";
  const dayMaxEventRows = isMobile ? 2 : false;
  const titleFormat = isMobile
    ? { month: "long", year: "numeric" }
    : { month: "long", year: "numeric" };

  return (
    <div className="rounded-xl border bg-white p-3">
      <div className="flex items-center justify-between pb-2">
        <h2 className="text-lg font-semibold">Calendrier des missions</h2>
        <div className="flex items-center gap-3 text-xs">
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded" style={{ background: STATUS_COLORS.pending.bg, border: `1px solid ${STATUS_COLORS.pending.border}` }} />
            En attente
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded" style={{ background: STATUS_COLORS.in_progress.bg, border: `1px solid ${STATUS_COLORS.in_progress.border}` }} />
            En cours
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded" style={{ background: STATUS_COLORS.delivered.bg, border: `1px solid ${STATUS_COLORS.delivered.border}` }} />
            Livrée
          </span>
        </div>
      </div>

      {/* On attend le montage client pour éviter les warnings/hydration */}
      {mounted && (
        <FullCalendar
          plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin, listPlugin]}
          initialView={isMobile ? "dayGridMonth" : "dayGridMonth"}
          headerToolbar={headerToolbar}
          buttonText={buttonText}
          titleFormat={titleFormat as any}
          firstDay={1}
          weekends={true}
          events={events}
          eventContent={eventContent}
          height={height}
          contentHeight="auto"
          expandRows={true}
          dayMaxEventRows={dayMaxEventRows as any}
          stickyHeaderDates={!isMobile}
          handleWindowResize={true}
          moreLinkClick="popover"
        />
      )}

      {/* 🎯 Mini CSS global pour compacter le header sur mobile */}
      <style jsx global>{`
        @media (max-width: 639px) {
          .fc .fc-toolbar {
            flex-wrap: wrap;
            gap: 6px;
          }
          .fc .fc-toolbar-title {
            font-size: 1rem; /* 16px */
          }
          .fc .fc-button {
            padding: 2px 6px;
            font-size: 12px;
            border-radius: 6px;
          }
          .fc .fc-col-header-cell-cushion {
            padding: 4px 0;
            font-size: 12px;
          }
          .fc .fc-daygrid-day-number {
            padding: 4px;
            font-size: 12px;
          }
        }
      `}</style>
    </div>
  );
}
