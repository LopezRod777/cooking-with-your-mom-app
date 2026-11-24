import { z } from "zod";

// Model output, exactly as in docs/PLAN-PAIRINGS.md section C. Ids only, plus numbers.
const id = z.string().min(1).max(64);

export const WineChoiceSchema = z.strictObject({
  styleId: id,
  grapeIds: z.array(id).min(1).max(3),
  regionIds: z.array(id).min(1).max(3),
  whyPrincipleIds: z.array(id).min(1).max(2),
  tier: z.enum(["everyday", "step-up", "splurge"]),
  serveTempF: z.number().int().min(30).max(70),
});

export const OtherChoiceSchema = z.strictObject({
  styleId: id,
  whyPrincipleIds: z.array(id).min(1).max(2),
});

export const ZeroProofChoiceSchema = z.strictObject({
  styleId: id,
});

export const AvoidChoiceSchema = z.strictObject({
  styleId: id,
  avoidReasonId: id,
});

export const PairingOutputSchema = z.strictObject({
  wines: z.tuple([WineChoiceSchema, WineChoiceSchema]),
  other: z.tuple([OtherChoiceSchema]),
  zeroProof: z.tuple([ZeroProofChoiceSchema]),
  avoid: z.tuple([AvoidChoiceSchema]),
  confidence: z.number().min(0).max(1),
});

export type PairingOutput = z.infer<typeof PairingOutputSchema>;
export type WineChoice = z.infer<typeof WineChoiceSchema>;
