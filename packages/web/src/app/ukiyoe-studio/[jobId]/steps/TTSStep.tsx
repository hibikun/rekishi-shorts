"use client";

import { useState } from "react";
import type { UkiyoeJob } from "@rekishi/shared";

interface Props {
  job: UkiyoeJob;
  onJobChange: (job: UkiyoeJob) => void;
  onAdvance: () => void;
}

interface RunResult {
  ok: boolean;
  job?: UkiyoeJob;
  tts?: {
    path: string;
    characters: number;
    approxDurationSec: number;
    model: string;
  };
  error?: string;
}

export function TTSStep({ job, onJobChange, onAdvance }: Props) {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const status = job.steps.tts.status;
  const characters = job.steps.tts.characters;
  const approxDurationSec = job.steps.tts.approxDurationSec;
  const audioUrl = `/api/ukiyoe-studio/${job.id}/audio?t=${job.steps.tts.updatedAt ?? ""}`;

  const handleRun = async () => {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch(`/api/ukiyoe-studio/${job.id}/tts/run`, {
        method: "POST",
      });
      const data = (await res.json()) as RunResult;
      if (!data.ok || !data.job) {
        setError(data.error ?? "TTS 生成に失敗しました");
        return;
      }
      onJobChange(data.job);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <header>
        <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>⑥ TTS</h2>
        <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>
          Gemini TTS でナレーション wav を生成。voiceName: {job.steps.tts.voiceName}
        </p>
      </header>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={handleRun}
          disabled={running}
          style={primary(running)}
        >
          {running ? "生成中..." : status === "done" ? "再生成" : "TTS を実行"}
        </button>
        <span style={{ alignSelf: "center", fontSize: 12, color: "var(--muted)" }}>
          status: <strong>{status}</strong>
          {characters !== undefined ? ` / ${characters} 字` : ""}
          {approxDurationSec !== undefined
            ? ` / ${approxDurationSec.toFixed(2)}秒`
            : ""}
        </span>
      </div>

      {status === "done" ? (
        <audio
          controls
          src={audioUrl}
          style={{ width: "100%" }}
        />
      ) : null}

      {error ? (
        <p style={{ color: "#d32f2f", fontSize: 13, margin: 0 }}>{error}</p>
      ) : null}

      <div>
        <button
          type="button"
          onClick={onAdvance}
          disabled={status !== "done"}
          style={primary(false)}
          title={status !== "done" ? "TTS が完了していません" : undefined}
        >
          Videos へ進む →
        </button>
      </div>
    </div>
  );
}

function primary(loading: boolean): React.CSSProperties {
  return {
    padding: "10px 18px",
    background: "var(--accent)",
    color: "white",
    border: "none",
    borderRadius: 6,
    fontWeight: 600,
    cursor: loading ? "not-allowed" : "pointer",
    opacity: loading ? 0.6 : 1,
  };
}
