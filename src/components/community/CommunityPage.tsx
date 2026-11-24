"use client";

import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "../ui/Button";
import type { ChatItem, Me } from "@/lib/community/db";
import { markSeen } from "@/lib/community/seen";
import { PhotoPicker, type PhotoDraft } from "./PhotoPicker";
import { ShareRecipeSheet } from "./ShareRecipeSheet";

/* Community photos and recipe thumbnails are plain <img> tags, like the rest of the feed. */
/* eslint-disable @next/next/no-img-element */

// The table as a chat: one room, bubbles in time order, mine on the right, Mama's note pinned at the top,
// the composer stuck to the bottom. Refreshes every few seconds while the tab is visible.
type Loaded = { me: Me; items: ChatItem[]; pinned: { id: string; text: string } | null };
type Status = "loading" | "pending" | "banned" | "ready" | "error";

const REASONS = ["Not kind", "Spam or selling", "Phone, link or personal info", "Something else"] as const;
const POLL_MS = 7000;

function clock(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}
function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const y = new Date();
  y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric" });
}

// Mama's answers to the API's short codes. Food, not error codes.
function say(code: string | undefined, care = false): string {
  if (care) return "Honey, that sounds heavy. If you’re in the US, call or text 988 any time. Mama’s keeping this one between us for now.";
  switch (code) {
    case "blocked":
      return "That one doesn’t go on the table, honey. Say it kinder.";
    case "name_rejected":
      return "Pick a name Mama can say out loud at dinner: letters only, 2 to 24.";
    case "muted":
      return "You can read along for now, honey. Writing opens up again after Mama has a word.";
    case "slow_down":
      return "Easy, honey. Give it a minute before the next one.";
    case "name_needed":
      return "Tell the table what to call you first.";
    default:
      return "That didn’t go through. Try again in a minute.";
  }
}

async function post(body: unknown): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
  const res = await fetch("/api/community", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = ((await res.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, json };
}

export function CommunityPage() {
  const { isLoaded, isSignedIn } = useAuth();
  const [status, setStatus] = useState<Status>("loading");
  const [me, setMe] = useState<Me>(null);
  const [items, setItems] = useState<ChatItem[]>([]);
  const [pinned, setPinned] = useState<{ id: string; text: string } | null>(null);
  const [pinOpen, setPinOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<ChatItem | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [reporting, setReporting] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [photo, setPhoto] = useState<PhotoDraft | null>(null);
  const [sharing, setSharing] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const lastId = useRef<string | null>(null);

  const load = useCallback(async (): Promise<boolean> => {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch("/api/community", { cache: "no-store", signal: AbortSignal.timeout(8000) });
        if (res.status === 403) {
          // Only a real ban closes the door; any other 403 (a waiting member, an auth hiccup) reads as an error.
          const j = (await res.json().catch(() => null)) as { error?: string } | null;
          setStatus(j?.error === "banned" ? "banned" : "error");
          return false;
        }
        if (!res.ok) continue;
        const j = (await res.json()) as Loaded | { pending: true };
        if ("pending" in j) {
          setStatus("pending");
          return false;
        }
        setMe(j.me);
        setItems(j.items);
        setPinned(j.pinned);
        setStatus("ready");
        markSeen();
        return true;
      } catch {
        // timed out: once more
      }
    }
    setStatus((s) => (s === "ready" ? s : "error"));
    return false;
  }, []);

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    const t = setTimeout(() => void load(), 0);
    const poll = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_MS);
    return () => {
      clearTimeout(t);
      clearInterval(poll);
    };
  }, [isLoaded, isSignedIn, load]);

  // Stick to the bottom when something new lands (first load, own message, a new one from someone else).
  useEffect(() => {
    const last = items[items.length - 1]?.id ?? null;
    if (last && last !== lastId.current) {
      const nearBottom = window.innerHeight + window.scrollY >= document.body.scrollHeight - 320;
      if (lastId.current === null || nearBottom || items[items.length - 1]?.mine) endRef.current?.scrollIntoView({ block: "end" });
      lastId.current = last;
    }
  }, [items]);

  async function saveName() {
    setBusy(true);
    setNote(null);
    const r = await post({ kind: "name", name });
    if (r.ok) setMe(r.json.me as Me);
    else setNote(say(r.json.error as string | undefined, Boolean(r.json.care)));
    setBusy(false);
  }

  async function send() {
    setBusy(true);
    setNote(null);
    const body = replyTo
      ? { kind: "comment", postId: replyTo.postId, text: draft }
      : { kind: "post", text: draft, ...(photo ? { photoId: photo.photoId } : {}) };
    const r = await post(body);
    if (r.ok) {
      setDraft("");
      setReplyTo(null);
      if (!replyTo) setPhoto(null);
      if (r.json.care) setNote(say(undefined, true));
      else if (r.json.state === "review") setNote("Mama’s reading this one before it goes up. You can see it; the table can’t yet.");
      await load();
    } else setNote(say(r.json.error as string | undefined, Boolean(r.json.care)));
    setBusy(false);
  }

  async function shareRecipe(recipeId: string) {
    setSharing(false);
    setBusy(true);
    setNote(null);
    const r = await post({ kind: "recipe", recipeId, text: draft });
    if (r.ok) {
      setDraft("");
      if (r.json.care) setNote(say(undefined, true));
      else if (r.json.state === "review") setNote("Mama’s reading this one before it goes up. You can see it; the table can’t yet.");
      await load();
    } else setNote(say(r.json.error as string | undefined, Boolean(r.json.care)));
    setBusy(false);
  }

  async function heart(item: ChatItem) {
    const r = await post({ kind: "heart", postId: item.postId });
    if (r.ok) setItems((xs) => xs.map((x) => (x.id === item.id ? { ...x, hearts: r.json.hearts as number, hearted: r.json.hearted as boolean } : x)));
  }
  async function reportIt(item: ChatItem, reason: string) {
    const r = await post({ kind: "report", target: item.kind, id: item.id, reason });
    const outcome = r.json.outcome as string | undefined;
    setNote(outcome === "recorded" ? "Thank you, honey. Mama will look." : outcome === "duplicate" ? "You already told Mama about this one." : say(r.json.error as string | undefined));
    setReporting(null);
    setOpenId(null);
  }
  async function remove(item: ChatItem) {
    const r = await post({ kind: "delete", target: item.kind, id: item.id });
    if (r.ok) {
      setOpenId(null);
      await load();
    }
  }

  if (status === "loading") return <Frame><p className="text-[17px] text-muted">Setting the table…</p></Frame>;
  if (status === "pending") return <Frame><p data-testid="community-pending" className="text-[17px] text-muted">The table isn’t set in this kitchen yet.</p></Frame>;
  // Closed door or a failed read: the same calm line, never a name to write to (the owner, 2026-11-04).
  if (status === "banned" || status === "error") {
    return (
      <Frame>
        <p data-testid={status === "banned" ? "community-banned" : "community-error"} className="font-hand text-[26px] leading-tight text-ink">
          Mama’s fixing the kitchen, honey. Come back in a bit.
        </p>
      </Frame>
    );
  }

  const canWrite = Boolean(me) && me?.status !== "muted";
  // A photo only rides on a top-level post, so while replying it does not count toward Send.
  const hasContent = draft.trim().length > 0 || (photo !== null && replyTo === null);
  const rows = items.map((it, i) => ({ it, day: dayLabel(it.createdAt), showDay: i === 0 || dayLabel(it.createdAt) !== dayLabel(items[i - 1].createdAt) }));
  return (
    <Frame
      pinned={
        pinned && (
          <button
            type="button"
            onClick={() => setPinOpen(!pinOpen)}
            aria-expanded={pinOpen}
            data-testid="pinned-note"
            className="flex w-full items-start gap-3 rounded-2xl bg-note px-4 py-2.5 text-left text-note-ink"
          >
            <span aria-hidden="true" className="mt-0.5 shrink-0 text-[14px]">📌</span>
            <span className="min-w-0">
              <span className="block font-hand text-[20px] leading-none">Mama</span>
              <span className={`block text-[16px] leading-snug ${pinOpen ? "whitespace-pre-line" : "truncate"}`}>{pinned.text}</span>
            </span>
          </button>
        )
      }
    >
      <ol className="grid gap-1.5 pb-24" data-testid="feed" aria-live="polite">
        {rows.map(({ it, day, showDay }) => {
          const open = openId === it.id;
          return (
            <li key={it.kind + it.id} className="grid gap-1.5">
              {showDay && <p className="my-2 justify-self-center rounded-full bg-ink/5 px-3 py-1 text-[13px] text-muted">{day}</p>}
              <div className={`flex ${it.mine ? "justify-end" : "justify-start"}`} data-testid={it.kind} data-post-id={it.postId} data-state={it.state}>
                {!it.mine && (
                  <span aria-hidden="true" className="mr-2 mt-auto inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-saffron-soft text-[13px] font-semibold text-ink">
                    {it.author.name.trim().charAt(0).toUpperCase()}
                  </span>
                )}
                <div className="grid min-w-0 max-w-[82%] gap-1">
                  {it.recipe && (
                    <Link href={`/recipe/shared/${it.recipe.id}`} className="flex min-w-0 items-center gap-3 rounded-[18px] bg-white p-2.5 shadow-[0_1px_0_rgba(35,26,20,0.06)]" data-testid="post-recipe">
                      {it.recipe.imageUrl ? (
                        <img src={it.recipe.imageUrl} alt="" width={64} height={64} loading="lazy" className="h-16 w-16 shrink-0 rounded-[12px] object-cover" />
                      ) : (
                        <span aria-hidden="true" className="h-16 w-16 shrink-0 rounded-[12px] bg-panel" />
                      )}
                      <span className="min-w-0">
                        <span className="line-clamp-2 block text-[16px] font-semibold leading-snug text-ink">{it.recipe.title}</span>
                        <span className="block text-[13px] text-muted">
                          {it.recipe.minutes !== null ? `${it.recipe.minutes} min · ` : ""}by {it.author.name}
                        </span>
                      </span>
                    </Link>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setOpenId(open ? null : it.id);
                      setReporting(null);
                    }}
                    className={[
                      "min-w-0 break-words [overflow-wrap:anywhere] rounded-[18px] px-3.5 py-2 text-left text-[16px] leading-snug shadow-[0_1px_0_rgba(35,26,20,0.06)]",
                      it.mine ? "rounded-br-[6px] bg-basil-soft text-ink" : "rounded-bl-[6px] bg-white text-ink",
                      it.state === "review" ? "border border-dashed border-saffron" : "",
                    ].join(" ")}
                  >
                    {!it.mine && <span className="block text-[13px] font-semibold uppercase tracking-wide text-tomato" data-testid="post-author">{it.author.name}</span>}
                    {it.replyTo && (
                      <span className="mb-1 block min-w-0 rounded-md border-l-2 border-saffron bg-ink/5 px-2 py-1 text-[13px] text-muted">
                        <span className="font-semibold text-ink">{it.replyTo.name}</span>
                        <span className="block truncate">{it.replyTo.text}</span>
                      </span>
                    )}
                    {it.photoId && (
                      <img
                        src={`/api/community/photo/${it.photoId}`}
                        alt=""
                        loading="lazy"
                        width={it.photoW ?? undefined}
                        height={it.photoH ?? undefined}
                        className="mb-1 block max-h-[320px] w-auto max-w-full rounded-[12px] object-cover"
                        data-testid="post-photo"
                      />
                    )}
                    {it.text && <span className="whitespace-pre-line" data-testid="post-text-body">{it.text}</span>}
                    <span className="mt-0.5 flex items-center justify-end gap-2 text-[13px] text-muted">
                      {it.kind === "post" && it.hearts > 0 && <span>♥ {it.hearts}</span>}
                      <span>{it.state === "review" ? "Mama’s reading it" : clock(it.createdAt)}</span>
                    </span>
                  </button>
                  {open && (
                    <div className={`flex flex-wrap gap-1.5 ${it.mine ? "justify-end" : ""}`} data-testid="bubble-actions">
                      {it.kind === "post" && (
                        <button type="button" onClick={() => void heart(it)} aria-pressed={it.hearted} className={`min-h-10 rounded-full border px-3 text-[14px] font-semibold ${it.hearted ? "border-tomato text-tomato" : "border-ink/20 text-ink"}`} data-testid="heart">
                          ♥ {it.hearts}
                        </button>
                      )}
                      {canWrite && (
                        <button type="button" onClick={() => { setReplyTo(it); setOpenId(null); document.getElementById("post-text")?.focus(); }} className="min-h-10 rounded-full border border-ink/20 px-3 text-[14px] font-semibold text-ink" data-testid="reply">
                          Reply
                        </button>
                      )}
                      {it.mine ? (
                        <button type="button" onClick={() => void remove(it)} className="min-h-10 rounded-full border border-ink/20 px-3 text-[14px] font-semibold text-muted" data-testid="post-delete">
                          Delete
                        </button>
                      ) : (
                        <button type="button" onClick={() => setReporting(reporting === it.id ? null : it.id)} className="min-h-10 rounded-full border border-ink/20 px-3 text-[14px] font-semibold text-muted" data-testid="post-report">
                          Report
                        </button>
                      )}
                    </div>
                  )}
                  {reporting === it.id && (
                    <div className="flex flex-wrap gap-1.5" data-testid="report-reasons">
                      {REASONS.map((r) => (
                        <button key={r} type="button" onClick={() => void reportIt(it, r)} className="min-h-10 rounded-full bg-paper px-3 text-[14px] font-semibold text-ink ring-1 ring-ink/15">
                          {r}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </li>
          );
        })}
        {items.length === 0 && (
          <li className="py-10 text-center font-hand text-[26px] leading-tight text-ink" data-testid="feed-empty">
            Nobody’s sat down yet. Say hi.
          </li>
        )}
        <div ref={endRef} />
      </ol>

      {note && (
        <p role="status" data-testid="community-note" className="rounded-2xl bg-saffron-soft px-4 py-3 text-[16px] text-ink">
          {note}
        </p>
      )}

      {/* Fixed to the bottom of the screen (above the bar on phones) so it never floats mid-page when the room is quiet. */}
      <div className="fixed inset-x-0 bottom-[calc(56px+env(safe-area-inset-bottom))] z-20 border-t border-line bg-paper/95 backdrop-blur lg:bottom-0 lg:left-[264px]">
        <div className="mx-auto w-full max-w-[720px] px-4 pb-3 pt-2 lg:px-10" data-testid="composer-bar">
        {me ? (
          <div className="relative grid gap-2" data-testid="composer">
            {replyTo && (
              <div className="flex items-center justify-between gap-3 rounded-xl bg-ink/5 px-3 py-1.5 text-[13px]">
                <span className="truncate">
                  Replying to <span className="font-semibold">{replyTo.author.name}</span>: {replyTo.text}
                </span>
                <button type="button" onClick={() => setReplyTo(null)} className="min-h-9 shrink-0 font-semibold text-muted" aria-label="Cancel reply">✕</button>
              </div>
            )}
            <div className="flex items-end gap-2">
              {!replyTo && <PhotoPicker disabled={!canWrite || busy} photo={photo} onPhoto={setPhoto} onNote={setNote} onBusy={setUploading} />}
              {!replyTo && (
                <button
                  type="button"
                  onClick={() => setSharing(true)}
                  disabled={!canWrite || busy}
                  aria-label="Share a recipe"
                  data-testid="share-recipe-button"
                  className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-basil-soft text-basil-text transition-transform duration-150 active:scale-[0.97] disabled:opacity-40"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M3 11h18a9 9 0 0 1-18 0z" />
                    <path d="M8 7c0-1.5 1-2 1-3.5M12 7c0-1.5 1-2 1-3.5" />
                  </svg>
                </button>
              )}
              <textarea
                id="post-text"
                value={draft}
                onChange={(e) => setDraft(e.target.value.slice(0, replyTo ? 300 : 500))}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && hasContent && !uploading) {
                    e.preventDefault();
                    void send();
                  }
                }}
                rows={1}
                enterKeyHint="send"
                placeholder={canWrite ? `What’s cooking, ${me.name.split(" ")[0]}?` : "Reading along for now"}
                disabled={!canWrite || busy}
                className="max-h-32 min-h-12 flex-1 resize-none rounded-[22px] border border-line bg-white px-4 py-3 text-[16px] leading-snug text-ink placeholder:text-muted"
                data-testid="post-text"
              />
              <button
                type="button"
                onClick={() => void send()}
                disabled={!canWrite || busy || uploading || !hasContent}
                data-testid="post-send"
                aria-label="Send"
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-tomato text-white transition-transform duration-150 active:scale-[0.97] disabled:opacity-40"
              >
                {busy ? (
                  <span aria-hidden="true">…</span>
                ) : (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M12 19V5M5 12l7-7 7 7" />
                  </svg>
                )}
              </button>
            </div>
          </div>
        ) : (
          <div className="grid gap-2" data-testid="name-form">
            <label className="font-hand text-[26px] leading-none text-ink" htmlFor="table-name">
              What should the table call you?
            </label>
            <div className="flex gap-2">
              <input
                id="table-name"
                value={name}
                onChange={(e) => setName(e.target.value.slice(0, 24))}
                maxLength={24}
                placeholder="A first name or a nickname"
                className="min-h-12 flex-1 rounded-full border border-line bg-white px-4 text-[16px] text-ink"
                data-testid="table-name"
              />
              <Button size="md" onClick={() => void saveName()} disabled={busy || name.trim().length < 2} data-testid="table-name-save">
                That’s me
              </Button>
            </div>
          </div>
        )}
        </div>
      </div>
      {/* Outside the blurred composer bar: backdrop-filter would otherwise trap this fixed sheet inside it. */}
      {sharing && <ShareRecipeSheet onClose={() => setSharing(false)} onPick={(id) => void shareRecipe(id)} />}
    </Frame>
  );
}

function Frame({ children, pinned }: { children: React.ReactNode; pinned?: React.ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col gap-3">
      <header className="grid gap-1">
        <h1 className="text-[28px] leading-tight">The table</h1>
        <p className="text-[16px] leading-snug text-muted" data-testid="table-description">
          One room for everyone cooking with Mama. Say how the week went, ask when something flops, cheer each other on. Tap a message to heart it or reply.
        </p>
      </header>
      {pinned}
      {children}
    </div>
  );
}
