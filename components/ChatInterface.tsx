"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  wordCount: number;
  status: "streaming" | "done" | "cancelled" | "error";
};

type Props = {
  onWordEvent: (word: string) => void;
  onPromptSent?: () => void;
  onStreamingChange?: (isStreaming: boolean) => void;
  pricePerWord: number;
};

export default function ChatInterface({
  onWordEvent,
  onPromptSent,
  onStreamingChange,
  pricePerWord,
}: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  useLayoutEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 120) + "px";
  }, [input]);

  useEffect(() => {
    onStreamingChange?.(isStreaming);
  }, [isStreaming, onStreamingChange]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        abortRef.current?.abort();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function send() {
    const text = input.trim();
    if (!text || isStreaming) return;

    onPromptSent?.();

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
      wordCount: 0,
      status: "done",
    };
    const aiId = crypto.randomUUID();
    const aiMsg: Message = {
      id: aiId,
      role: "assistant",
      content: "",
      wordCount: 0,
      status: "streaming",
    };

    const nextMessages = [...messages, userMsg, aiMsg];
    setMessages(nextMessages);
    setInput("");
    setIsStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: nextMessages
            .filter((m) => m.content.length > 0)
            .map((m) => ({ role: m.role, content: m.content })),
        }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        const errText = await res.text().catch(() => `HTTP ${res.status}`);
        throw new Error(errText || `HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let fullText = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        fullText += chunk;
        buffer += chunk;

        const match = /\s[^\s]*$/.exec(buffer);
        let newWords = 0;
        if (match) {
          const committed = buffer.substring(0, match.index);
          buffer = buffer.substring(match.index + 1);
          const words = committed.split(/\s+/).filter((w) => w.length > 0);
          newWords = words.length;
          for (const word of words) onWordEvent(word);
        }

        setMessages((prev) =>
          prev.map((m) =>
            m.id === aiId
              ? { ...m, content: fullText, wordCount: m.wordCount + newWords }
              : m
          )
        );
      }

      const tail = buffer.trim();
      if (tail.length > 0) {
        onWordEvent(tail);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === aiId
              ? {
                  ...m,
                  content: fullText,
                  wordCount: m.wordCount + 1,
                  status: "done",
                }
              : m
          )
        );
      } else {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === aiId ? { ...m, content: fullText, status: "done" } : m
          )
        );
      }
    } catch (err) {
      const isAbort =
        err instanceof DOMException
          ? err.name === "AbortError"
          : err instanceof Error && err.name === "AbortError";
      setMessages((prev) =>
        prev.map((m) =>
          m.id === aiId
            ? { ...m, status: isAbort ? "cancelled" : "error" }
            : m
        )
      );
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
    }
  }

  function onKeyDown(e: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <div className="flex flex-col overflow-hidden rounded-lg border border-stroke-subtle bg-app-elevated">
      <div className="flex items-center justify-between px-5 pb-4 pt-5">
        <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-tertiary">
          Conversation
        </span>
        <div
          className={`flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.08em] ${
            isStreaming ? "text-accent" : "text-ink-tertiary"
          }`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              isStreaming ? "bg-accent soft-pulse" : "bg-ink-quaternary"
            }`}
          />
          {isStreaming ? "Live" : "Idle"}
        </div>
      </div>

      <div
        ref={scrollRef}
        className="scrollbar-thin flex max-h-[540px] flex-col gap-5 overflow-y-auto px-5 pb-4"
      >
        {messages.length === 0 ? (
          <EmptyState />
        ) : (
          messages.map((m) => (
            <MessageRow key={m.id} m={m} pricePerWord={pricePerWord} />
          ))
        )}
      </div>

      <div className="border-t border-t-stroke-subtle transition-colors duration-150 focus-within:border-t-accent">
        <textarea
          ref={taRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          placeholder="Ask anything..."
          className="w-full resize-none bg-transparent px-4 pb-1 pt-3 text-[14px] leading-relaxed text-ink-primary placeholder:text-ink-quaternary focus:outline-none"
          style={{ minHeight: "44px", maxHeight: "120px" }}
        />
        <div className="flex justify-end gap-6 px-4 pb-2.5 font-mono text-[10px] text-ink-quaternary">
          <span>↵ send</span>
          <span>⇧↵ newline</span>
          <span>esc stop</span>
        </div>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex h-[200px] flex-col items-center justify-center gap-1.5">
      <p className="font-mono text-[13px] text-ink-tertiary">
        No conversation yet.
      </p>
      <p className="text-[11px] text-ink-quaternary">
        Type a message to start streaming payments.
      </p>
    </div>
  );
}

function MessageRow({
  m,
  pricePerWord,
}: {
  m: Message;
  pricePerWord: number;
}) {
  const isUser = m.role === "user";
  const totalPaid = m.wordCount * pricePerWord;

  return (
    <div
      className={`flex flex-col gap-1.5 ${
        isUser ? "items-end" : "items-start"
      }`}
    >
      <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-tertiary">
        {isUser ? "You" : "PayStream AI"}
      </span>

      {isUser ? (
        <div className="max-w-[75%] whitespace-pre-wrap rounded-lg border border-accent-border bg-accent-subtle px-3 py-2 text-[13px] text-ink-primary">
          {m.content}
        </div>
      ) : (
        <div className="w-full max-w-[90%]">
          {m.content ? (
            <AssistantMarkdown content={m.content} />
          ) : m.status === "streaming" ? null : (
            <em className="text-ink-quaternary">(empty)</em>
          )}
          {m.status === "streaming" && (
            <span className="ml-0.5 inline-block h-4 w-[2px] animate-pulse bg-accent align-middle" />
          )}
        </div>
      )}

      {!isUser && m.status !== "streaming" && m.wordCount > 0 && (
        <div className="flex items-center gap-2 font-mono text-[11px] text-ink-tertiary">
          <span>{m.wordCount} words</span>
          <DotSep />
          <span>${totalPaid.toFixed(4)}</span>
          <DotSep />
          <span>{m.wordCount} txs</span>
          {m.status === "cancelled" && (
            <>
              <DotSep />
              <span className="text-amber-400">stopped</span>
            </>
          )}
        </div>
      )}

      {!isUser && m.status === "error" && (
        <div className="font-mono text-[11px] text-red-400">
          error — check server terminal
        </div>
      )}
    </div>
  );
}

function DotSep() {
  return <span className="text-ink-quaternary">·</span>;
}

const markdownComponents: Components = {
  code({ node: _node, className, children, ...rest }) {
    const match = /language-(\w+)/.exec(className || "");
    if (match) {
      return (
        <SyntaxHighlighter
          style={vscDarkPlus}
          language={match[1]}
          PreTag="div"
          customStyle={{
            margin: 0,
            borderRadius: "6px",
            padding: "16px",
            fontSize: "13px",
            background: "var(--bg-sunken)",
            border: "1px solid var(--border-subtle)",
          }}
        >
          {String(children).replace(/\n$/, "")}
        </SyntaxHighlighter>
      );
    }
    return (
      <code
        className="rounded-sm bg-accent-subtle px-1.5 py-0.5 font-mono text-[12px] text-accent"
        {...rest}
      >
        {children}
      </code>
    );
  },
  a({ node: _node, children, ...rest }) {
    return (
      <a
        {...rest}
        target="_blank"
        rel="noopener noreferrer"
        className="text-accent no-underline hover:underline"
      >
        {children}
      </a>
    );
  },
};

function AssistantMarkdown({ content }: { content: string }) {
  return (
    <div
      className="prose prose-invert prose-sm max-w-none text-[14px] leading-relaxed text-ink-primary
        prose-p:my-2 prose-p:leading-relaxed
        prose-headings:mt-4 prose-headings:mb-2 prose-headings:text-[14px] prose-headings:font-semibold prose-headings:text-ink-primary
        prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5 prose-li:marker:text-ink-tertiary
        prose-pre:bg-transparent prose-pre:p-0 prose-pre:my-3
        prose-strong:text-ink-primary prose-strong:font-semibold
        prose-em:text-ink-secondary
        prose-hr:border-stroke-subtle
        prose-blockquote:border-l-stroke-strong prose-blockquote:text-ink-secondary"
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
