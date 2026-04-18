/**
 * 各API呼び出しの usage を集約し、コストを試算する。
 * 料金は 2026-04 時点の公称値（USD）。為替は JPY=150/USD 想定。
 */

const JPY_PER_USD = 150;

// Gemini 料金表（USD per 1M tokens）
const GEMINI_RATES: Record<string, { input: number; output: number }> = {
  "gemini-3.1-pro-preview": { input: 1.25, output: 10.0 },
  "gemini-3-pro-preview": { input: 1.25, output: 10.0 },
  "gemini-3.1-flash-lite-preview": { input: 0.1, output: 0.4 },
  "gemini-3-flash-preview": { input: 0.3, output: 2.5 },
};

// Nano Banana 2: $0.039/image (1290 tokens @ $30/1M)
const IMAGE_PRICE_USD = 0.039;

// ElevenLabs Multilingual v2: Creator plan 100k chars/$22 = $0.00022/char
const ELEVENLABS_PER_CHAR_USD = 22 / 100_000;

// OpenAI Whisper: $0.006/minute
const WHISPER_PER_MINUTE_USD = 0.006;

export interface ModelUsage {
  label: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  images?: number;
  characters?: number;
  audioSec?: number;
  /** このステップの推定費用 (USD) */
  usdCost: number;
}

export class CostTracker {
  private entries: ModelUsage[] = [];

  addGemini(label: string, model: string, inputTokens: number, outputTokens: number): void {
    const rate = GEMINI_RATES[model];
    const usdCost = rate
      ? (inputTokens / 1_000_000) * rate.input + (outputTokens / 1_000_000) * rate.output
      : 0;
    this.entries.push({ label, model, inputTokens, outputTokens, usdCost });
  }

  addImage(label: string, count: number): void {
    this.entries.push({
      label,
      images: count,
      usdCost: count * IMAGE_PRICE_USD,
    });
  }

  addElevenLabs(label: string, characters: number): void {
    this.entries.push({
      label,
      characters,
      usdCost: characters * ELEVENLABS_PER_CHAR_USD,
    });
  }

  addWhisper(label: string, audioSec: number): void {
    this.entries.push({
      label,
      audioSec,
      usdCost: (audioSec / 60) * WHISPER_PER_MINUTE_USD,
    });
  }

  addFree(label: string, note: string): void {
    this.entries.push({ label: `${label} (${note})`, usdCost: 0 });
  }

  getEntries(): ModelUsage[] {
    return this.entries;
  }

  totalUsd(): number {
    return this.entries.reduce((s, e) => s + e.usdCost, 0);
  }

  totalJpy(): number {
    return this.totalUsd() * JPY_PER_USD;
  }

  formatTable(): string {
    const rows = this.entries.map((e) => {
      const detail = [
        e.model && `model=${e.model}`,
        e.inputTokens !== undefined && `in=${e.inputTokens}tok`,
        e.outputTokens !== undefined && `out=${e.outputTokens}tok`,
        e.images !== undefined && `images=${e.images}`,
        e.characters !== undefined && `chars=${e.characters}`,
        e.audioSec !== undefined && `audio=${e.audioSec.toFixed(1)}s`,
      ]
        .filter(Boolean)
        .join(" ");
      const jpy = (e.usdCost * JPY_PER_USD).toFixed(2);
      return `  ${e.label.padEnd(24)} ${detail.padEnd(60)} $${e.usdCost.toFixed(5)} (¥${jpy})`;
    });
    const total = this.totalUsd();
    rows.push("  " + "-".repeat(95));
    rows.push(`  ${"TOTAL".padEnd(24)} ${"".padEnd(60)} $${total.toFixed(5)} (¥${(total * JPY_PER_USD).toFixed(2)})`);
    return rows.join("\n");
  }
}
