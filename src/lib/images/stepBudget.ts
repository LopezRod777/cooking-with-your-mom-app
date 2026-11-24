import { getSql } from "../db";

export const STEP_IMAGES_PER_DAY = 60;

// One counter row per person and day, bumped in a single statement: the row lock makes the cap exact under
// concurrent requests. It counts attempts (a failed generation is not refunded), so the cap bounds spend.
// Takes `count` slots in one statement (a step whose reference is also missing needs two). All or nothing:
// with one slot left and two needed, nothing is taken and false comes back.
export async function takeStepImageSlots(userId: string, count: number): Promise<boolean> {
  const rows = (await getSql().query(
    `INSERT INTO step_image_quota (user_id, day, n) VALUES ($1, current_date, $3)
     ON CONFLICT (user_id, day) DO UPDATE SET n = step_image_quota.n + $3
     WHERE step_image_quota.n + $3 <= $2
     RETURNING n`,
    [userId, STEP_IMAGES_PER_DAY, count],
  )) as { n: number }[];
  return rows.length > 0;
}
