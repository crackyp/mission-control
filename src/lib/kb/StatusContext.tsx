"use client";

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import type { StatusResponse } from "@/lib/kb/types";
import { api } from "@/lib/kb/api";

interface StatusContextValue {
  status: StatusResponse | null;
  /** The last status poll failed: the backend on the PC is not answering. */
  offline: boolean;
  refresh: () => Promise<void>;
  /**
   * Bumped whenever something has written to kb/ (a compile, an ingest, a
   * reindex). Data hooks watch it so views reload themselves instead of
   * waiting for the user to hit Refresh. Kept separate from `refresh`, which
   * polls on a timer and must not drag every file listing along with it.
   */
  dataVersion: number;
  invalidate: () => void;
  /** Selected model shared across all tabs */
  model: string;
  setModel: (m: string) => void;
}

const StatusContext = createContext<StatusContextValue | null>(null);

const POLL_MS = 10_000;

export function StatusProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [offline, setOffline] = useState(false);
  const [model, setModel] = useState("");
  const [dataVersion, setDataVersion] = useState(0);

  const invalidate = useCallback(() => setDataVersion((v) => v + 1), []);

  const refresh = useCallback(async () => {
    try {
      const s = await api.getStatus();
      setStatus(s);
      setOffline(false);
    } catch (e) {
      console.error("Status fetch failed:", e);
      setOffline(true);
    }
  }, []);

  // Initial fetch + polling
  useEffect(() => {
    const initial = window.setTimeout(() => { void refresh(); }, 0);
    const id = setInterval(refresh, POLL_MS);
    return () => {
      window.clearTimeout(initial);
      clearInterval(id);
    };
  }, [refresh]);

  // Auto-select default model (or first) when models arrive and none chosen yet
  useEffect(() => {
    if (!model && status?.llamacpp.models?.length) {
      const defaultModel = status.llamacpp.default_model;
      const nextModel = defaultModel && status.llamacpp.models.includes(defaultModel)
        ? defaultModel
        : status.llamacpp.models[0];
      const id = window.setTimeout(() => setModel(nextModel), 0);
      return () => window.clearTimeout(id);
    }
  }, [status, model]);

  return (
    <StatusContext.Provider value={{ status, offline, refresh, dataVersion, invalidate, model, setModel }}>
      {children}
    </StatusContext.Provider>
  );
}

export function useStatus() {
  const ctx = useContext(StatusContext);
  if (!ctx) throw new Error("useStatus must be used within StatusProvider");
  return ctx;
}
