"use client";

// Connection mode state machine: probe /v1/health at startup to decide LIVE/LOCAL;
// an SSE drop flips it back to LOCAL, and a slow 90 s reprobe waits for revival.
// External store + useSyncExternalStore consumption — no tearing on React 18/19.
import { useSyncExternalStore } from "react";
import { apiFetch, getApiBaseUrl } from "./client";
import type { HealthResponse } from "./types";

export type ConnStatus = "probing" | "live" | "local";

export interface ConnState {
  status: ConnStatus;
}

// The probe's whole job is to wait for the server, so it has to outlast a Render
// free-plan cold start: 24.5 s measured on 2026-09-24, after the 15-minute idle
// sleep. At the original 3000 ms it gave up long before the server could answer,
// which put every visitor arriving after idle into LOCAL mode — no file system,
// no news, and the simulated market engine instead of the real feed.
//
// Nothing else has to survive the cold start: the components all gate on
// `conn.status === "live"` before they fetch, so this probe is the single gate.
//
// A timeout is a ceiling, not a delay, so a warm server still resolves in ~2 s.
const PROBE_TIMEOUT_MS = 45_000;
const REPROBE_MS = 90_000;

const listeners = new Set<() => void>();
let state: ConnState = { status: "probing" };
let bootstrapped = false;
let reprobeTimer: ReturnType<typeof setInterval> | null = null;

function setState(patch: Partial<ConnState>) {
  let changed = false;
  for (const key of Object.keys(patch) as (keyof ConnState)[]) {
    if (state[key] !== patch[key]) changed = true;
  }
  if (!changed) return;
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

async function probe(): Promise<boolean> {
  try {
    await apiFetch<HealthResponse>("/v1/health", { timeoutMs: PROBE_TIMEOUT_MS });
    return true;
  } catch {
    return false;
  }
}

function startReprobe() {
  if (reprobeTimer || !getApiBaseUrl()) return;
  reprobeTimer = setInterval(() => {
    void probe().then((ok) => {
      if (ok) conn.markLive();
    });
  }, REPROBE_MS);
}

function stopReprobe() {
  if (reprobeTimer) clearInterval(reprobeTimer);
  reprobeTimer = null;
}

/** Probe only when the first subscriber appears — zero network cost when nobody
 *  consumes the connection state. */
function ensureBootstrap() {
  if (bootstrapped) return;
  bootstrapped = true;
  if (!getApiBaseUrl()) {
    setState({ status: "local" }); // offline mode: even the probe is skipped
    return;
  }
  void probe().then((ok) => (ok ? conn.markLive() : conn.markLocal()));
}

export const conn = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    ensureBootstrap();
    return () => listeners.delete(listener);
  },
  get(): ConnState {
    return state;
  },
  /** Probe succeeded / SSE connected (called by feed). */
  markLive() {
    stopReprobe();
    setState({ status: "live" });
  },
  /** Probe failed / SSE dropped (called by feed); the 90 s slow reprobe waits for
   *  revival. */
  markLocal() {
    setState({ status: "local" });
    startReprobe();
  },
};

// SSR snapshot: always "probing" — identical to the client's initial snapshot, triggers
// no subscription/probe and no hydration mismatch; the real state reveals itself once
// on the client.
const SERVER_SNAPSHOT: ConnState = { status: "probing" };

export function useConnection(): ConnState {
  return useSyncExternalStore(conn.subscribe, conn.get, () => SERVER_SNAPSHOT);
}
