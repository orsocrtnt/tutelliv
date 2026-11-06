"use client";

import { useEffect } from "react";
import { DEMO_EXPIRED_PATH } from "@/lib/demo/constants";

const HEARTBEAT_MS = 60_000;

/**
 * Pendant une démo, signale chaque minute que l'onglet est ouvert et visible (compteur « en direct » du super admin).
 * Si le serveur répond que l'espace n'existe plus (410), l'onglet part vers /demonstration.
 */
export function useDemoHeartbeat(active: boolean) {
  useEffect(() => {
    if (!active) return;
    let left = false;
    const beat = () => {
      if (left || document.visibilityState !== "visible") return;
      fetch("/api/demo/heartbeat", { method: "POST", keepalive: true })
        .then((res) => {
          if (res.status !== 410 || left) return;
          left = true;
          window.location.assign(DEMO_EXPIRED_PATH);
        })
        .catch(() => {});
    };
    beat();
    const timer = window.setInterval(beat, HEARTBEAT_MS);
    document.addEventListener("visibilitychange", beat);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", beat);
    };
  }, [active]);
}
