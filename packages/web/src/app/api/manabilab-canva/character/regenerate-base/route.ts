import { NextRequest, NextResponse } from "next/server";
import { regenerateCharacterBase } from "@rekishi/pipeline";
import { setChannel } from "@rekishi/shared/channel";
import { CANVA_CHANNEL_SLUG } from "@/lib/canva-job";

export const runtime = "nodejs";
// Nano Banana は数十秒かかる場合あり
export const maxDuration = 180;

export async function POST(_request: NextRequest): Promise<Response> {
  try {
    setChannel(CANVA_CHANNEL_SLUG);
    const result = await regenerateCharacterBase();
    return NextResponse.json({
      ok: true,
      outputPath: result.outputPath,
      referenceUsed: result.referenceUsed,
      // キャッシュバスタ
      regeneratedAt: new Date().toISOString(),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
