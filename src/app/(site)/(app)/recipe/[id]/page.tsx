import { Suspense } from "react";
import { RecipeView } from "@/components/recipe/RecipeView";

// The recipe id is only known at request time (it comes from the user's plan), and the
// root AppShell reads the pathname. Blocking prerender avoids the CLIENT_HOOK_DYNAMIC build error.

export default function RecipePage() {
  return (
    <Suspense fallback={<div className="min-h-[60vh]" aria-hidden="true" />}>
      <RecipeView />
    </Suspense>
  );
}
