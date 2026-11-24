"use client";

import { useEffect, useState, type FormEvent } from "react";
import { z } from "zod";
import { ImportResult } from "@/components/import/ImportFlow";
import { Button } from "@/components/ui/Button";
import { Field, inputClass } from "@/components/ui/Field";
import { StickyNote } from "@/components/ui/StickyNote";
import { postJson } from "@/components/week/plan-utils";
import { TrendingPost } from "@/lib/trending/apify";
import { statLine } from "@/lib/trending/format";
import { titleFrom } from "@/lib/trending/rank";
import { Recipe } from "@/lib/schemas";
import { useAppState } from "@/lib/useAppState";

const FeedResponse = z.object({ posts: z.array(TrendingPost) });
const ImportResponse = z.object({ recipe: Recipe });
const EMPTY_COPY = "Mama hasn't checked the feeds yet.";
const PLATFORM_NAME = { tiktok: "TikTok", instagram: "Instagram" } as const;

type Feed = { status: "loading" } | { status: "ready"; posts: TrendingPost[] };
type Phase =
  | { kind: "idle" }
  | { kind: "waiting"; id: string }
  | { kind: "error"; id: string; message: string }
  | { kind: "result"; recipe: Recipe };

export function TrendingShelf() {
  const [appState, , hydrated] = useAppState();
  const [feed, setFeed] = useState<Feed>({ status: "loading" });
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [admin, setAdmin] = useState(false);

  async function loadFeed() {
    try {
      const res = await fetch("/api/trending", { cache: "no-store" });
      const parsed = FeedResponse.safeParse(await res.json());
      setFeed({ status: "ready", posts: parsed.success ? parsed.data.posts : [] });
    } catch {
      setFeed({ status: "ready", posts: [] });
    }
  }

  useEffect(() => {
    setAdmin(new URLSearchParams(window.location.search).get("admin") === "1");
    void loadFeed();
  }, []);

  async function makeWithMom(post: TrendingPost) {
    setPhase({ kind: "waiting", id: post.id });
    try {
      // The caption is already in hand, so the server reads text, not the page.
      const data = await postJson("/api/import", { text: post.caption, url: post.url, profile: appState.profile });
      const parsed = ImportResponse.safeParse(data);
      if (!parsed.success) throw new Error("Mama's recipe came back a little wrong.");
      setPhase({ kind: "result", recipe: parsed.data.recipe });
    } catch (err) {
      setPhase({ kind: "error", id: post.id, message: err instanceof Error ? err.message : "Something went wrong." });
    }
  }

  if (phase.kind === "result") {
    return (
      <div className="mx-auto w-full max-w-xl">
        <ImportResult recipe={phase.recipe} onReset={() => setPhase({ kind: "idle" })} resetLabel="Back to trending" />
      </div>
    );
  }

  const posts = feed.status === "ready" ? feed.posts : [];
  const busy = phase.kind === "waiting";

  return (
    <div className="mx-auto grid w-full max-w-5xl gap-8">
      <header className="grid gap-3">
        <h1 className="text-[40px] leading-[1.1]">Trending now</h1>
        <p className="text-[18px] text-muted">What people are actually cooking this week.</p>
      </header>

      {feed.status === "loading" && (
        <p role="status" className="text-[18px] text-muted">
          Reading the feeds…
        </p>
      )}

      {feed.status === "ready" && posts.length === 0 && <StickyNote>{EMPTY_COPY}</StickyNote>}

      {phase.kind === "error" && (
        <p role="status" className="text-[18px] font-semibold text-tomato">
          {phase.message}
        </p>
      )}

      {posts.length > 0 && (
        <ul className="grid grid-cols-1 gap-5 min-[768px]:grid-cols-2 min-[1200px]:grid-cols-3">
          {posts.map((post) => {
            const author = post.author.replace(/^@/, "");
            const isWaiting = busy && phase.id === post.id;
            return (
              <li key={post.id}>
                <article className="grid h-full gap-3 rounded-[20px] bg-panel p-5">
                  {post.image && (
                    <div className="relative -mx-5 -mt-5 aspect-[4/3] overflow-hidden rounded-t-[20px] bg-line">
                      {/* Platform thumbnails live in our Blob; a plain img keeps them out of the Next image allowlist. */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={post.image} alt="" loading="lazy" className="h-full w-full object-cover" data-testid="trending-photo" />
                    </div>
                  )}
                  <p className="text-[14px] font-semibold uppercase tracking-[0.08em] text-muted">
                    {PLATFORM_NAME[post.platform]}
                  </p>
                  <h2 className="font-display text-[22px] leading-tight">{titleFrom(post.caption)}</h2>
                  <p className="text-[17px] text-muted">@{author}</p>
                  <p className="text-[17px]">{statLine(post)}</p>
                  <div className="mt-auto grid gap-3 pt-2">
                    <Button size="lg" fullWidth disabled={busy || !hydrated} onClick={() => void makeWithMom(post)}>
                      {isWaiting ? "Reading…" : "Make this with Mama"}
                    </Button>
                    <a
                      href={post.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-h-12 items-center justify-center text-[18px] font-semibold underline underline-offset-4"
                    >
                      Watch
                    </a>
                  </div>
                </article>
              </li>
            );
          })}
        </ul>
      )}

      {admin && <AdminCheck onDone={loadFeed} />}
    </div>
  );
}

// Dev convenience behind ?admin=1. The secret lives in this form's state only: never stored, never sent anywhere but the cron route.
function AdminCheck({ onDone }: { onDone: () => Promise<void> }) {
  const [secret, setSecret] = useState("");
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function checkNow(e: FormEvent) {
    e.preventDefault();
    if (!secret.trim()) return;
    setChecking(true);
    setMessage(null);
    try {
      const res = await fetch("/api/cron/trending", { headers: { authorization: `Bearer ${secret.trim()}` } });
      const data: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const error = data && typeof data === "object" && "error" in data ? String(data.error) : "The check failed.";
        setMessage(res.status === 401 ? "That secret didn't work." : error);
      } else {
        const stats = data && typeof data === "object" && "stats" in data ? (data.stats as { fetched?: number; keptAsRecipe?: number }) : {};
        setMessage(`Fetched ${stats.fetched ?? 0}, kept ${stats.keptAsRecipe ?? 0} as recipes.`);
        await onDone();
      }
    } catch {
      setMessage("Check your connection and try again.");
    } finally {
      setSecret("");
      setChecking(false);
    }
  }

  return (
    <section aria-label="Admin check" className="grid max-w-md gap-4 border-t border-line pt-6">
      <form onSubmit={checkNow} className="grid gap-4">
        <Field label="Cron secret">
          {(id, describedBy) => (
            <input
              id={id}
              aria-describedby={describedBy}
              className={inputClass}
              type="password"
              autoComplete="off"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              disabled={checking}
            />
          )}
        </Field>
        <Button type="submit" variant="ghost" size="md" fullWidth disabled={checking || !secret.trim()}>
          Check now
        </Button>
      </form>
      {message && (
        <p role="status" className="text-[17px] leading-snug">
          {message}
        </p>
      )}
    </section>
  );
}
