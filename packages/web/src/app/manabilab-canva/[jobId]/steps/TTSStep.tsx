"use client";

import { useState } from "react";
import type {
  CanvaSceneSource,
  ManabilabCanvaJob,
  ManabilabCanvaScene,
  ManabilabCanvaScript,
} from "@rekishi/shared";

interface Props {
  job: ManabilabCanvaJob;
  script: ManabilabCanvaScript | null;
  scenes: ManabilabCanvaScene[] | null;
  onJobChange: (job: ManabilabCanvaJob) => void;
  onScriptChange: (script: ManabilabCanvaScript) => void;
  onScenesChange: (scenes: ManabilabCanvaScene[]) => void;
  onAdvance: () => void;
}

interface SettingsResult {
  ok: boolean;
  job?: ManabilabCanvaJob;
  error?: string;
}

interface ReadingsResult {
  ok: boolean;
  readings?: ReadingRow[];
  error?: string;
}

interface GenTtsResult {
  ok: boolean;
  sceneIndex?: number;
  audioPath?: string;
  audioUrl?: string;
  audioDurationSec?: number;
  generatedAt?: string;
  error?: string;
}

interface GenerateAllResult {
  ok: boolean;
  job?: ManabilabCanvaJob;
  scenes?: ManabilabCanvaScene[];
  results?: Array<{
    index: number;
    status: "done" | "skipped" | "error";
    audioPath?: string;
    audioDurationSec?: number;
    error?: string;
  }>;
  error?: string;
}

const CANVA_PUBLIC_PREFIX = "/manabilab-canva";

// Gemini TTS の主要 prebuilt voice
const VOICE_PRESETS: Array<{ name: string; description: string }> = [
  { name: "Charon", description: "ニュースアンカー風 / 明瞭・説得力（推奨）" },
  { name: "Fenrir", description: "ドラマティックで深い男性" },
  { name: "Orus", description: "しっかり・落ち着いた男性" },
  { name: "Zubenelgenubi", description: "大人でリッチな男性" },
  { name: "Puck", description: "軽快・若々しい男性" },
  { name: "Kore", description: "落ち着いた女性" },
  { name: "Aoede", description: "軽やか女性" },
  { name: "Leda", description: "穏やか女性" },
];

function sourceLabel(source: CanvaSceneSource): string {
  switch (source.kind) {
    case "hook":
      return "HOOK";
    case "statement":
      return `STATEMENT #${source.statementIndex + 1}`;
    case "cta":
      return "CTA";
    case "punchline":
      return "PUNCHLINE";
  }
}

function sourceColor(source: CanvaSceneSource): string {
  switch (source.kind) {
    case "hook":
      return "#1976d2";
    case "statement":
      return "#2e7d32";
    case "cta":
      return "#f57c00";
    case "punchline":
      return "#d32f2f";
  }
}

interface ReadingRow {
  term: string;
  reading: string;
}

function cleanReadingRows(rows: ReadingRow[]): ReadingRow[] {
  return rows
    .map((r) => ({ term: r.term.trim(), reading: r.reading.trim() }))
    .filter((r) => r.term && r.reading);
}

export function TTSStep({
  job,
  script,
  scenes: initialScenes,
  onJobChange,
  onScriptChange,
  onScenesChange,
  onAdvance,
}: Props) {
  const [scenes, setScenes] = useState<ManabilabCanvaScene[] | null>(
    initialScenes,
  );
  const [voiceName, setVoiceName] = useState(job.steps.tts.voiceName);
  const [stylePromptOverride, setStylePromptOverride] = useState(
    job.steps.tts.stylePromptOverride ?? "",
  );
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);

  const [readingRows, setReadingRows] = useState<ReadingRow[]>(
    (script?.readings ?? []).map((r) => ({ ...r })),
  );
  const [savingReadings, setSavingReadings] = useState(false);
  const [readingsError, setReadingsError] = useState<string | null>(null);

  const [genTtsIdx, setGenTtsIdx] = useState<number | null>(null);
  const [audioVersion, setAudioVersion] = useState<Record<number, number>>({});
  const [generatingAll, setGeneratingAll] = useState(false);
  const [batchSummary, setBatchSummary] = useState<string | null>(null);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [error, setError] = useState<{ index: number; message: string } | null>(
    null,
  );

  const scriptDone = job.steps.script.status === "done";

  const handleSaveSettings = async () => {
    setSavingSettings(true);
    setSettingsError(null);
    try {
      const res = await fetch(`/api/manabilab-canva/${job.id}/tts/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          voiceName,
          stylePromptOverride: stylePromptOverride.trim(),
        }),
      });
      const data = (await res.json()) as SettingsResult;
      if (!data.ok || !data.job) {
        setSettingsError(data.error ?? "設定の保存に失敗しました");
        return;
      }
      onJobChange(data.job);
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingSettings(false);
    }
  };

  const handleSaveReadings = async () => {
    if (!script) {
      setReadingsError("script が読めません");
      return;
    }
    setSavingReadings(true);
    setReadingsError(null);
    try {
      const cleaned = cleanReadingRows(readingRows);
      const res = await fetch(`/api/manabilab-canva/${job.id}/tts/readings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ readings: cleaned }),
      });
      const data = (await res.json()) as ReadingsResult;
      if (!data.ok) {
        setReadingsError(data.error ?? "読みリストの保存に失敗しました");
        return;
      }
      onScriptChange({ ...script, readings: data.readings ?? cleaned });
    } catch (err) {
      setReadingsError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingReadings(false);
    }
  };

  const handleGenerateTts = async (sceneIndex: number) => {
    if (!scenes) return;
    setGenTtsIdx(sceneIndex);
    setError(null);
    try {
      const res = await fetch(
        `/api/manabilab-canva/${job.id}/scenes/${sceneIndex}/generate-tts`,
        { method: "POST" },
      );
      const data = (await res.json()) as GenTtsResult;
      if (!data.ok || !data.audioPath) {
        setError({
          index: sceneIndex,
          message: data.error ?? "音声生成に失敗しました",
        });
        return;
      }
      const next = scenes.map((s) =>
        s.index === sceneIndex
          ? {
              ...s,
              audioPath: data.audioPath!,
              audioDurationSec: data.audioDurationSec,
              audioGeneratedAt: data.generatedAt,
            }
          : s,
      );
      setScenes(next);
      onScenesChange(next);
      setAudioVersion((prev) => ({ ...prev, [sceneIndex]: Date.now() }));
    } catch (err) {
      setError({
        index: sceneIndex,
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setGenTtsIdx(null);
    }
  };

  const handleGenerateAll = async (force: boolean) => {
    if (!scenes || scenes.length === 0) return;
    if (
      !confirm(
        force
          ? "既存の音声を含めて全シーンを再生成します。よろしいですか？"
          : `未生成のシーンに対して音声をまとめて生成します。${scenes.length} シーン、最大 1〜3 分程度かかります。続行しますか？`,
      )
    ) {
      return;
    }
    setGeneratingAll(true);
    setBatchSummary(null);
    setGlobalError(null);
    try {
      const res = await fetch(
        `/api/manabilab-canva/${job.id}/tts/generate-all`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ force }),
        },
      );
      const data = (await res.json()) as GenerateAllResult;
      if (!data.ok && !data.results) {
        setGlobalError(data.error ?? "一括生成に失敗しました");
        return;
      }
      if (data.scenes) {
        setScenes(data.scenes);
        onScenesChange(data.scenes);
        const v = Date.now();
        const versions: Record<number, number> = {};
        for (const s of data.scenes) versions[s.index] = v;
        setAudioVersion(versions);
      }
      if (data.job) onJobChange(data.job);
      if (data.results) {
        const done = data.results.filter((r) => r.status === "done").length;
        const skipped = data.results.filter((r) => r.status === "skipped").length;
        const errored = data.results.filter((r) => r.status === "error");
        const parts: string[] = [`生成 ${done}`];
        if (skipped > 0) parts.push(`スキップ ${skipped}`);
        if (errored.length > 0) parts.push(`失敗 ${errored.length}`);
        setBatchSummary(parts.join(" / "));
        if (errored.length > 0) {
          setGlobalError(
            errored.map((e) => `#${e.index}: ${e.error}`).join(" / "),
          );
        }
      }
    } catch (err) {
      setGlobalError(err instanceof Error ? err.message : String(err));
    } finally {
      setGeneratingAll(false);
    }
  };

  const totalDurationSec = (scenes ?? [])
    .map((s) => s.audioDurationSec ?? 0)
    .reduce((a, b) => a + b, 0);

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <header>
        <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>⑥ TTS</h2>
        <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>
          各シーンの narration を Gemini TTS で wav に。Canva に取り込む前提で
          シーンごとに個別ファイル（連結なし）。
        </p>
      </header>

      {!scriptDone ? (
        <p style={{ color: "#d32f2f", fontSize: 13 }}>
          先に Script ステップを完了してください。
        </p>
      ) : null}

      {/* ボイス設定 */}
      <section
        style={{
          border: "1px solid var(--border)",
          borderRadius: 8,
          padding: 14,
          background: "rgba(0,0,0,0.02)",
          display: "grid",
          gap: 10,
        }}
      >
        <h3 style={{ fontSize: 14, fontWeight: 700, margin: 0 }}>
          ボイス設定（ジョブ全体）
        </h3>
        <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
          <span style={{ fontWeight: 600 }}>ボイス</span>
          <select
            value={voiceName}
            onChange={(e) => setVoiceName(e.target.value)}
            disabled={savingSettings}
            style={inputStyle}
          >
            {VOICE_PRESETS.map((v) => (
              <option key={v.name} value={v.name}>
                {v.name} — {v.description}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
          <span style={{ fontWeight: 600 }}>
            スタイル指示の上書き{" "}
            <span style={hintStyle}>
              空ならチャンネル既定（学習科学 × ツッコミ系トーン）を使用
            </span>
          </span>
          <textarea
            value={stylePromptOverride}
            onChange={(e) => setStylePromptOverride(e.target.value)}
            rows={3}
            placeholder="(空のままで OK)"
            disabled={savingSettings}
            style={textareaStyle}
          />
        </label>
        {settingsError ? (
          <p style={{ color: "#d32f2f", fontSize: 12, margin: 0 }}>
            {settingsError}
          </p>
        ) : null}
        <div>
          <button
            type="button"
            onClick={handleSaveSettings}
            disabled={savingSettings}
            style={smallSecondary(savingSettings)}
          >
            {savingSettings ? "保存中..." : "設定を保存"}
          </button>
        </div>
      </section>

      {/* readings */}
      <section
        style={{
          border: "1px solid var(--border)",
          borderRadius: 8,
          padding: 14,
          background: "rgba(0,0,0,0.02)",
          display: "grid",
          gap: 10,
        }}
      >
        <h3 style={{ fontSize: 14, fontWeight: 700, margin: 0 }}>
          難読語の読み（readings）
        </h3>
        <p style={{ fontSize: 12, color: "var(--muted)", margin: 0 }}>
          Karpicke → カーピック のように、英字研究者名や難読語の読みを VOICEVOX
          / Gemini TTS が誤読しないよう辞書登録します。Script Step で生成された値が初期値。
        </p>
        <div style={{ display: "grid", gap: 6 }}>
          {readingRows.length === 0 ? (
            <p style={{ fontSize: 12, color: "var(--muted)", margin: 0 }}>
              （登録なし）
            </p>
          ) : null}
          {readingRows.map((row, i) => (
            <div
              key={i}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr auto",
                gap: 6,
              }}
            >
              <input
                type="text"
                value={row.term}
                placeholder="表記（例: Karpicke）"
                onChange={(e) =>
                  setReadingRows(
                    readingRows.map((r, j) =>
                      j === i ? { ...r, term: e.target.value } : r,
                    ),
                  )
                }
                style={inputStyle}
                disabled={savingReadings}
              />
              <input
                type="text"
                value={row.reading}
                placeholder="読み（例: カーピック）"
                onChange={(e) =>
                  setReadingRows(
                    readingRows.map((r, j) =>
                      j === i ? { ...r, reading: e.target.value } : r,
                    ),
                  )
                }
                style={inputStyle}
                disabled={savingReadings}
              />
              <button
                type="button"
                onClick={() =>
                  setReadingRows(readingRows.filter((_, j) => j !== i))
                }
                disabled={savingReadings}
                style={tinyButtonStyle}
                title="削除"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            onClick={() =>
              setReadingRows([...readingRows, { term: "", reading: "" }])
            }
            disabled={savingReadings}
            style={tinyButtonStyle}
          >
            + 追加
          </button>
          <button
            type="button"
            onClick={handleSaveReadings}
            disabled={savingReadings || !script}
            style={smallSecondary(savingReadings)}
          >
            {savingReadings ? "保存中..." : "読みを保存"}
          </button>
        </div>
        {readingsError ? (
          <p style={{ color: "#d32f2f", fontSize: 12, margin: 0 }}>
            {readingsError}
          </p>
        ) : null}
      </section>

      {/* 一括生成 */}
      <div
        style={{
          display: "flex",
          gap: 8,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <button
          type="button"
          onClick={() => handleGenerateAll(false)}
          disabled={
            generatingAll ||
            !scriptDone ||
            !scenes ||
            scenes.length === 0 ||
            genTtsIdx !== null
          }
          style={primaryButtonStyle(generatingAll)}
        >
          {generatingAll ? "一括生成中..." : "未生成のシーンを一括生成"}
        </button>
        <button
          type="button"
          onClick={() => handleGenerateAll(true)}
          disabled={
            generatingAll ||
            !scriptDone ||
            !scenes ||
            scenes.length === 0 ||
            genTtsIdx !== null
          }
          style={secondaryButtonStyle(generatingAll)}
        >
          全シーンを上書き再生成
        </button>
        {batchSummary ? (
          <span style={{ fontSize: 12, color: "var(--muted)" }}>
            {batchSummary}
          </span>
        ) : null}
        {totalDurationSec > 0 ? (
          <span style={{ fontSize: 12, color: "var(--muted)" }}>
            合計 {totalDurationSec.toFixed(1)} 秒
          </span>
        ) : null}
      </div>

      {globalError ? (
        <p style={{ color: "#d32f2f", fontSize: 13, margin: 0 }}>{globalError}</p>
      ) : null}

      {/* 各シーン */}
      {scenes && scenes.length > 0 ? (
        <div style={{ display: "grid", gap: 12 }}>
          {scenes.map((s) => {
            const v = audioVersion[s.index];
            const audioSrc = s.audioPath
              ? `${CANVA_PUBLIC_PREFIX}/${s.audioPath}${v ? `?t=${v}` : ""}`
              : null;
            const errForThis =
              error?.index === s.index ? error.message : null;
            const isGen = genTtsIdx === s.index;

            return (
              <div
                key={s.index}
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  padding: 14,
                  background: "rgba(0,0,0,0.02)",
                  display: "grid",
                  gap: 10,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    flexWrap: "wrap",
                  }}
                >
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: "white",
                      background: sourceColor(s.source),
                      padding: "2px 8px",
                      borderRadius: 999,
                    }}
                  >
                    #{s.index} · {sourceLabel(s.source)}
                  </span>
                  {s.audioDurationSec ? (
                    <span style={{ fontSize: 11, color: "var(--muted)" }}>
                      {s.audioDurationSec.toFixed(2)} 秒
                    </span>
                  ) : null}
                  {s.audioGeneratedAt ? (
                    <span style={{ fontSize: 11, color: "var(--muted)" }}>
                      生成{" "}
                      {new Date(s.audioGeneratedAt).toLocaleString("ja-JP")}
                    </span>
                  ) : null}
                </div>

                <div
                  style={{
                    fontSize: 12,
                    color: "var(--muted)",
                    padding: "4px 0",
                  }}
                >
                  <strong style={{ color: "inherit" }}>narration:</strong>{" "}
                  {s.narration}
                </div>

                {audioSrc ? (
                  <div style={{ display: "grid", gap: 4 }}>
                    <audio
                      key={`${s.index}-${v ?? 0}`}
                      src={audioSrc}
                      controls
                      preload="metadata"
                      style={{ width: "100%" }}
                    />
                    <a
                      href={audioSrc}
                      download={`scene-${String(s.index).padStart(2, "0")}.wav`}
                      style={{
                        fontSize: 12,
                        color: "var(--accent)",
                        textDecoration: "none",
                      }}
                    >
                      ⬇ WAV をダウンロード
                    </a>
                  </div>
                ) : (
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>
                    未生成
                  </div>
                )}

                {errForThis ? (
                  <p style={{ color: "#d32f2f", fontSize: 12, margin: 0 }}>
                    {errForThis}
                  </p>
                ) : null}

                <div>
                  <button
                    type="button"
                    onClick={() => handleGenerateTts(s.index)}
                    disabled={isGen || generatingAll}
                    style={smallPrimary(isGen)}
                  >
                    {isGen
                      ? "音声生成中..."
                      : s.audioPath
                      ? "音声を再生成"
                      : "音声を生成"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p
          style={{
            color: "var(--muted)",
            fontSize: 13,
            padding: "32px 0",
            textAlign: "center",
          }}
        >
          シーンがありません。Scenes ステップで展開してください。
        </p>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <button
          type="button"
          onClick={onAdvance}
          style={primaryButtonStyle(false)}
        >
          次へ →
        </button>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: "8px 10px",
  border: "1px solid var(--border)",
  borderRadius: 6,
  fontSize: 14,
  background: "var(--card)",
  color: "inherit",
};

const textareaStyle: React.CSSProperties = {
  ...inputStyle,
  fontFamily: "ui-monospace, SFMono-Regular, monospace",
  fontSize: 13,
  lineHeight: 1.5,
  resize: "vertical",
};

const hintStyle: React.CSSProperties = {
  fontWeight: 400,
  color: "var(--muted)",
  fontSize: 11,
  marginLeft: 4,
};

const tinyButtonStyle: React.CSSProperties = {
  padding: "4px 10px",
  border: "1px solid var(--border)",
  background: "var(--card)",
  color: "inherit",
  borderRadius: 4,
  fontSize: 12,
  cursor: "pointer",
};

function primaryButtonStyle(loading: boolean): React.CSSProperties {
  return {
    padding: "10px 20px",
    background: "var(--accent)",
    color: "white",
    border: "none",
    borderRadius: 6,
    fontWeight: 600,
    cursor: loading ? "not-allowed" : "pointer",
    opacity: loading ? 0.6 : 1,
  };
}

function secondaryButtonStyle(loading: boolean): React.CSSProperties {
  return {
    padding: "10px 20px",
    background: "transparent",
    color: "var(--accent)",
    border: "1.5px solid var(--accent)",
    borderRadius: 6,
    fontWeight: 600,
    cursor: loading ? "not-allowed" : "pointer",
    opacity: loading ? 0.6 : 1,
  };
}

function smallPrimary(loading: boolean): React.CSSProperties {
  return {
    padding: "6px 14px",
    background: "var(--accent)",
    color: "white",
    border: "none",
    borderRadius: 4,
    fontSize: 12,
    fontWeight: 600,
    cursor: loading ? "not-allowed" : "pointer",
    opacity: loading ? 0.6 : 1,
  };
}

function smallSecondary(loading: boolean): React.CSSProperties {
  return {
    padding: "6px 14px",
    background: "transparent",
    color: "var(--accent)",
    border: "1px solid var(--accent)",
    borderRadius: 4,
    fontSize: 12,
    fontWeight: 600,
    cursor: loading ? "not-allowed" : "pointer",
    opacity: loading ? 0.6 : 1,
  };
}
