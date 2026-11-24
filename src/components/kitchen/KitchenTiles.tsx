"use client";

import { type Kitchen, type KitchenTool, KITCHEN_TOOLS } from "@/lib/schemas";
import { ChoiceTile } from "../ui/Choice";

export const KITCHEN_LABELS: Record<KitchenTool, string> = {
  stove: "Stove",
  oven: "Oven",
  microwave: "Microwave",
  airFryer: "Air fryer",
  blender: "Blender",
  toaster: "Toaster",
  riceCooker: "Rice cooker",
  multiCooker: "Instant Pot",
};

export function KitchenTiles({ value, onChange }: { value: Kitchen; onChange: (next: Kitchen) => void }) {
  return (
    <div role="group" aria-label="Kitchen tools" className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
      {KITCHEN_TOOLS.map((tool) => (
        <ChoiceTile
          key={tool}
          data-tool={tool}
          selected={value[tool]}
          onClick={() => onChange({ ...value, [tool]: !value[tool] })}
        >
          {KITCHEN_LABELS[tool]}
        </ChoiceTile>
      ))}
    </div>
  );
}
