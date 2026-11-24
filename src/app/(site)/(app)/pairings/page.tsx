import { PairingsPage } from "@/components/pairings/PairingsPage";

export default async function Page({ searchParams }: { searchParams: Promise<{ recipe?: string }> }) {
  const { recipe } = await searchParams;
  return <PairingsPage initialRecipeId={typeof recipe === "string" && recipe.length <= 120 ? recipe : undefined} />;
}
