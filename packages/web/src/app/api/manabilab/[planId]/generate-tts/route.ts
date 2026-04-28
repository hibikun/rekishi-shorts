import { NextRequest, NextResponse } from "next/server";
import { generatePlanTts } from "@rekishi/pipeline/manabilab-tts";

export const runtime = "nodejs";
// VOICEVOX 数十秒 + Whisper alignment 数十秒 で合計 1〜2分かかり得る
export const maxDuration = 300;

interface PostBody {
  /** true なら Whisper をスキップして TTS だけ実行（線形配分で時刻計算） */
  skipAlignment?: boolean;
}

interface RouteContext {
  params: Promise<{ planId: string }>;
}

/**
 * Plan-driven TTS + 字幕アライン パイプラインを実行する。
 *
 * Flow:
 *   1. plan.scenes[*].narration を連結
 *   2. VOICEVOX で wav 生成 (plan.audio.voiceId / speedScale / intonationScale を使用)
 *   3. Whisper で word-level alignment
 *   4. 文字数累積で scenes に時刻マップ
 *   5. plan JSON の totalDurationSec / scenes[*].startSec/endSec を上書き
 */
export async function POST(
  request: NextRequest,
  context: RouteContext,
): Promise<Response> {
  const { planId } = await context.params;

  let body: PostBody = {};
  try {
    body = (await request.json()) as PostBody;
  } catch {
    // 空 body OK
  }

  const logs: string[] = [];
  const onProgress = (msg: string) => {
    logs.push(msg);
    console.log(`[generate-tts ${planId}]`, msg);
  };

  try {
    const result = await generatePlanTts(planId, {
      onProgress,
      skipAlignment: body.skipAlignment,
    });
    return NextResponse.json({ ok: true, result, logs });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    onProgress(`❌ ${message}`);
    return NextResponse.json(
      { ok: false, error: message, logs },
      { status: 500 },
    );
  }
}
