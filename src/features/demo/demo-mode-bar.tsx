"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Building2,
  CheckCircle2,
  ChevronLeft,
  Circle,
  FlaskConical,
  ListChecks,
  RotateCcw,
  Truck,
  UserRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuthStore } from "@/stores/auth.store";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useDemoHeartbeat } from "@/features/demo/use-demo-heartbeat";
import { markDemoChecklistStep, resetDemoChecklist } from "@/features/demo/demo-checklist";
import {
  DEMO_CHECKLIST_EVENT,
  DEMO_CHECKLIST_STEPS,
  demoChecklistStepForPath,
  readDemoChecklist,
  type DemoChecklistStepId,
} from "@/lib/demo/demo-checklist";
import {
  DEMO_PERSONA_LABELS,
  type DemoPersona,
} from "@/lib/demo/constants";

const DEMO_BANNER_APP_PREFIXES = [
  "/admin",
  "/dashboard",
  "/dispatch",
  "/driver",
  "/portal",
  "/settings",
  "/users",
  "/companies",
] as const;

const PERSONA_ICONS: Record<DemoPersona, typeof Building2> = {
  admin: Building2,
  client: UserRound,
  driver: Truck,
};

const COLLAPSED_STORAGE_KEY = "tutelliv-demo-bar-collapsed";

function isDemoAppArea(pathname: string): boolean {
  return DEMO_BANNER_APP_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

export function DemoModeBar() {
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const { demo, setUser, setPermissions, setDemo, setSaas } = useAuthStore();
  const [switching, setSwitching] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [doneSteps, setDoneSteps] = useState<DemoChecklistStepId[]>([]);
  const barRef = useRef<HTMLDivElement>(null);

  const visible = Boolean(demo?.isDemo) && isDemoAppArea(pathname);
  useDemoHeartbeat(Boolean(demo?.isDemo));

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSED_STORAGE_KEY) === "1");
    } catch {
      /* ignore */
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    const refresh = (event?: Event) => {
      try {
        setDoneSteps(readDemoChecklist(window.sessionStorage));
      } catch {
        setDoneSteps([]);
      }
      const id = (event as CustomEvent<{ id?: DemoChecklistStepId }> | undefined)?.detail?.id;
      const step = DEMO_CHECKLIST_STEPS.find((candidate) => candidate.id === id);
      if (step) toast.success(`Étape faite : ${step.label.toLowerCase()}`);
    };
    refresh();
    window.addEventListener(DEMO_CHECKLIST_EVENT, refresh);
    return () => window.removeEventListener(DEMO_CHECKLIST_EVENT, refresh);
  }, []);

  // Carte des livraisons ou détail d'une facture ouverts : l'étape se coche à l'arrivée sur la page.
  useEffect(() => {
    if (!demo?.isDemo) return;
    const step = demoChecklistStepForPath(pathname);
    if (step) markDemoChecklistStep(step);
  }, [demo?.isDemo, demo?.persona, pathname]);

  const persistCollapsed = useCallback((next: boolean) => {
    setCollapsed(next);
    try {
      localStorage.setItem(COLLAPSED_STORAGE_KEY, next ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (!visible) return;
    const root = document.documentElement;
    const applyHeight = () => {
      const height = collapsed ? 0 : (barRef.current?.offsetHeight ?? 0);
      root.style.setProperty("--demo-banner-height", `${height}px`);
      if (height > 0) root.setAttribute("data-demo-banner", "");
      else root.removeAttribute("data-demo-banner");
    };
    applyHeight();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(applyHeight);
    if (!collapsed && barRef.current) observer?.observe(barRef.current);
    return () => {
      observer?.disconnect();
      root.style.removeProperty("--demo-banner-height");
      root.removeAttribute("data-demo-banner");
    };
  }, [visible, collapsed, hydrated]);

  const switchPersona = useCallback(
    async (persona: DemoPersona, target?: string) => {
      if (!demo || persona === demo.persona) return;
      setSwitching(true);
      try {
        const res = await fetch("/api/demo/persona", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ persona }),
        });
        const json = await res.json();
        if (res.status === 409 && json.redirectTo) {
          window.location.assign(json.redirectTo);
          return;
        }
        if (!res.ok) {
          throw new Error(json.error ?? "Impossible de changer de vue");
        }
        setSaas(json.saas ?? null);
        setPermissions(json.permissions ?? []);
        setDemo(json.demo ?? null);
        setUser(json.user);
        await queryClient.clear();
        queryClient.setQueryData(["session"], {
          user: json.user,
          permissions: json.permissions ?? [],
          demo: json.demo ?? null,
          saas: json.saas ?? null,
        });
        // Chargement complet : le cache du routeur ne réaffiche aucune page de l'ancienne persona,
        // et l'espace de la nouvelle persona repasse par la garde serveur (AUTH-ROLE).
        window.location.assign(target ?? json.redirectTo);
        toast.success(`Vue ${DEMO_PERSONA_LABELS[persona]} activée`);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Erreur de changement de vue");
      } finally {
        setSwitching(false);
      }
    },
    [demo, queryClient, setDemo, setPermissions, setSaas, setUser]
  );

  const resetDemo = useCallback(async () => {
    setResetting(true);
    try {
      const res = await fetch("/api/demo/reset", { method: "POST" });
      const json = await res.json();
      if (res.status === 409 && json.redirectTo) {
        window.location.assign(json.redirectTo);
        return;
      }
      if (!res.ok) {
        throw new Error(json.error ?? "Impossible de réinitialiser la démo");
      }
      setSaas(json.saas ?? null);
      setPermissions(json.permissions ?? []);
      setDemo(json.demo ?? null);
      setUser(json.user);
      await queryClient.clear();
      queryClient.setQueryData(["session"], {
        user: json.user,
        permissions: json.permissions ?? [],
        demo: json.demo ?? null,
        saas: json.saas ?? null,
      });
      setResetOpen(false);
      resetDemoChecklist();
      window.location.assign(json.redirectTo ?? "/dashboard");
      toast.success("Démo réinitialisée — scénario de base restauré");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erreur lors de la réinitialisation");
    } finally {
      setResetting(false);
    }
  }, [queryClient, setDemo, setPermissions, setSaas, setUser]);

  if (!visible || !demo || !hydrated) return null;

  const ActiveIcon = PERSONA_ICONS[demo.persona];
  const doneCount = doneSteps.length;
  const allDone = doneCount === DEMO_CHECKLIST_STEPS.length;
  const openStep = (step: (typeof DEMO_CHECKLIST_STEPS)[number]) => {
    if (step.persona === demo.persona) window.location.assign(step.path);
    else void switchPersona(step.persona, step.path);
  };

  return (
    <>
      {collapsed ? (
        <button
          type="button"
          onClick={() => persistCollapsed(false)}
          className="fixed left-0 top-[max(0.5rem,env(safe-area-inset-top))] z-[2000] flex items-center gap-1.5 rounded-r-xl border border-l-0 border-amber-200/80 bg-amber-50/95 px-1.5 py-3 shadow-md backdrop-blur-md transition-colors hover:bg-amber-100 dark:border-amber-900/50 dark:bg-amber-950/90 dark:hover:bg-amber-900"
          aria-label="Afficher la barre de démonstration"
          title="Afficher la barre de démonstration"
        >
          <FlaskConical className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
          <span className="text-[11px] font-medium tracking-wide text-amber-950 [writing-mode:vertical-rl] rotate-180 dark:text-amber-100">
            Démo
          </span>
        </button>
      ) : (
        <>
          <div
            ref={barRef}
            role="region"
            aria-label="Environnement de démonstration"
            className="fixed inset-x-0 top-0 z-[2000] border-b border-amber-200/80 bg-amber-50/95 px-3 py-2 backdrop-blur-md dark:border-amber-900/50 dark:bg-amber-950/90"
          >
            <div className="mx-auto flex max-w-7xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              {/* Téléphone : une seule ligne, le nom de la zone reste lu par `aria-label`. */}
              <div className="hidden min-w-0 items-center gap-2 text-sm sm:flex text-amber-950 dark:text-amber-100">
                <FlaskConical className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
                <span className="font-medium">Environnement de démonstration</span>
                <span className="hidden text-amber-800 sm:inline dark:text-amber-200">
                  — données fictives dans votre session isolée
                </span>
              </div>

              <div className="flex items-center gap-2 sm:flex-wrap">
                <FlaskConical className="h-4 w-4 shrink-0 text-amber-600 sm:hidden dark:text-amber-400" aria-hidden />
                <div className="flex min-w-0 flex-1 items-center gap-2 sm:flex-none">
                  <ActiveIcon className="hidden h-4 w-4 text-amber-700 sm:block dark:text-amber-300" />
                  <Select
                    value={demo.persona}
                    onValueChange={(value) => void switchPersona(value as DemoPersona)}
                    disabled={switching || resetting}
                  >
                    <SelectTrigger aria-label="Changer de vue de démonstration" className="h-9 w-full border-amber-200 sm:w-[180px] bg-white/90 dark:border-amber-800 dark:bg-amber-950">
                      <SelectValue placeholder="Changer de vue" />
                    </SelectTrigger>
                    <SelectContent className="z-[2100]">
                      {(Object.keys(DEMO_PERSONA_LABELS) as DemoPersona[]).map((persona) => {
                        const Icon = PERSONA_ICONS[persona];
                        return (
                          <SelectItem key={persona} value={persona}>
                            <span className="flex items-center gap-2">
                              <Icon className="h-4 w-4" />
                              {DEMO_PERSONA_LABELS[persona]}
                            </span>
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </div>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="border-amber-300 bg-white/90 hover:bg-amber-100 max-sm:min-w-11 dark:border-amber-800 dark:bg-amber-950 dark:hover:bg-amber-900"
                      disabled={switching || resetting}
                      aria-label={`À essayer : ${doneCount} étapes faites sur ${DEMO_CHECKLIST_STEPS.length}`}
                    >
                      <ListChecks className="h-4 w-4" aria-hidden />
                      <span className="max-sm:sr-only">À essayer</span>
                      <span className="tabular-nums" aria-hidden>
                        {doneCount}/{DEMO_CHECKLIST_STEPS.length}
                      </span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="z-[2100] w-[min(20rem,calc(100vw-1.5rem))]">
                    <DropdownMenuLabel>À essayer dans la démo</DropdownMenuLabel>
                    {DEMO_CHECKLIST_STEPS.map((step) => {
                      const done = doneSteps.includes(step.id);
                      const StepIcon = done ? CheckCircle2 : Circle;
                      return (
                        <DropdownMenuItem
                          key={step.id}
                          className="min-h-11 items-start gap-2.5 py-2"
                          onSelect={() => openStep(step)}
                        >
                          <StepIcon
                            className={done ? "mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" : "mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"}
                            aria-hidden
                          />
                          <span className="flex min-w-0 flex-col">
                            <span className={done ? "text-muted-foreground line-through" : undefined}>{step.label}</span>
                            <span className="text-xs text-muted-foreground">
                              Vue {DEMO_PERSONA_LABELS[step.persona]}
                              {done ? " · fait" : ""}
                            </span>
                          </span>
                        </DropdownMenuItem>
                      );
                    })}
                    {allDone ? (
                      <>
                        <DropdownMenuSeparator />
                        <p className="px-2 py-1.5 text-sm font-medium">Vous avez fait le tour.</p>
                        <DropdownMenuItem asChild className="min-h-11 font-medium text-primary">
                          <a href="/contact">Demander un pilote</a>
                        </DropdownMenuItem>
                      </>
                    ) : null}
                  </DropdownMenuContent>
                </DropdownMenu>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="border-amber-300 bg-white/90 hover:bg-amber-100 max-sm:min-w-11 dark:border-amber-800 dark:bg-amber-950 dark:hover:bg-amber-900"
                  onClick={() => setResetOpen(true)}
                  disabled={switching || resetting}
                >
                  <RotateCcw className="h-4 w-4" />
                  <span className="max-sm:sr-only">Réinitialiser la démo</span>
                </Button>

                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-amber-900 hover:bg-amber-100 max-md:min-w-11 dark:text-amber-100 dark:hover:bg-amber-900"
                  onClick={() => persistCollapsed(true)}
                  aria-label="Réduire la barre de démonstration"
                  title="Réduire sur le côté"
                >
                  <ChevronLeft className="h-4 w-4" />
                  <span className="hidden sm:inline">Réduire</span>
                </Button>
              </div>
            </div>
          </div>
          <div className="shrink-0" style={{ height: "var(--demo-banner-height, 0px)" }} aria-hidden />
        </>
      )}

      <Dialog open={resetOpen} onOpenChange={setResetOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Réinitialiser la démonstration ?</DialogTitle>
            <DialogDescription>
              Seules les commandes, livraisons, factures et tickets de votre session seront
              supprimés. Les autres démonstrations ne seront pas modifiées. La journée type est
              recréée à l&apos;heure actuelle.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetOpen(false)} disabled={resetting}>
              Annuler
            </Button>
            <Button variant="brand" onClick={() => void resetDemo()} loading={resetting}>
              Réinitialiser
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
