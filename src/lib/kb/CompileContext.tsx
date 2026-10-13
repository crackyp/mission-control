"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { api } from "@/lib/kb/api";
import { useStatus } from "@/lib/kb/StatusContext";
import type { CommandResponse, CompileRequest } from "@/lib/kb/types";

interface CompileContextValue {
  compiling: boolean;
  liveLines: string[];
  result: CommandResponse | null;
  /** Resolves with the final result, or undefined if a compile is already running. */
  startCompile: (data: CompileRequest) => Promise<CommandResponse | undefined>;
  stopCompile: () => void;
}

const CompileContext = createContext<CompileContextValue | null>(null);

type Stream = { promise: Promise<CommandResponse>; abort: () => void };

// The compile runs on the KB server, not in this page: the page only listens.
// Leaving the tab (or closing it) drops the listener, and the next mount
// rejoins the compile, or picks up how it ended while nobody was watching.
export function CompileProvider({ children }: { children: ReactNode }) {
  const { refresh: refreshStatus, invalidate } = useStatus();
  const [compiling, setCompiling] = useState(false);
  const [liveLines, setLiveLines] = useState<string[]>([]);
  const [result, setResult] = useState<CommandResponse | null>(null);
  const leaveRef = useRef<(() => void) | null>(null);

  const pushLine = useCallback((line: string) => {
    setLiveLines((prev) => [...prev, line]);
  }, []);

  const listen = useCallback(
    (stream: Stream, rejoining: boolean): Promise<CommandResponse | undefined> => {
      let left = false;
      leaveRef.current = () => {
        left = true;
        stream.abort();
      };
      return stream.promise
        .catch((error): CommandResponse | undefined => {
          // Rejoining: nothing to rejoin (404), or the backend is down, which
          // the tab already reports — either way there's no compile to show.
          if (rejoining) return undefined;
          return { returncode: 1, output: String(error), command: "" };
        })
        .then((res) => {
          if (left) return undefined;
          leaveRef.current = null;
          setLiveLines([]);
          setCompiling(false);
          if (!res) return undefined;
          setResult(res);
          if (res.returncode === 0) {
            refreshStatus();
            // New/merged pages and rewritten links — reload the file lists and graph.
            invalidate();
          }
          return res;
        });
    },
    [refreshStatus, invalidate],
  );

  useEffect(() => {
    void listen(
      api.followCompile(pushLine, () => {
        setResult(null);
        setCompiling(true);
      }),
      true,
    );
    return () => leaveRef.current?.();
  }, [listen, pushLine]);

  const startCompile = useCallback(
    async (data: CompileRequest): Promise<CommandResponse | undefined> => {
      if (leaveRef.current) return;
      setCompiling(true);
      setResult(null);
      setLiveLines([]);
      return listen(api.runCompile(data, pushLine), false);
    },
    [listen, pushLine],
  );

  const stopCompile = useCallback(() => {
    // The listener gets the "stopped" result once the server has ended it.
    api.stopCompile().catch((e) =>
      setResult({ returncode: 1, output: `Could not stop the compile: ${e}`, command: "" }),
    );
  }, []);

  const value = useMemo(
    () => ({ compiling, liveLines, result, startCompile, stopCompile }),
    [compiling, liveLines, result, startCompile, stopCompile],
  );

  return <CompileContext.Provider value={value}>{children}</CompileContext.Provider>;
}

export function useCompile() {
  const ctx = useContext(CompileContext);
  if (!ctx) throw new Error("useCompile must be used within CompileProvider");
  return ctx;
}
