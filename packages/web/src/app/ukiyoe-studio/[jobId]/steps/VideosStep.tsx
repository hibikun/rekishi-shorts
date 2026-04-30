"use client";

import { useState } from "react";
import type { UkiyoeJob, UkiyoeScenePlan } from "@rekishi/shared";

interface Props {
  job: UkiyoeJob;
  scenePlan: UkiyoeScenePlan | null;
  onJobChange: (job: UkiyoeJob) => void;
  onAdvance: () => void;
}

interface RunResult {
  ok: boolean;
  job?: UkiyoeJob;
  dryRun?: boolean;
  resolution?: string;
  elapsedSec?: number;
  totalEstimatedCostUsd?: number;
  results?: {
    index: number;
    status: string;
    prompt: string;
    duration: number;
    estimatedCostUsd: number;
    videoPath?: string;
    error?: string;
  }[];
  logs?: string[];
  error?: string;
}

function sceneToken(i: number): string {
  return i.toString().padStart(2, "0");
}

export function VideosStep({ job, scenePlan, onJobChange, onAdvance }: Props) {
  const [running, setRunning] = useState(false);
  const [dryRun, setDryRun] = useState(true);
  const [resolution, setResolution] = useState<"480p" | "720p">("720p");
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<RunResult | null>(null);

  const status = job.steps.videos.status;
  const generated = job.steps.videos.generatedScenes ?? [];
  const allDone =
    !!scenePlan && scenePlan.scenes.every((s) => generated.includes(s.index));

  const runAll = async (force = false) => {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch(`/api/ukiyoe-studio/${job.id}/videos/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun, resolution, force }),
      });
      const data = (await res.json()) as RunResult;
      setLast(data);
      if (!data.ok || !data.job) {
        setError(data.error ?? "動画生成に失敗しました");
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
        <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>⑦ Videos</h2>
        <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>
          Seedance v1 Lite で各シーンの mp4 を生成。dry-run でコスト試算 → 本実行。
        </p>
      </header>

      <div
        style={{
          display: "flex",
          gap: 16,
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        <label style={{ fontSize: 13 }}>
          <input
            type="checkbox"
            checked={dryRun}
            onChange={(e) => setDryRun(e.target.checked)}
            disabled={running}
            style={{ marginRight: 6 }}
          />
          dry-run（fal.ai を呼ばずプロンプト確認のみ）
        </label>
        <label style={{ fontSize: 13 }}>
          解像度:{" "}
          <select
            value={resolution}
            onChange={(e) => setResolution(e.target.value as "480p" | "720p")}
            disabled={running}
            style={{ padding: "4px 6px" }}
          >
            <option value="480p">480p</option>
            <option value="720p">720p</option>
          </select>
        </label>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={() => runAll(false)}
          disabled={running}
          style={primary(running)}
        >
          {running
            ? "生成中..."
            : dryRun
              ? "dry-run 実行"
              : "全シーン生成（既存 skip）"}
        </button>
        <button
          type="button"
          onClick={() => runAll(true)}
          disabled={running || dryRun}
          style={secondary(running)}
        >
          全シーン強制再生成
        </button>
        <span
          style={{ alignSelf: "center", fontSize: 12, color: "var(--muted)" }}
        >
          status: <strong>{status}</strong> / {generated.length} /{" "}
          {scenePlan?.scenes.length ?? 0} 完了
        </span>
      </div>

      {scenePlan ? (
        <ul
          style={{
            listStyle: "none",
            padding: 0,
            margin: 0,
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
            gap: 12,
          }}
        >
          {scenePlan.scenes.map((s) => {
            const done = generated.includes(s.index);
            const url = `/api/ukiyoe/${job.id}/assets/videos/scene-${sceneToken(s.index)}.mp4`;
            return (
              <li
                key={s.index}
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  padding: 8,
                  background: "var(--card)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: 12,
                    marginBottom: 6,
                  }}
                >
                  <strong>scene[{s.index}]</strong>
                  <span style={{ color: done ? "#2e7d32" : "var(--muted)" }}>
                    {done ? "✓" : "未"}
                  </span>
                </div>
                {done ? (
                  <video
                    src={url}
                    controls
                    muted
                    style={{
                      width: "100%",
                      aspectRatio: "9/16",
                      objectFit: "cover",
                      borderRadius: 4,
                      background: "#000",
                    }}
                  />
                ) : (
                  <div
                    style={{
                      width: "100%",
                      aspectRatio: "9/16",
                      borderRadius: 4,
                      background: "var(--bg)",
                      display: "grid",
                      placeItems: "center",
                      color: "var(--muted)",
                      fontSize: 11,
                    }}
                  >
                    未生成
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}

      {error ? (
        <p style={{ color: "#d32f2f", fontSize: 13, margin: 0 }}>{error}</p>
      ) : null}

      {last ? (
        <details style={{ fontSize: 12 }}>
          <summary style={{ cursor: "pointer" }}>
            直近の結果（dryRun: {String(last.dryRun)}, 試算: $
            {(last.totalEstimatedCostUsd ?? 0).toFixed(3)},{" "}
            {last.elapsedSec?.toFixed(1)}秒）
          </summary>
          <pre
            style={{
              background: "var(--card)",
              padding: 8,
              borderRadius: 4,
              overflowX: "auto",
              fontSize: 11,
              maxHeight: 300,
            }}
          >
            {JSON.stringify(last.results ?? [], null, 2)}
          </pre>
          <pre
            style={{
              background: "var(--bg)",
              padding: 8,
              borderRadius: 4,
              overflowX: "auto",
              fontSize: 11,
              maxHeight: 200,
            }}
          >
            {(last.logs ?? []).join("\n")}
          </pre>
        </details>
      ) : null}

      <div>
        <button
          type="button"
          onClick={onAdvance}
          disabled={!allDone}
          style={primary(false)}
          title={!allDone ? "全シーンの mp4 が必要です（dryRun 不可）" : undefined}
        >
          Render へ進む →
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

function secondary(loading: boolean): React.CSSProperties {
  return {
    padding: "10px 18px",
    background: "transparent",
    color: "var(--accent)",
    border: "1px solid var(--accent)",
    borderRadius: 6,
    fontWeight: 600,
    cursor: loading ? "not-allowed" : "pointer",
    opacity: loading ? 0.6 : 1,
  };
}
