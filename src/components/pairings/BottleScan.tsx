"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { DishPhoto } from "@/components/ui/DishPhoto";
import { btnGhost, btnPrimary } from "@/components/week/classes";
import { SLOT_LABELS } from "@/components/week/plan-utils";
import { heicToJpeg, looksLikeHeic } from "@/lib/pets/heic";
import {
  BOTTLE_MAX_RECIPES,
  BOTTLE_NAME_RE,
  planFingerprint,
  servedRecipeIds,
  styleChoices,
  type BottleResult,
  type Fit,
} from "@/lib/pairings/bottle";
import { avoidReasonById, cocktailById, otherById, principleById, wineById, type Cocktail } from "@/lib/pairings/vocab";
import { CocktailGlass, GLASS_LABEL } from "./CocktailGlass";
import type { Recipe, WeekPlan } from "@/lib/schemas";
import { clearBottleResult, getBottleClearCount, setBottleResult, useBottleResult, type BottleScanData } from "./bottleResult";
import { refresh } from "./usePairingsGate";

const own = <T,>(map: Record<string, T> | undefined, key: string): T | undefined =>
  map && Object.prototype.hasOwnProperty.call(map, key) ? map[key] : undefined;

// The photo is sent as one JPEG; the label has to stay readable, so the longest side is 1024 px.
const MAX_SIDE = 1024;
const QUALITY = 0.8;
const QUALITY_SMALL = 0.6;
// base64 characters (about 675 KB of JPEG). The server refuses past 1.2 MB of body.
const MAX_BASE64 = 900_000;

const ERROR_COPY: Record<string, string> = {
  locked: "Pairings are locked.",
  no_plan: "Plan your week first.",
  plan_changed: "Your week changed; scan again.",
  busy: "Mama is still on your last one; give it a second.",
  too_large: "That photo is too big.",
  unsupported_type: "That file isn't a photo we can read.",
  invalid_image: "That file isn't a photo we can read.",
  cant_read_label: "Mama can't read that label. Type what it is.",
  unknown_drink: "I don't know that one. Try the style, like 'reposado tequila'.",
  quota: "That's 10 bottles today; more tomorrow.",
};
const FALLBACK_ERROR = "Mama couldn't do that one. Try again.";

const GROUPS: { fit: Fit; testId: string; title: string }[] = [
  { fit: "great", testId: "bottle-group-great", title: "Great with" },
  { fit: "fine", testId: "bottle-group-fine", title: "Fine with" },
  { fit: "skip", testId: "bottle-group-skip", title: "Skip with" },
];

type Input = { kind: "image"; file: File } | { kind: "text"; text: string };
type Fits = BottleResult["fits"];

// Draws the image inside a max-side box and encodes it as JPEG. Browser only.
async function drawJpeg(source: Blob, maxSide: number, quality: number): Promise<Blob> {
  const bitmap = await createImageBitmap(source);
  try {
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas is not available");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (!blob) throw new Error("could not encode the photo");
    return blob;
  } finally {
    bitmap.close();
  }
}

// iPhone photos may be HEIC, which some browsers cannot decode: convert them first, then retry once.
async function resizeToJpeg(file: File, quality: number): Promise<Blob> {
  try {
    return await drawJpeg(file, MAX_SIDE, quality);
  } catch (err) {
    if (!looksLikeHeic(file)) throw err;
    return drawJpeg(await heicToJpeg(file), MAX_SIDE, quality);
  }
}

function readAsBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result ?? "");
      resolve(url.slice(url.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error("could not read the photo"));
    reader.readAsDataURL(blob);
  });
}

// Returns the base64 body for the request, or null when even the smaller copy is too big.
async function encodePhoto(file: File): Promise<string | null> {
  const first = await readAsBase64(await resizeToJpeg(file, QUALITY));
  if (first.length <= MAX_BASE64) return first;
  const second = await readAsBase64(await resizeToJpeg(file, QUALITY_SMALL));
  return second.length <= MAX_BASE64 ? second : null;
}

type Reply = { ok: true; data: Omit<BottleScanData, "fingerprint" | "input"> } | { ok: false; error: string; status: number };

async function postBottle(body: { image?: string; text?: string; planFingerprint: string }): Promise<Reply> {
  let res: Response;
  try {
    res = await fetch("/api/pair/bottle", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, error: "", status: 0 };
  }
  const json = (await res.json().catch(() => null)) as
    | { result?: BottleResult; serve?: string; servedIds?: string[]; error?: string }
    | null;
  if (res.ok && json?.result && typeof json.serve === "string" && Array.isArray(json.servedIds)) {
    return { ok: true, data: { result: json.result, serve: json.serve, servedIds: json.servedIds } };
  }
  return { ok: false, error: json?.error ?? "", status: res.status };
}

export function BottleScan({ plan, sessionId }: { plan: WeekPlan | null; sessionId: string }) {
  const served = servedRecipeIds(plan);
  const hasPlan = served.length > 0;
  const saved = useBottleResult(sessionId);

  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  // A bare spirit ("tequila") offers its styles instead of guessing one.
  const [choices, setChoices] = useState<readonly string[] | null>(null);
  const textRef = useRef<HTMLInputElement>(null);
  // Latest plan, read when a reply arrives (the request may outlive a swap).
  const planRef = useRef(plan);
  useEffect(() => {
    planRef.current = plan;
  }, [plan]);

  // Sends one request. Input is either a photo or typed text; fingerprint is taken from the plan at send time.
  async function run(input: Input) {
    if (busyRef.current) return;
    const currentPlan = planRef.current;
    const ids = servedRecipeIds(currentPlan);
    if (ids.length === 0) {
      setError(ERROR_COPY.no_plan);
      return;
    }
    const fp = planFingerprint(ids);
    // A lock (local or remote) while the request is in flight clears the store; a reply after that must not restore anything.
    const clearsAtStart = getBottleClearCount();
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      let body: { image?: string; text?: string; planFingerprint: string };
      if (input.kind === "image") {
        let image: string | null;
        try {
          image = await encodePhoto(input.file);
        } catch {
          setError(ERROR_COPY.invalid_image);
          return;
        }
        if (image === null) {
          setError(ERROR_COPY.too_large);
          return;
        }
        body = { image, planFingerprint: fp };
      } else {
        body = { text: input.text, planFingerprint: fp };
      }
      const reply = await postBottle(body);
      if (getBottleClearCount() !== clearsAtStart) return;
      if (!reply.ok) {
        if (reply.status === 403) void refresh();
        if (reply.status === 422 && reply.error === "cant_read_label") textRef.current?.focus();
        // The server saw a different week than the verdicts on screen: drop them.
        if (reply.error === "plan_changed") clearBottleResult();
        setError(ERROR_COPY[reply.error] ?? FALLBACK_ERROR);
        return;
      }
      // A swap while the request was in flight changes the fingerprint: the verdicts no longer match the week.
      const nowFp = planFingerprint(servedRecipeIds(planRef.current));
      if (nowFp !== fp) {
        // The verdicts on screen were for the old week: drop them with the error.
        clearBottleResult();
        setError(ERROR_COPY.plan_changed);
        return;
      }
      setBottleResult(sessionId, {
        ...reply.data,
        fingerprint: fp,
        input: input.kind === "image" ? { kind: "image" } : { kind: "text", text: input.text },
      });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  function onPhotoPicked(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    void run({ kind: "image", file });
  }

  function onTextCheck() {
    const clean = text.trim();
    if (!clean) return;
    const options = styleChoices(clean);
    if (options) {
      setError(null);
      setChoices(options);
      return;
    }
    setChoices(null);
    void run({ kind: "text", text: clean });
  }

  function pickStyle(id: string) {
    const name = otherById.get(id)?.name;
    if (!name) return;
    setChoices(null);
    setText(name);
    void run({ kind: "text", text: name });
  }

  if (!plan || !hasPlan) {
    return (
      <section data-testid="bottle-scan" aria-labelledby="bottle-title" className="grid gap-3 rounded-2xl border border-line px-5 py-5">
        <h2 id="bottle-title" className="text-[28px] leading-tight">
          What&apos;s this bottle?
        </h2>
        <p className="text-[18px] text-muted">
          <Link href="/" className="underline underline-offset-4">
            Plan your week first.
          </Link>
        </p>
      </section>
    );
  }

  return (
    <section data-testid="bottle-scan" aria-labelledby="bottle-title" className="grid gap-5 rounded-2xl border border-line px-5 py-5">
      <div className="grid gap-2">
        <h2 id="bottle-title" className="text-[28px] leading-tight">
          What&apos;s this bottle?
        </h2>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className={`${btnPrimary} cursor-pointer has-[:disabled]:opacity-40 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ink`}>
          Photo of the label
          <input
            type="file"
            accept="image/*"
            data-testid="bottle-photo-input"
            className="sr-only"
            disabled={busy}
            onChange={onPhotoPicked}
          />
        </label>
      </div>

      <div className="grid gap-3">
        <label htmlFor="bottle-text" className="text-[18px] font-semibold text-ink">
          Or type it
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <input
            id="bottle-text"
            ref={textRef}
            data-testid="bottle-text-input"
            type="text"
            maxLength={60}
            value={text}
            placeholder="Casamigos reposado"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onTextCheck();
            }}
            className="min-h-12 min-w-0 flex-1 rounded-full border border-ink/25 bg-white px-5 text-[18px] text-ink outline-none focus:outline focus:outline-3 focus:outline-offset-3 focus:outline-saffron"
          />
          <button
            type="button"
            data-testid="bottle-check"
            disabled={busy || !text.trim()}
            onClick={onTextCheck}
            className={`${btnGhost} disabled:opacity-40`}
          >
            Check
          </button>
        </div>
      </div>

      {choices && (
        <div data-testid="bottle-choices" role="group" aria-label="Which one?" className="grid gap-2">
          <p className="text-[18px] font-semibold text-ink">Which one?</p>
          <div className="flex flex-wrap gap-2">
            {choices.map((id) => {
              const name = otherById.get(id)?.name;
              return name ? (
                <button
                  key={id}
                  type="button"
                  disabled={busy}
                  onClick={() => pickStyle(id)}
                  className="min-h-12 rounded-full border border-ink/25 bg-white px-5 text-[17px] font-semibold text-ink transition-transform duration-150 active:scale-[0.97] disabled:opacity-40"
                >
                  {name}
                </button>
              ) : null;
            })}
          </div>
        </div>
      )}

      {busy && (
        <p data-testid="bottle-busy" role="status" className="text-[18px] text-muted">
          Mama is reading the label…
        </p>
      )}
      {error && (
        <p role="alert" className="text-[18px] leading-snug text-ink">
          {error}
        </p>
      )}

      {saved && (
        <BottleResultView
          key={saved.fingerprint + saved.result.drink.name + saved.serve}
          data={saved}
          plan={plan}
          onCheckName={(name) => void run({ kind: "text", text: name })}
          busy={busy}
        />
      )}
    </section>
  );
}

function BottleResultView({
  data,
  plan,
  onCheckName,
  busy,
}: {
  data: BottleScanData;
  plan: WeekPlan;
  onCheckName: (name: string) => void;
  busy: boolean;
}) {
  const { drink } = data.result;
  const [name, setName] = useState(drink.name);
  const [localError, setLocalError] = useState<string | null>(null);
  const styleName = drink.styleId ? (wineById.get(drink.styleId)?.name ?? otherById.get(drink.styleId)?.name) : undefined;
  const stale = planFingerprint(servedRecipeIds(plan)) !== data.fingerprint;
  const distinct = new Set(plan.days.flatMap((d) => d.meals.map((m) => m.recipeId))).size;

  function checkAgain() {
    const clean = name.trim();
    if (!BOTTLE_NAME_RE.test(clean)) {
      setLocalError("Letters and numbers only.");
      return;
    }
    setLocalError(null);
    onCheckName(clean);
  }

  const cocktails = (data.result.cocktails ?? [])
    .map((c) => {
      const cocktail = cocktailById.get(c.id);
      return cocktail ? { cocktail, recipe: c.recipeId ? own(plan.recipes, c.recipeId) : undefined } : null;
    })
    .filter((x): x is { cocktail: NonNullable<typeof x>["cocktail"]; recipe: Recipe | undefined } => x !== null);

  const GROUP_LIST = (
    <>
      {cocktails.length > 0 && (
        <section data-testid="bottle-cocktails" className="grid gap-3">
          <h3 className="font-display text-[24px] text-ink">Make it a cocktail</h3>
          <ul className="grid gap-3 md:grid-cols-2">
            {cocktails.map(({ cocktail, recipe }) => (
              <li
                key={cocktail.id}
                data-testid="bottle-cocktail"
                className="grid gap-3 rounded-[22px] border border-line bg-panel p-4"
              >
                <div className="flex items-start gap-4">
                  <CocktailPhoto id={cocktail.id} name={cocktail.name} glass={cocktail.glass} tone={cocktail.tone} />
                  <div className="grid min-w-0 flex-1 gap-1">
                    <span className="font-display text-[24px] leading-tight text-ink">{cocktail.name}</span>
                    <p className="text-[16px] leading-snug text-ink">{cocktail.mix}</p>
                    {recipe ? (
                      <p className="text-[15px] text-muted">
                        Goes with{" "}
                        <Link href={`/recipe/${encodeURIComponent(recipe.id)}`} className="font-semibold text-ink underline underline-offset-4">
                          {recipe.title}
                        </Link>
                      </p>
                    ) : (
                      <p className="text-[15px] text-muted">{cocktail.food}</p>
                    )}
                  </div>
                </div>
                <details className="group rounded-2xl bg-paper px-4 py-3">
                  <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between text-[17px] font-semibold text-ink [&::-webkit-details-marker]:hidden">
                    How to make it
                    <span aria-hidden="true" className="text-[14px] text-muted group-open:hidden">Show</span>
                    <span aria-hidden="true" className="hidden text-[14px] text-muted group-open:inline">Hide</span>
                  </summary>
                  <div className="grid gap-3 pb-1 pt-2" data-testid="cocktail-recipe">
                    <p className="text-[14px] font-semibold uppercase tracking-wide text-muted">{GLASS_LABEL[cocktail.glass]} · 1 drink</p>
                    <ul className="grid gap-1 text-[16px] leading-snug text-ink">
                      {cocktail.recipe.ingredients.map((line) => (
                        <li key={line} className="flex gap-2">
                          <span aria-hidden="true" className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-saffron" />
                          {line}
                        </li>
                      ))}
                    </ul>
                    <ol className="grid gap-2 text-[16px] leading-snug text-ink" data-testid="cocktail-steps">
                      {cocktail.recipe.steps.map((step, i) => (
                        <li key={step} className="flex gap-3">
                          <span className="font-display text-[20px] leading-none text-tomato">{i + 1}</span>
                          <span>{step}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                </details>
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className="text-[16px] text-muted">
        {cocktails.length > 0 ? "Or on its own: " : ""}
        {data.serve}
      </p>
      {GROUPS.map((group) => {
        const rendered = data.result.fits
          .filter((f) => f.fit === group.fit)
          .map((f) => {
            const recipe: Recipe | undefined = own(plan.recipes, f.recipeId);
            return recipe ? { fit: f, recipe } : null;
          })
          .filter((x): x is { fit: Fits[number]; recipe: Recipe } => x !== null);
        // Fine and skip hide when empty; great shows the "nothing sings" line instead.
        if (rendered.length === 0 && group.fit !== "great") return null;
        return (
          <section key={group.fit} data-testid={group.testId} aria-label={group.title} className="grid gap-3">
            <h3 className="text-[22px] leading-tight">{group.title}</h3>
            {rendered.length === 0 ? (
              <p className="text-[18px] text-muted">Nothing this week sings with it; here&apos;s what works.</p>
            ) : (
              <ul className="grid gap-3 sm:grid-cols-2">
                {rendered.map(({ fit, recipe }) => {
                  const principle = principleById.get(fit.principleId);
                  const avoid = fit.avoidReasonId ? avoidReasonById.get(fit.avoidReasonId) : undefined;
                  return (
                    <li
                      key={recipe.id}
                      data-testid="bottle-item"
                      className="flex gap-3 rounded-2xl border border-line px-4 py-3"
                    >
                      <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-line">
                        <DishPhoto recipe={recipe} sizes="56px" />
                      </div>
                      <div className="grid min-w-0 flex-1 gap-1">
                        <div className="grid gap-0.5">
                          <span className="text-[18px] font-semibold text-ink">{recipe.title}</span>
                          <span className="text-[15px] text-muted">{SLOT_LABELS[recipe.slot]}</span>
                        </div>
                        {fit.why ? (
                          <>
                            <p data-testid="bottle-why" className="text-[16px] leading-snug text-ink">
                              {fit.why}
                            </p>
                            {principle && (
                              <p className="text-[15px] leading-snug text-muted">
                                {principle.label}
                                {fit.fit === "skip" && avoid ? ` · ${avoid.text}` : ""}
                              </p>
                            )}
                          </>
                        ) : (
                          <>
                            {principle && (
                              <p className="text-[16px] leading-snug text-ink">
                                <strong className="font-semibold">{principle.label}.</strong> {principle.text}
                              </p>
                            )}
                            {fit.fit === "skip" && avoid && <p className="text-[16px] leading-snug text-muted">{avoid.text}</p>}
                          </>
                        )}
                        <div className="flex flex-wrap gap-4 pt-1">
                          <Link href={`/recipe/${encodeURIComponent(recipe.id)}`} className="inline-flex min-h-12 items-center text-[17px] font-semibold text-ink underline underline-offset-4">
                            Open recipe
                          </Link>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}
    </>
  );

  return (
    <div data-testid="bottle-result" className="grid gap-5 border-t border-line pt-5">
      <div className="grid gap-3">
        <label htmlFor="bottle-name" className="text-[18px] font-semibold text-ink">
          Looks like:
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <input
            id="bottle-name"
            data-testid="bottle-name"
            defaultValue={drink.name}
            maxLength={40}
            onChange={(e) => setName(e.target.value)}
            className="min-h-12 min-w-0 flex-1 rounded-full border border-ink/25 bg-white px-5 text-[18px] text-ink outline-none focus:outline focus:outline-3 focus:outline-offset-3 focus:outline-saffron"
          />
          <span className="inline-flex min-h-12 items-center rounded-full bg-saffron-soft px-4 text-[16px] text-ink">
            {styleName ? `${drink.kind} · ${styleName}` : drink.kind}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            data-testid="bottle-recheck"
            disabled={busy}
            onClick={checkAgain}
            className={`${btnGhost} disabled:opacity-40`}
          >
            Check again
          </button>
          <span className="text-[16px] text-muted">Not it? Fix the name and tap Check again.</span>
        </div>
        {localError && (
          <p role="alert" className="text-[18px] leading-snug text-ink">
            {localError}
          </p>
        )}
        {stale && <p className="text-[17px] text-muted">Your week changed; scan again.</p>}
      </div>
      {/* Verdicts were for another week: the header stays so the name can be re-checked, the groups do not. */}
      {stale ? null : GROUP_LIST}


      {data.servedIds.length === BOTTLE_MAX_RECIPES && distinct > BOTTLE_MAX_RECIPES && (
        <p className="text-[16px] text-muted">Your first {BOTTLE_MAX_RECIPES} meals.</p>
      )}
    </div>
  );
}

// The drawn glass stands in until the photo loads, and stays if there is none.
function CocktailPhoto({ id, name, glass, tone }: { id: string; name: string; glass: Cocktail["glass"]; tone: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="relative h-[88px] w-[88px] shrink-0 overflow-hidden rounded-2xl bg-paper text-ink/80">
      {!failed && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/media/cocktails/${id}.jpg`}
          alt={name}
          width={88}
          height={88}
          loading="lazy"
          data-testid="cocktail-photo"
          onError={() => setFailed(true)}
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
      {failed && (
        <span className="flex h-full w-full items-center justify-center">
          <CocktailGlass shape={glass} tone={tone} size={48} />
        </span>
      )}
    </span>
  );
}
