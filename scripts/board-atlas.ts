// Rebuilds the board's market data and prints the Atlas column.
import { refreshBoard, getBoard } from "../web/board.js";
await refreshBoard(true);
for (const r of getBoard().rows.filter((x) => x.atlas)) console.log(r.symbol.padEnd(6), r.priceUsd.toFixed(4).padStart(12), "atlas", r.atlas!.priceUsd.toFixed(4).padStart(12), (r.atlas!.gapPct.toFixed(2) + "%").padStart(7), r.atlas!.consensus?.toFixed(2), r.atlas!.status);
process.exit(0);
