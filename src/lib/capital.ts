import { db } from "./db";
export async function getCapital(){
  let row = await db.capitalState.findUnique({ where: { id: "main" } });
  if(!row){
    const last = await db.autoTrade.findFirst({ where: { status: "closed" }, orderBy: { exitTime: "desc" } });
    const settled = last?.capitalAfter ?? 1000;
    row = await db.capitalState.create({ data: { id: "main", equity: settled, settled, openMargin: 0, unrealized: 0 } });
  }
  return row;
}
