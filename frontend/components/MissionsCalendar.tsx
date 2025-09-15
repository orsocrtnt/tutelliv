"use client";

import React, { useMemo } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import frLocale from "@fullcalendar/core/locales/fr";
import { useRouter } from "next/navigation";
import type { Mission, Beneficiary } from "@/lib/types";

type Props = {
  missions: Mission[];
  beneficiaries: Beneficiary[];
  role: "mjpm" | "deliverer";
};

const STATUS_COLORS: Record<string, string> = {
  pending: "#F59E0B",     // amber-500
  in_progress: "#3B82F6", // blue-500
  delivered: "#10B981",   // emerald-500
  default: "#6B7280",     // gray-500
};

const CAT_FR: Record<string, string> = {
  FOOD: "Alimentaire",
  HYGIENE: "Hygiène",
  TOBACCO_MANDATE: "Tabac (mandat)",
  CASH_DELIVERY: "Livraison espèces",
  OTHER: "Autre",
};

function getCats(m: Mission): string[] {
  if (m.categories?.length) return m.categories;
  if (m.category) return [m.category];
  return [];
}

export default function MissionsCalendar({ missions, beneficiaries, role }: Props) {
  const router = useRouter();

  const beneMap = useMemo(() => {
    const m = new Map<number, Beneficiary>();
    for (const b of beneficiaries) m.set(Number(b.id), b);
    return m;
  }, [beneficiaries]);

  const events = useMemo(() => {
    return missions.map((m) => {
      const b = beneMap.get(Number(m.beneficiary_id));
      const fullname = b
        ? `${(b.last_name || "").toUpperCase()} ${b.first_name || ""}`.trim()
        : `ID ${m.beneficiary_id}`;

      const cats = getCats(m);
      const catsLabel =
        cats.length > 0
          ? cats.map((c) => CAT_FR[c] ?? c).join(", ")
          : "Sans catégorie";

      const startISO = m.calendar_start ?? m.created_at ?? new Date().toISOString();
      const endISO =
        m.calendar_end ??
        new Date(new Date(startISO).setDate(new Date(startISO).getDate() + 1)).toISOString(); // fallback 1j

      const color = STATUS_COLORS[m.status] ?? STATUS_COLORS.default;

      // Un SEUL événement all-day CONTINU par mission (relie les jours et traverse visuellement le weekend)
      return {
        id: m.id,
        title: `${fullname} — ${catsLabel}`,
        start: startISO,
        end: endISO,    // exclusif
        allDay: true,
        color,
        extendedProps: {
          status: m.status,
          beneficiary: fullname,
          categories: catsLabel,
        },
      };
    });
  }, [missions, beneMap]);

  function handleEventClick(info: any) {
    const id: string = String(info?.event?.id || "");
    if (!id) return;
    const status = info?.event?.extendedProps?.status;
    if (status === "pending") router.push(`/missions/${id}/edit`);
    else router.push(`/missions`);
  }

  function renderEventContent(arg: any) {
    return {
      html: `
        <div style="display:flex;align-items:center;gap:6px;">
          <span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${arg.backgroundColor || arg.borderColor || "#999"}"></span>
          <span>${arg.event.title}</span>
        </div>
      `,
    };
  }

  return (
    <div className="rounded-xl border bg-white p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold">
          Calendrier des missions {role === "deliverer" ? "– Livreur" : "– MJPM"}
        </h2>
        <div className="flex items-center gap-3 text-xs">
          <span className="inline-flex items-center gap-1">
            <i className="inline-block h-3 w-3 rounded-sm" style={{ background: STATUS_COLORS.pending }}></i> En attente
          </span>
          <span className="inline-flex items-center gap-1">
            <i className="inline-block h-3 w-3 rounded-sm" style={{ background: STATUS_COLORS.in_progress }}></i> En cours
          </span>
          <span className="inline-flex items-center gap-1">
            <i className="inline-block h-3 w-3 rounded-sm" style={{ background: STATUS_COLORS.delivered }}></i> Livrée
          </span>
        </div>
      </div>

      <FullCalendar
        plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
        initialView="dayGridMonth"
        headerToolbar={{
          left: "prev,next today",
          center: "title",
          right: "dayGridMonth,timeGridWeek,timeGridDay",
        }}

        /* —— VISIBILITÉ COMPLETE DES ALL-DAY —— */
        height="auto"
        expandRows={true}
        allDaySlot={true}
        dayMaxEvents={false}     // pas de +N en mois/sem/jour
        eventMaxStack={999}      // empile autant que nécessaire

        /* tu peux garder un petit cap en vue mois si tu veux :
        views={{
          dayGridMonth: { dayMaxEvents: 4 },       // 4 max en mois (sinon false pour illimité)
          timeGridWeek: { dayMaxEvents: false, eventMaxStack: 999 },
          timeGridDay:  { dayMaxEvents: false, eventMaxStack: 999 },
        }}
        */

        locale={frLocale}
        events={events}
        eventClick={handleEventClick}
        eventContent={renderEventContent}

        // Laisse les week-ends visibles pour voir la continuité.
        // hiddenDays={[0, 6]}

        eventDidMount={(info) => {
          if (info.el) {
            info.el.style.whiteSpace = "normal";
            info.el.style.lineHeight = "1.2";
            info.el.style.padding = "2px 6px";
            info.el.style.borderRadius = "6px";
          }
        }}
      />
    </div>
  );
}
