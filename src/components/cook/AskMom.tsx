"use client";

import { useState, type FormEvent } from "react";
import { CATALOG } from "@/lib/catalog";
import type { Recipe } from "@/lib/schemas";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { inputClass } from "@/components/ui/Field";

type Message = { role: "user" | "assistant"; content: string };

const MOM_ERROR = "Mama stepped away. Try again.";
// Appended by the route when the provider fails after text has started (see route.ts).
const MOM_ERROR_MARK = "[[mom-error]]";

// The first catalog ingredient named in the step text, or null.
export function ingredientInStep(recipe: Recipe, stepText: string): string | null {
  const text = stepText.toLowerCase();
  let best: { name: string; at: number } | null = null;
  for (const ing of recipe.ingredients) {
    const full = CATALOG[ing.key]?.displayName.toLowerCase();
    if (!full) continue;
    const candidates = [full, ...full.split(/[\s-]+/).filter((w) => w.length >= 4)];
    for (const name of candidates) {
      const at = text.indexOf(name);
      if (at >= 0 && (best === null || at < best.at)) best = { name, at };
    }
  }
  return best?.name ?? null;
}

export function AskMom({
  recipe,
  stepIndex,
  stepText,
  allergies = [],
  dislikes = [],
  onClose,
}: {
  recipe: Recipe;
  stepIndex: number;
  stepText: string;
  allergies?: string[];
  dislikes?: string[];
  onClose: () => void;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ingredient = ingredientInStep(recipe, stepText) ?? "an ingredient";
  const suggestions = ["Is it done yet?", `I don't have ${ingredient}`, "Can I skip this?"];

  async function send(raw: string) {
    const question = raw.trim();
    if (!question || busy) return;
    const history = messages.slice(-10);

    setMessages((prev) => [...prev, { role: "user", content: question }, { role: "assistant", content: "" }]);
    setInput("");
    setBusy(true);
    setError(null);

    const setLastAnswer = (content: string) =>
      setMessages((prev) => {
        const next = prev.slice();
        next[next.length - 1] = { role: "assistant", content };
        return next;
      });

    try {
      const res = await fetch("/api/ask-mom", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipe, stepIndex, question, history, allergies, dislikes }),
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let text = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
        if (text.includes(MOM_ERROR_MARK)) throw new Error("mom-error");
        setLastAnswer(text);
      }
      text += decoder.decode();
      if (text.includes(MOM_ERROR_MARK)) throw new Error("mom-error");
      if (!text.trim()) throw new Error("empty answer");
      setLastAnswer(text);
    } catch {
      // Not an answer: drop the unanswered pair, keep the question in the input, show the error state.
      setMessages((prev) => prev.slice(0, -2));
      setInput(question);
      setError(MOM_ERROR);
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    void send(input);
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60" onClick={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="ask-mom-title"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[88dvh] w-full max-w-3xl flex-col gap-4 rounded-t-[28px] border border-line bg-paper p-5 pb-[max(20px,env(safe-area-inset-bottom))] shadow-2xl"
      >
        <div className="flex items-center justify-between gap-3">
          <h2 id="ask-mom-title" className="font-display text-[30px] leading-tight">
            Ask Mama
          </h2>
          <Button variant="ghost" size="md" onClick={onClose}>
            Close
          </Button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto" aria-live="polite">
          {messages.length === 0 && (
            <div className="flex flex-wrap gap-2">
              {suggestions.map((s) => (
                <Chip key={s} selected={false} disabled={busy} onClick={() => void send(s)}>
                  {s}
                </Chip>
              ))}
            </div>
          )}
          {messages.map((m, i) =>
            m.role === "user" ? (
              <p key={i} className="ml-auto max-w-[85%] rounded-[20px] bg-line px-4 py-3 text-[18px]">
                {m.content}
              </p>
            ) : (
              <Card key={i} tone="panel" className="p-5 text-[18px] leading-relaxed">
                {m.content || <span className="text-muted">Mama is typing…</span>}
              </Card>
            ),
          )}
          {error && (
            <div className="flex flex-wrap items-center gap-3">
              <p role="alert" className="text-[17px] font-semibold text-tomato">
                {error}
              </p>
              <Button variant="ghost" size="md" disabled={busy || input.trim().length === 0} onClick={() => void send(input)}>
                Try again
              </Button>
            </div>
          )}
        </div>

        <form onSubmit={onSubmit} className="flex gap-3">
          <label className="sr-only" htmlFor="ask-mom-input">
            Your question
          </label>
          <input
            id="ask-mom-input"
            className={inputClass}
            placeholder="Type your question"
            value={input}
            maxLength={400}
            onChange={(e) => setInput(e.target.value)}
          />
          <Button type="submit" size="md" disabled={busy || input.trim().length === 0}>
            Send
          </Button>
        </form>
      </section>
    </div>
  );
}
