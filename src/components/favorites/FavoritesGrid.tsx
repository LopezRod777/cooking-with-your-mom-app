"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAppState } from "@/lib/useAppState";
import { useDishImages } from "@/lib/images/useDishImages";
import { perServing } from "@/lib/nutrition";
import { toggleFavorite } from "@/lib/favorites";
import type { Recipe } from "@/lib/schemas";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { DishPhoto } from "@/components/ui/DishPhoto";

const addLinkBase =
  "inline-flex h-12 items-center justify-center rounded-full border border-ink/25 bg-paper px-6 text-[18px] font-semibold text-ink";
const addLinkSmall = `${addLinkBase} px-4 text-[16px]`;

export function FavoritesGrid() {
  const [state, setState, hydrated] = useAppState();
  useDishImages(state, setState, hydrated);
  const router = useRouter();
  if (!hydrated) return null;

  const recipes = state.favorites
    .map((id) => state.favoriteRecipes[id])
    .filter((r): r is Recipe => Boolean(r));

  const context = recipes.length === 0
    ? "Recipes you keep, one tap away."
    : `${recipes.length} ${recipes.length === 1 ? "recipe" : "recipes"} saved. Mama works the ones that fit your diet into your week.`;

  if (recipes.length === 0) {
    return (
      <div className="grid gap-6">
        <header className="grid gap-3">
          <div className="flex items-start justify-between gap-4">
            <h1 className="text-[40px] leading-tight">Favorites</h1>
            <Link href="/import" className={addLinkSmall}>
              Add from a link
            </Link>
          </div>
          <p className="text-[18px] text-muted">{context}</p>
        </header>
        <Card className="grid gap-5">
          <div className="relative aspect-[4/3] w-full overflow-hidden rounded-[20px]">
            <Image src="/media/kitchen-hands.jpg" alt="" fill sizes="(min-width: 768px) 720px, 100vw" className="object-cover" />
          </div>
          <p className="text-[20px]">No favorites yet. Tap the heart on any recipe.</p>
          <Link href="/import" className={`${addLinkBase} w-full`}>
            Add from a link
          </Link>
          <Button variant="ghost" fullWidth onClick={() => router.push("/")}>
            Back to my week
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="grid gap-6">
      <header className="grid gap-3">
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-[40px] leading-tight">Favorites</h1>
          <Link href="/import" className={addLinkSmall}>
            Add from a link
          </Link>
        </div>
        <p className="text-[18px] text-muted">{context}</p>
      </header>
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {recipes.map((recipe) => {
          const protein = Math.round(perServing(recipe)?.protein_g ?? 0);
          const minutes = recipe.prepMinutes + recipe.cookMinutes;
          return (
            <li key={recipe.id} className="relative">
              <Link
                href={`/recipe/${recipe.id}`}
                className="block overflow-hidden rounded-[24px] border border-line bg-paper"
              >
                <div className="relative aspect-[4/3] w-full">
                  <DishPhoto recipe={recipe} sizes="(min-width: 640px) 50vw, 100vw" />
                </div>
                <div className="grid gap-1 p-5">
                  <h2 className="font-display text-[24px] leading-tight">{recipe.title}</h2>
                  <p className="text-[17px] text-muted">
                    {protein} g protein · {minutes} min
                  </p>
                </div>
              </Link>
              <button
                type="button"
                aria-label={`Remove ${recipe.title} from favorites`}
                onClick={() => setState((prev) => toggleFavorite(prev, recipe))}
                className="absolute right-3 top-3 grid h-12 w-12 place-items-center rounded-full bg-paper/95 text-tomato shadow-md"
              >
                <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
                  <path d="M12 20.5s-7.5-4.6-7.5-10.1A4.1 4.1 0 0 1 12 7.8a4.1 4.1 0 0 1 7.5 2.6c0 5.5-7.5 10.1-7.5 10.1z" />
                </svg>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
