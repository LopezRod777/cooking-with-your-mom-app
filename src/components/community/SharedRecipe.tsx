"use client";

/* Recipe photos come from Blob or source sites, so they are plain <img> tags. */
/* eslint-disable @next/next/no-img-element */

import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "../ui/Button";
import { BasedOn } from "../recipe/BasedOn";
import { isFavorite, toggleFavorite } from "@/lib/favorites";
import { Recipe } from "@/lib/schemas";
import { saveState } from "@/lib/store";
import { flowStep } from "@/lib/stepText";
import { useAppState } from "@/lib/useAppState";

type Status = "loading" | "missing" | "error" | "ready";

// One recipe from the table. Saving it copies it into my favorites under a `shared-<id>` key, so it stays
// separate from anything I cook from my own plan.
export function SharedRecipe({ id }: { id: string }) {
  const { isLoaded } = useAuth();
  const [state, setState, hydrated] = useAppState();
  const [status, setStatus] = useState<Status>("loading");
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [author, setAuthor] = useState("");

  useEffect(() => {
    if (!isLoaded) return;
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/community/recipes/${id}`, { cache: "no-store" });
        if (res.status === 404) return setStatus("missing");
        if (!res.ok) return setStatus("error");
        const j = (await res.json()) as { recipe?: unknown; author?: { name?: unknown } };
        const parsed = Recipe.safeParse(j.recipe);
        if (!parsed.success) return setStatus("missing");
        setRecipe(parsed.data);
        setAuthor(typeof j.author?.name === "string" ? j.author.name : "");
        setStatus("ready");
      } catch {
        setStatus("error");
      }
    }, 0);
    return () => clearTimeout(t);
  }, [isLoaded, id]);

  if (status === "loading") {
    return <div className="mx-auto w-full max-w-[720px] px-4 py-10 text-[17px] text-muted lg:px-10">Setting the table…</div>;
  }
  if (status === "missing" || !recipe) {
    return (
      <div className="mx-auto grid w-full max-w-[720px] gap-4 px-4 py-10 lg:px-10">
        <h1 className="font-display text-[34px] leading-tight">Mama can&apos;t find that one anymore.</h1>
        <Link href="/community" className="inline-flex min-h-12 w-fit items-center justify-center rounded-full border border-ink/25 bg-paper px-6 text-[18px] font-semibold text-ink">
          Back to the table
        </Link>
      </div>
    );
  }
  if (status === "error") {
    return <div className="mx-auto w-full max-w-[720px] px-4 py-10 text-[17px] text-muted lg:px-10">That didn&apos;t go through. Try again in a minute.</div>;
  }

  const sharedId = `shared-${id}`;
  const saved = isFavorite(state, sharedId);
  const minutes = recipe.prepMinutes + recipe.cookMinutes;

  function save() {
    if (!recipe) return;
    const next = toggleFavorite(state, { ...recipe, id: sharedId });
    setState(next);
    saveState(next);
  }

  return (
    <article className="mx-auto grid w-full max-w-[720px] gap-6 px-4 pb-24 pt-6 lg:px-10">
      {recipe.imageUrl && <img src={recipe.imageUrl} alt={recipe.title} className="aspect-[4/3] w-full rounded-[18px] object-cover" />}

      <header className="grid gap-1">
        <h1 className="font-display text-[28px] leading-tight">{recipe.title}</h1>
        {author && <p className="text-[16px] text-muted">by {author}</p>}
        <BasedOn source={recipe.source} />
        <p className="text-[13px] text-muted">
          {minutes} min · {recipe.servings} {recipe.servings === 1 ? "serving" : "servings"}
        </p>
      </header>

      <Button size="lg" fullWidth onClick={save} disabled={!hydrated || saved} data-testid="save-shared">
        {saved ? "Saved" : "Save to my favorites"}
      </Button>

      <section className="grid gap-3">
        <h2 className="font-display text-[22px] leading-tight">Ingredients</h2>
        <ul className="grid gap-2">
          {recipe.ingredients.map((g, i) => (
            <li key={`${g.key}-${i}`} className="flex items-baseline justify-between gap-3 border-b border-line pb-2 text-[16px]">
              <span>{g.display}</span>
              <span className="shrink-0 text-[13px] text-muted">{Math.round(g.grams)} g</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="grid gap-3">
        <h2 className="font-display text-[22px] leading-tight">Steps</h2>
        <ol className="grid list-decimal gap-3 pl-5 text-[16px] leading-snug">
          {recipe.steps.map((s, i) => (
            <li key={i}>{flowStep(s.text)}</li>
          ))}
        </ol>
      </section>

      {recipe.momTip && (
        <div className="grid gap-1 rounded-2xl bg-note p-4 text-note-ink">
          <p className="font-hand text-[24px] leading-none">Mama&apos;s tip</p>
          <p className="text-[16px] leading-snug">{recipe.momTip}</p>
        </div>
      )}

      <Link href="/community" className="inline-flex min-h-12 w-fit items-center justify-center rounded-full border border-ink/25 bg-paper px-6 text-[18px] font-semibold text-ink">
        Back to the table
      </Link>
    </article>
  );
}
