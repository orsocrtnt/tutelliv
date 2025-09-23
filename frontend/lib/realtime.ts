// frontend/lib/realtime.ts
const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8001";

export type RealtimeMessage = {
  type: string;   // "mission.created" | "mission.updated" | "mission.deleted" | "invoice.updated" ...
  payload: any;
};

export function connectEvents(onMessage: (msg: RealtimeMessage) => void) {
  const url = `${API}/events`;
  const es = new EventSource(url, { withCredentials: true });

  es.addEventListener("update", (evt: MessageEvent) => {
    try {
      const data = JSON.parse(evt.data) as RealtimeMessage;
      onMessage(data);
    } catch {
      // ignore
    }
  });

  es.onerror = () => {
    // EventSource se reconnecte automatiquement
  };

  return () => es.close();
}
