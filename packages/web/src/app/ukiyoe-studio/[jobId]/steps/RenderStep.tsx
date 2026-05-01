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
  outputPath?: string;
  durationSec?: number;
  error?: string;
}

export function RenderStep({ job, onJobChange, onAdvance }: Props) {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const status = job.steps.render.status;
  const outputPath = job.steps.render.outputPath;
  const durationSec = job.steps.render.durationSec;
  const videoUrl = `/api/ukiyoe-studio/${job.id}/final-video?t=${job.steps.render.updatedAt ?? ""}`;

  const handleRun = async () => {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch(`/api/ukiyoe-studio/${job.id}/render/run`, {
        method: "POST",
      });
      const data = (await res.json()) as RunResult;
      if (!data.ok || !data.job) {
        setError(data.error ?? "レンダリングに失敗しました");
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
        <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>⑧ Render</h2>
        <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>
          Whisper でナレーションをアライン → シーン尺確定 → ukiyoe-plan.json 構築 → Remotion で最終 mp4 生成。
        </p>
      </header>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={handleRun}
          disabled={running}
          style={primary(running)}
        >
          {running ? "レンダリング中..." : status === "done" ? "再レンダリング" : "レンダリングを実行"}
        </button>
        <span style={{ alignSelf: "center", fontSize: 12, color: "var(--muted)" }}>
          status: <strong>{status}</strong>
          {durationSec !== undefined ? ` / ${durationSec.toFixed(2)}秒` : ""}
        </span>
      </div>

      {status === "done" && outputPath ? (
        <>
          <video
            src={videoUrl}
            controls
            style={{
              width: "100%",
              maxWidth: 360,
              aspectRatio: "9/16",
              borderRadius: 8,
              background: "#000",
            }}
          />
          <div style={{ fontSize: 11, color: "var(--muted)", fontFamily: "monospace" }}>
            {outputPath}
          </div>
        </>
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
          title={status !== "done" ? "レンダリングが完了していません" : undefined}
        >
          Ship へ進む →
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
