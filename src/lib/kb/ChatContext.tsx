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

  useEffect(() => {
    setActiveId(localStorage.getItem(ACTIVE_KEY));
    api
      .listChats()
      .then((res) => setConversations(res.chats))
      .catch((e) => setError(`Could not load chat history: ${e}`));
  }, []);

  useEffect(() => {
    if (activeId) localStorage.setItem(ACTIVE_KEY, activeId);
    else localStorage.removeItem(ACTIVE_KEY);
  }, [activeId]);

  // Write-through: a conversation is saved when it changes, not on a timer, so
  // whatever is on screen is already on disk.
  const persist = useCallback(async (conv: Conversation) => {
    try {
      await api.saveChat(conv);
    } catch (e) {
      setError(`Could not save this chat: ${e}`);
    }
  }, []);

  const sorted = useMemo(
    () => [...conversations].sort((a, b) => b.updatedAt - a.updatedAt),
    [conversations],
  );

  const active = useMemo(
    () => (activeId ? conversations.find((c) => c.id === activeId) ?? null : null),
    [conversations, activeId],
  );

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
          }
        : {
            id: newId(),
            title: titleFrom(trimmed),
            updatedAt: Date.now(),
            messages: [userUi],
            wire: [userWire],
          };

      setConversations((prev) =>
        existing ? prev.map((c) => (c.id === target.id ? target : c)) : [target, ...prev],
      );
      setActiveId(target.id);
      setLoading(true);
      setStreamingId(target.id);
      setPendingTools([]);
      // Save the question before the answer exists: if the model stalls or the
      // backend dies mid-turn, the chat still survives a reload.
      void persist(target);

      const collectedTools: ChatToolEvent[] = [];
      let assistantText = "";

      const { promise, abort } = api.chatStream(
        { messages: target.wire, model, temperature: 0.3, max_iters: 1000 },
        (ev: ChatEvent) => {
          if (ev.type === "tool_call") {
            collectedTools.push({ name: ev.name, args: ev.args });
            setPendingTools([...collectedTools]);
          } else if (ev.type === "tool_result") {
            const last = collectedTools[collectedTools.length - 1];
            if (last && last.name === ev.name && last.result === undefined) {
              last.result = ev.result;
            } else {
              collectedTools.push({ name: ev.name, result: ev.result });
            }
            setPendingTools([...collectedTools]);
          } else if (ev.type === "content") {
            assistantText = ev.text;
          } else if (ev.type === "error") {
            setError(ev.message);
          }
        },
      );
      abortRef.current = abort;

      try {
        await promise;
      } catch (e) {
        setError(String(e));
      } finally {
        const assistantUi: ChatUiMessage = {
          role: "assistant",
          content: assistantText || "(no response)",
          tools: collectedTools.length ? collectedTools : undefined,
        };
        const assistantWire: ChatWireMessage = { role: "assistant", content: assistantText };
        const answered: Conversation = {
          ...target,
          messages: [...target.messages, assistantUi],
          wire: [...target.wire, assistantWire],
          updatedAt: Date.now(),
        };

        setConversations((prev) => prev.map((c) => (c.id === target.id ? answered : c)));
        setPendingTools([]);
        setStreamingId(null);
        setLoading(false);
        abortRef.current = null;
        void persist(answered);
      }
    },
    [active, loading, persist],
  );

  const stop = useCallback(() => {
    abortRef.current?.();
  }, []);

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
