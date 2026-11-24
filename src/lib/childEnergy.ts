// Minors 2–15: energy from the Dietary Guidelines for Americans 2020–2025, Appendix 2, Table A2-2 "Estimated Calorie
// Needs per Day, by Age, Sex, and Physical Activity Level, Ages 2 and Older" (pp. 140–141; read from the official PDF on
// 2026-11-04). The 2025–2030 edition (10 pages) has no such table and points to the USDA DRI Calculator, so this stays
// the reference. Columns: sedentary / moderately active / active. kcal per day.
export type ChildActivity = "sedentary" | "moderate" | "active";
export const CHILD_KCAL: Record<number, { female: [number, number, number]; male: [number, number, number] }> = {
  2: { male: [1000, 1000, 1000], female: [1000, 1000, 1000] },
  3: { male: [1000, 1400, 1400], female: [1000, 1200, 1400] },
  4: { male: [1200, 1400, 1600], female: [1200, 1400, 1400] },
  5: { male: [1200, 1400, 1600], female: [1200, 1400, 1600] },
  6: { male: [1400, 1600, 1800], female: [1200, 1400, 1600] },
  7: { male: [1400, 1600, 1800], female: [1200, 1600, 1800] },
  8: { male: [1400, 1600, 2000], female: [1400, 1600, 1800] },
  9: { male: [1600, 1800, 2000], female: [1400, 1600, 1800] },
  10: { male: [1600, 1800, 2200], female: [1400, 1800, 2000] },
  11: { male: [1800, 2000, 2200], female: [1600, 1800, 2000] },
  12: { male: [1800, 2200, 2400], female: [1600, 2000, 2200] },
  13: { male: [2000, 2200, 2600], female: [1600, 2000, 2200] },
  14: { male: [2000, 2400, 2800], female: [1800, 2000, 2400] },
  15: { male: [2200, 2600, 3000], female: [1800, 2000, 2400] },
};
const COL: Record<ChildActivity, 0 | 1 | 2> = { sedentary: 0, moderate: 1, active: 2 };
// sex null/unspecified → the mean of the two rows, rounded to 50. activity null → moderately active.
export function childKcal(age: number, sex: "woman" | "man" | "unspecified" | null, activity: ChildActivity | null): number | null {
  const row = CHILD_KCAL[age];
  if (!row) return null;
  const c = COL[activity ?? "moderate"];
  if (sex === "woman") return row.female[c];
  if (sex === "man") return row.male[c];
  return Math.round((row.female[c] + row.male[c]) / 2 / 50) * 50;
}

// Protein RDA (g/day) for minors 2–15: Dietary Guidelines 2020–2025, Appendix 1, Table A1-2 "Daily Nutritional Goals,
// Ages 2 and Older" (p. 132; read from the local extract on 2026-11-04). Extracted line:
//   "Protein (g)          RDA        13      19      34      46      46        46      46      19      34      52      56      56      56"
// Columns in order: M/F 2-3 = 13; F 4-8 = 19; F 9-13 = 34; F 14-18 = 46; M 4-8 = 19; M 9-13 = 34; M 14-18 = 52.
// Ages 2–3, 4–8, 9–13 are the same for both sexes. Ages 14–15 differ: woman 46, man 52. Unspecified = their mean (49).
const PROTEIN_BY_AGE: Record<number, [female: number, male: number]> = {
  2: [13, 13], 3: [13, 13], 4: [19, 19], 5: [19, 19], 6: [19, 19], 7: [19, 19], 8: [19, 19],
  9: [34, 34], 10: [34, 34], 11: [34, 34], 12: [34, 34], 13: [34, 34], 14: [46, 52], 15: [46, 52],
};
export function childProteinG(age: number, sex: "woman" | "man" | "unspecified" | null): number | null {
  const row = PROTEIN_BY_AGE[age];
  if (!row) return null;
  if (sex === "woman") return row[0];
  if (sex === "man") return row[1];
  return Math.round((row[0] + row[1]) / 2);
}
