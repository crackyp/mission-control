"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useRef,
  type ReactNode,
} from "react";
import { api, type ChatEvent } from "@/lib/kb/api";
import { useStatus } from "@/lib/kb/StatusContext";
import type {
  Conversation,
  ChatToolEvent,
  ChatUiMessage,
  ChatWireMessage,
} from "@/lib/kb/types";

/** Which conversation to reopen on load. A per-browser view preference, so it
 *  stays local — the conversations themselves live in kb/chats/. */
const ACTIVE_KEY = "mission-control:kb:chat-active-id";

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function titleFrom(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > 48 ? `${oneLine.slice(0, 48)}…` : oneLine;
}

interface ChatContextValue {
  /** Newest-updated first. */
  conversations: Conversation[];
  activeId: string | null;
  active: Conversation | null;
  loading: boolean;
  /** Conversation the in-flight response belongs to, if any. */
  streamingId: string | null;
  pendingTools: ChatToolEvent[];
  error: string | null;
  send: (text: string, model: string) => Promise<void>;
  stop: () => void;
  newChat: () => void;
  selectChat: (id: string) => void;
  deleteChat: (id: string) => void;
}

const ChatContext = createContext<ChatContextValue | null>(null);

export function ChatProvider({ children }: { children: ReactNode }) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [pendingTools, setPendingTools] = useState<ChatToolEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<(() => void) | null>(null);
  const { setModel } = useStatus();

  // Listen to a chat's run until it ends. The run lives on the KB server and
  // saves its own reply, so this listener can come and go: closing the page
  // drops it, and opening the page again rejoins through `running`.
  const follow = useCallback(
    async (
      id: string,
      start?: (onEvent: (ev: ChatEvent) => void) => { promise: Promise<void>; abort: () => void },
    ) => {
      setLoading(true);
      setStreamingId(id);
      let left = false;
      while (true) {
        const tools: ChatToolEvent[] = [];
        setPendingTools([]);
        const onEvent = (ev: ChatEvent) => {
          if (ev.type === "tool_call") {
            tools.push({ name: ev.name, args: ev.args });
            setPendingTools([...tools]);
          } else if (ev.type === "tool_result") {
            const last = tools[tools.length - 1];
            if (last && last.name === ev.name && last.result === undefined) {
              last.result = ev.result;
            } else {
              tools.push({ name: ev.name, result: ev.result });
            }
            setPendingTools([...tools]);
          } else if (ev.type === "error") {
            setError(ev.message);
          }
        };
        const { promise, abort } = start ? start(onEvent) : api.followChat(id, onEvent);
        start = undefined;
        abortRef.current = () => {
          left = true;
          abort();
        };
        try {
          await promise;
        } catch (e) {
          if (!left) setError(String(e));
        }
        if (left) return;

        // Done, or the connection dropped mid-run. Either way the saved chat is
        // the truth: reload it, and listen again while the server still works.
        let chats: Conversation[] | null = null;
        try {
          chats = (await api.listChats()).chats;
          setConversations(chats);
        } catch (e) {
          setError(`Could not reload chat history: ${e}`);
        }
        if (!chats?.find((c) => c.id === id)?.running) break;
        await new Promise((r) => setTimeout(r, 2000));
        if (left) return;
      }
      setPendingTools([]);
      setStreamingId(null);
      setLoading(false);
      abortRef.current = null;
    },
    [],
  );

  useEffect(() => {
    let mounted = true;
    setActiveId(localStorage.getItem(ACTIVE_KEY));
    api
      .listChats()
      .then((res) => {
        if (!mounted) return;
        setConversations(res.chats);
        // A reply asked for before the page was closed is still coming.
        const running = res.chats.find((c) => c.running);
        if (running) void follow(running.id);
      })
      .catch((e) => setError(`Could not load chat history: ${e}`));
    return () => {
      mounted = false;
      abortRef.current?.();
    };
  }, [follow]);

  useEffect(() => {
    if (activeId) localStorage.setItem(ACTIVE_KEY, activeId);
    else localStorage.removeItem(ACTIVE_KEY);
  }, [activeId]);

  const sorted = useMemo(
    () => [...conversations].sort((a, b) => b.updatedAt - a.updatedAt),
    [conversations],
  );

  const active = useMemo(
    () => (activeId ? conversations.find((c) => c.id === activeId) ?? null : null),
    [conversations, activeId],
  );

  // The model picker follows the chat on screen: opening one, or coming back
  // to the page, shows the model it was last asked with instead of the default.
  const activeModel = active?.model;
  useEffect(() => {
    if (activeModel) setModel(activeModel);
  }, [activeId, activeModel, setModel]);

  const send = useCallback(
    async (text: string, model: string) => {
      const trimmed = text.trim();
      if (!trimmed || !model || loading) return;

      setError(null);

      const userUi: ChatUiMessage = { role: "user", content: trimmed };
      const userWire: ChatWireMessage = { role: "user", content: trimmed };

      // Snapshot the conversation this turn belongs to. Every later write keys
      // off `target.id`, so switching chats mid-stream still files the reply
      // under the conversation it was asked in.
      const existing = active;
      const target: Conversation = existing
        ? {
            ...existing,
            messages: [...existing.messages, userUi],
            wire: [...existing.wire, userWire],
            updatedAt: Date.now(),
            model,
          }
        : {
            id: newId(),
            title: titleFrom(trimmed),
            updatedAt: Date.now(),
            model,
            messages: [userUi],
            wire: [userWire],
          };

      setConversations((prev) =>
        existing ? prev.map((c) => (c.id === target.id ? target : c)) : [target, ...prev],
      );
      setActiveId(target.id);
      setLoading(true);
      // The server answers from the saved chat, so the question goes to disk
      // first — which also keeps it if the model stalls or the backend dies.
      try {
        await api.saveChat(target);
      } catch (e) {
        setError(`Could not save this chat: ${e}`);
        setLoading(false);
        return;
      }
      await follow(target.id, (onEvent) =>
        api.runChat(target.id, { model, temperature: 0.3, max_iters: 1000 }, onEvent),
      );
    },
    [active, loading, follow],
  );

  const stop = useCallback(() => {
    if (!streamingId) return;
    api.stopChat(streamingId).catch((e) => setError(`Could not stop this reply: ${e}`));
  }, [streamingId]);

  const newChat = useCallback(() => setActiveId(null), []);

  const selectChat = useCallback((id: string) => setActiveId(id), []);

  const deleteChat = useCallback(async (id: string) => {
    setConversations((prev) => prev.filter((c) => c.id !== id));
    setActiveId((cur) => (cur === id ? null : cur));
    try {
      await api.deleteChat(id);
    } catch (e) {
      setError(`Could not delete this chat: ${e}`);
    }
  }, []);

  const value = useMemo(
    () => ({
      conversations: sorted,
      activeId,
      active,
      loading,
      streamingId,
      pendingTools,
      error,
      send,
      stop,
      newChat,
      selectChat,
      deleteChat,
    }),
    [
      sorted,
      activeId,
      active,
      loading,
      streamingId,
      pendingTools,
      error,
      send,
      stop,
      newChat,
      selectChat,
      deleteChat,
    ],
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error("useChat must be used within ChatProvider");
  return ctx;
}
