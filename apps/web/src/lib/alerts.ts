import { apiFetch } from "./api";
import { getToken } from "./session";

export type AlertKind =
  | "PRICE_ABOVE"
  | "PRICE_BELOW"
  | "PCT_MOVE_UP"
  | "PCT_MOVE_DOWN"
  | "POSITION_OPENED"
  | "POSITION_CLOSED";

export interface Alert {
  alertId: string;
  kind: AlertKind;
  chain: string;
  address: string;
  symbol: string;
  threshold: string | null;
  pct: string | null;
  baselinePrice: string | null;
  oneShot: boolean;
  cooldownMs: number;
  isActive: boolean;
  lastTriggeredAt: string | null;
  createdAt: string;
}

export interface AlertEvent {
  eventId: string;
  alertId: string;
  kind: AlertKind;
  symbol: string;
  chain: string;
  observedValue: string | null;
  threshold: string | null;
  reason: string;
  quoteSource: string | null;
  marketDataTs: string | null;
  firedAt: string;
}

export async function fetchAlerts(): Promise<Alert[]> {
  const token = await getToken();
  if (!token) return [];
  const res = await apiFetch<{ alerts: Alert[] }>("/alerts", { token });
  return res.ok && res.data ? res.data.alerts : [];
}

export async function fetchAlertEvents(limit = 50): Promise<AlertEvent[]> {
  const token = await getToken();
  if (!token) return [];
  const res = await apiFetch<{ events: AlertEvent[] }>(
    `/alerts/events?limit=${limit}`,
    { token },
  );
  return res.ok && res.data ? res.data.events : [];
}
