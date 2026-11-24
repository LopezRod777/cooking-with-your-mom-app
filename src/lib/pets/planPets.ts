import type { Pet } from "../schemas";
import { blockedReason } from "./restrictions";

export type PlanPetWire = { name: string; species: Pet["species"] };

// Pets sent with plan, swap and my-version requests: name and species only; a pet whose extras are
// blocked by a medical or "other" restriction has nothing to share, so it is left out.
export const planPets = (pets: Pet[]): PlanPetWire[] =>
  pets.filter((p) => blockedReason(p) === null).map((p) => ({ name: p.name, species: p.species }));
