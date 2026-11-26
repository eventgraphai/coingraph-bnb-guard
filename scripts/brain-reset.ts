// Removes the "CoinGraph Guard memory" brain (and only that one, by exact name) so it can be seeded again from scratch.
import { LivingBrainClient } from "@living-brain/sdk";
import "../checks/env.js";

const c = new LivingBrainClient({ apiKey: process.env.LIVING_BRAIN_API_KEY!.trim(), subjectId: process.env.LIVING_BRAIN_SUBJECT_ID!.trim() });
const list: any = await c.brains.list();
const items: any[] = Array.isArray(list) ? list : list?.data ?? list?.items ?? list?.brains ?? [];
for (const b of items.filter((x) => x?.name === "CoinGraph Guard memory")) {
  await c.brains.remove({ brainId: b.id } as any);
  console.log("removed", b.id);
}
console.log("brains left:", items.filter((x) => x?.name !== "CoinGraph Guard memory").map((x) => x.name));
