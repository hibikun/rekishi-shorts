"use client";

import { useEffect, useState } from "react";
import type { SelfMotivationJob } from "@rekishi/shared";

interface Props {
  job: SelfMotivationJob;
  onJobChange: (job: SelfMotivationJob) => void;
}

interface RenderStatus {
  state: "idle" | "running" | "done" | "error";
  progress: number;
  startedAt?: string;
  updatedAt?: string;
  error?: string;
  outputPath?: string;
  durationSec?: number;
}

export function RenderPanel({ job, onJobChange }: Props) {
  const [status, setStatus] = useState<RenderStatus>({
    state:
      job.steps.render.status === "in-progress"
        ? "running"
        : job.steps.render.status === "done"
          ? "done"
          : job.steps.render.status === "error"
            ? "error"
            : "idle",
    progress: job.steps.render.progress ?? 0,
  });
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 進行中なら 2s ごとに status を polling
  useEffect(() => {
    if (status.state !== "running") return;
    let cancelled = false;
    const id = setInterval(async () => {
      try {
        const res = await fetch(
          `/api/self-motivation/${job.id}/render/status`,
        );
        const data = (await res.json()) as {
          ok: boolean;
          status?: RenderStatus;
          error?: string;
        };
        if (cancelled) return;
        if (!data.ok || !data.status) return;
        setStatus(data.status);
        if (data.status.state === "done" || data.status.state === "error") {
          clearInterval(id);
        }
      } catch {
        // 一時的なネットワークエラーは無視
      }
    }, 2000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [status.state, job.id]);

  const onStart = async () => {
    setStarting(true);
    setError(null);
    setStatus({ state: "running", progress: 0 });
    try {
      const res = await fetch(`/api/self-motivation/${job.id}/render/start`, {
        method: "POST",
      });
      const data = (await res.json()) as {
        ok: boolean;
        error?: string;
        job?: SelfMotivationJob;
      };
      if (!data.ok) {
        setError(data.error ?? "起動に失敗しました");
        setStatus({ state: "error", progress: 0, error: data.error });
        return;
      }
      if (data.job) onJobChange(data.job);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus({
        state: "error",
        progress: 0,
        error: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setStarting(false);
    }
  };

  const outputUrl = status.outputPath
    ? `/self-motivation/${status.outputPath}`
    : job.steps.render.outputPath
      ? `/self-motivation/${job.steps.render.outputPath}`
      : null;

  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 8,
        background: "var(--card)",
        padding: 16,
        display: "grid",
        gap: 10,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <strong style={{ fontSize: 14 }}>🎬 レンダリング</strong>
        <span
          style={{
            fontSize: 12,
            color:
              status.state === "running"
                ? "#1976d2"
                : status.state === "done"
                  ? "#2e7d32"
                  : status.state === "error"
                    ? "#c62828"
                    : "var(--muted)",
          }}
        >
          {labelFor(status.state)}
          {status.state === "running"
            ? `  ${(status.progress * 100).toFixed(0)}%`
            : ""}
        </span>
      </div>

      {status.state === "running" ? (
        <div
          style={{
            height: 8,
            background: "var(--border)",
            borderRadius: 4,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: `${(status.progress * 100).toFixed(1)}%`,
              height: "100%",
              background: "#1976d2",
              transition: "width 1s linear",
            }}
          />
        </div>
      ) : null}

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
          onClick={onStart}
          disabled={starting || status.state === "running"}
          style={{
            padding: "8px 16px",
            background: "var(--accent)",
            color: "white",
            border: "none",
            borderRadius: 6,
            fontSize: 13,
            fontWeight: 600,
            cursor:
              starting || status.state === "running" ? "not-allowed" : "pointer",
            opacity: starting || status.state === "running" ? 0.6 : 1,
          }}
        >
          {status.state === "running" ? "レンダ中..." : "▶ 背景でレンダリング開始"}
        </button>
        {outputUrl ? (
          <a
            href={outputUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontSize: 13, color: "var(--accent)" }}
          >
            完成 mp4 を開く →
          </a>
        ) : null}
      </div>

      {status.state === "error" && status.error ? (
        <div style={{ fontSize: 12, color: "#d32f2f" }}>⚠ {status.error}</div>
      ) : null}
      {error ? (
        <div style={{ fontSize: 12, color: "#d32f2f" }}>⚠ {error}</div>
      ) : null}

      <div style={{ fontSize: 11, color: "var(--muted)" }}>
        全シーンの画像と TTS を生成し、TTS を結合した状態でレンダリングできます。
        10 分動画でローカル 30〜60 分が目安。
      </div>
    </div>
  );
}

function labelFor(state: RenderStatus["state"]): string {
  switch (state) {
    case "idle":
      return "未実行";
    case "running":
      return "レンダ中";
    case "done":
      return "完成";
    case "error":
      return "エラー";
  }
}
