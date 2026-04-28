"use client";

import { useMemo, useState } from "react";
import type { UkiyoeSceneWithUrls } from "./page";

interface Props {
  jobId: string;
  topic: string;
  hook: string;
  totalDurationSec: number;
  sceneCount: number;
  scenes: UkiyoeSceneWithUrls[];
}

interface GenerateApiResult {
  ok: boolean;
  result?: {
    jobId: string;
    model: string;
    dryRun: boolean;
    resolution: string;
    totalEstimatedCostUsd: number;
    totalElapsedSec: number;
    scenes: Array<{
      index: number;
      status: string;
      prompt: string;
      duration: number;
      estimatedCostUsd: number;
      videoPath?: string;
      error?: string;
    }>;
  };
  error?: string;
  logs: string[];
}

interface SceneState {
  videoPrompt: string;
  cameraFixed: boolean | undefined;
  approved: boolean;
}

const ACTION_TAG_LABEL: Record<string, string> = {
  running_forward: "🏃 走る",
  eating_meal: "🍱 食事",
  drawing_sword: "⚔️ 抜刀",
  walking_carrying: "🚶 歩く",
  sleeping: "💤 就寝",
  crowd_cheering: "👥 群衆",
  weather_dynamic: "🌧️ 天候",
  still_subtle: "🌬️ 微動",
};

export function SceneReview({
  jobId,
  topic,
  hook,
  totalDurationSec,
  sceneCount,
  scenes: initialScenes,
}: Props) {
  const [sceneState, setSceneState] = useState<Record<number, SceneState>>(() => {
    const init: Record<number, SceneState> = {};
    for (const { spec } of initialScenes) {
      init[spec.index] = {
        videoPrompt: spec.videoPrompt,
        cameraFixed: spec.cameraFixed,
        approved: false,
      };
    }
    return init;
  });
  const [generating, setGenerating] = useState(false);
  const [genResult, setGenResult] = useState<GenerateApiResult | null>(null);
  const [videoCacheBust, setVideoCacheBust] = useState<number>(0);

  const totalScenes = initialScenes.length;
  const approvedCount = useMemo(
    () =>
      Object.values(sceneState).filter((s) => s.approved).length,
    [sceneState],
  );
  const allApproved = approvedCount === totalScenes;
  const totalEstimatedUsd = useMemo(
    // 720p 5s で約 $0.027/scene。事前見積もり用の概算。
    () => totalScenes * 0.027,
    [totalScenes],
  );

  const updateScene = (index: number, patch: Partial<SceneState>) => {
    setSceneState((prev) => ({
      ...prev,
      [index]: { ...prev[index]!, ...patch },
    }));
  };

  const handleApproveAll = () => {
    setSceneState((prev) => {
      const next = { ...prev };
      for (const i of Object.keys(next)) {
        next[Number(i)] = { ...next[Number(i)]!, approved: true };
      }
      return next;
    });
  };

  const handleGenerate = async (mode: "dry-run" | "exec") => {
    if (mode === "exec") {
      const ok = window.confirm(
        `本実行します。Seedance Lite に ${totalScenes} シーン送信し、約 $${totalEstimatedUsd.toFixed(2)} の課金が発生します。続行しますか？`,
      );
      if (!ok) return;
    }
    setGenerating(true);
    setGenResult(null);
    try {
      const res = await fetch(`/api/ukiyoe/${jobId}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dryRun: mode === "dry-run",
          scenes: initialScenes.map(({ spec }) => ({
            index: spec.index,
            videoPrompt: sceneState[spec.index]?.videoPrompt ?? spec.videoPrompt,
            cameraFixed: sceneState[spec.index]?.cameraFixed ?? spec.cameraFixed,
          })),
        }),
      });
      const data = (await res.json()) as GenerateApiResult;
      setGenResult(data);
      if (mode === "exec" && data.ok) setVideoCacheBust(Date.now());
    } catch (err) {
      setGenResult({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        logs: [],
      });
    } finally {
      setGenerating(false);
    }
  };

  return (
    <main style={{ maxWidth: 1200, margin: "32px auto", padding: "0 24px 80px" }}>
      <div style={{ marginBottom: 24 }}>
        <a
          href="/"
          style={{ fontSize: 12, color: "var(--muted)", textDecoration: "none" }}
        >
          ← 戻る
        </a>
        <h1 style={{ fontSize: 24, fontWeight: 800, marginTop: 8, marginBottom: 4 }}>
          {jobId}
        </h1>
        <div style={{ fontSize: 14, marginBottom: 4 }}>{topic}</div>
        <div style={{ fontSize: 13, color: "var(--muted)" }}>
          {sceneCount} シーン ・ {totalDurationSec.toFixed(2)} 秒 ・ Seedance V1 Lite (720p / 9:16)
        </div>
        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>
          Hook: {hook}
        </div>
      </div>

      <div
        style={{
          background: "var(--card)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          overflow: "hidden",
        }}
      >
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: 13,
          }}
        >
          <thead>
            <tr style={{ background: "#f3f4f6", textAlign: "left" }}>
              <th style={th}>#</th>
              <th style={th}>ナレーション / Action</th>
              <th style={th}>元画像</th>
              <th style={{ ...th, width: 220 }}>image prompt</th>
              <th style={{ ...th, width: 320 }}>video prompt（編集可）</th>
              <th style={{ ...th, width: 100, textAlign: "center" }}>カメラ</th>
              <th style={{ ...th, width: 80, textAlign: "center" }}>OK</th>
            </tr>
          </thead>
          <tbody>
            {initialScenes.map(({ spec, imageUrl, videoUrl }) => {
              const state = sceneState[spec.index]!;
              const cameraFixed = state.cameraFixed ?? false;
              return (
                <tr key={spec.index} style={{ borderTop: "1px solid var(--border)" }}>
                  <td style={td}>{spec.index}</td>
                  <td style={{ ...td, maxWidth: 240 }}>
                    <div>{spec.narration}</div>
                    <div
                      style={{
                        marginTop: 6,
                        fontSize: 11,
                        color: "var(--accent)",
                      }}
                    >
                      {ACTION_TAG_LABEL[spec.actionTag] ?? spec.actionTag}
                    </div>
                    <div style={{ marginTop: 4, fontSize: 11, color: "var(--muted)" }}>
                      {spec.durationSec.toFixed(2)}s
                    </div>
                  </td>
                  <td style={{ ...td, width: 140 }}>
                    <a href={imageUrl} target="_blank" rel="noopener noreferrer">
                      <img
                        src={imageUrl}
                        alt={`scene ${spec.index}`}
                        style={{
                          width: 120,
                          height: 200,
                          objectFit: "cover",
                          background: "#f9fafb",
                          border: "1px solid var(--border)",
                          borderRadius: 4,
                        }}
                      />
                    </a>
                    {videoCacheBust > 0 && (
                      <video
                        src={`${videoUrl}?t=${videoCacheBust}`}
                        controls
                        muted
                        style={{
                          width: 120,
                          marginTop: 6,
                          border: "1px solid var(--border)",
                          borderRadius: 4,
                        }}
                      />
                    )}
                  </td>
                  <td style={{ ...td, fontSize: 12, color: "var(--muted)" }}>
                    {spec.imagePrompt}
                  </td>
                  <td style={td}>
                    <textarea
                      value={state.videoPrompt}
                      onChange={(e) =>
                        updateScene(spec.index, { videoPrompt: e.target.value })
                      }
                      style={{
                        width: "100%",
                        minHeight: 100,
                        padding: 8,
                        fontSize: 12,
                        fontFamily: "inherit",
                        border: "1px solid var(--border)",
                        borderRadius: 4,
                        resize: "vertical",
                      }}
                    />
                  </td>
                  <td style={{ ...td, textAlign: "center" }}>
                    <label
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 4,
                        cursor: "pointer",
                        fontSize: 11,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={cameraFixed}
                        onChange={(e) =>
                          updateScene(spec.index, { cameraFixed: e.target.checked })
                        }
                      />
                      固定
                    </label>
                  </td>
                  <td style={{ ...td, textAlign: "center" }}>
                    <input
                      type="checkbox"
                      checked={state.approved}
                      onChange={(e) =>
                        updateScene(spec.index, { approved: e.target.checked })
                      }
                      style={{ width: 20, height: 20, cursor: "pointer" }}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div
        style={{
          marginTop: 24,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
        }}
      >
        <div style={{ color: "var(--muted)", fontSize: 13 }}>
          承認: {approvedCount} / {totalScenes}
          {!allApproved && (
            <button
              onClick={handleApproveAll}
              style={{
                marginLeft: 12,
                background: "transparent",
                border: "1px solid var(--border)",
                padding: "4px 10px",
                borderRadius: 4,
                cursor: "pointer",
                fontSize: 12,
              }}
            >
              全部 OK にする
            </button>
          )}
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          <button
            onClick={() => handleGenerate("dry-run")}
            disabled={!allApproved || generating}
            style={{
              background: "transparent",
              color: "var(--accent)",
              border: "1px solid var(--accent)",
              padding: "12px 20px",
              borderRadius: 8,
              cursor: allApproved && !generating ? "pointer" : "not-allowed",
              fontSize: 14,
              fontWeight: 700,
              opacity: allApproved && !generating ? 1 : 0.5,
            }}
          >
            🧪 Dry Run（無課金 / prompt 確認のみ）
          </button>
          <button
            onClick={() => handleGenerate("exec")}
            disabled={!allApproved || generating}
            style={{
              background: allApproved && !generating ? "var(--accent)" : "var(--border)",
              color: "#fff",
              border: 0,
              padding: "12px 28px",
              borderRadius: 8,
              cursor: allApproved && !generating ? "pointer" : "not-allowed",
              fontSize: 15,
              fontWeight: 700,
            }}
          >
            {generating ? "生成中..." : "🎬 本実行（Seedance 課金）"}
          </button>
        </div>
      </div>
      <div
        style={{
          marginTop: 12,
          fontSize: 12,
          color: "var(--muted)",
        }}
      >
        全 {totalScenes} シーンを Seedance V1 Lite (720p / 9:16, 5s) で動画化します。概算 約 ${totalEstimatedUsd.toFixed(2)}。
        Dry Run は fal.ai を呼ばず、各シーンに送られる最終 prompt と推定コストだけ表示します。
      </div>

      {genResult && <GenerationResultPanel result={genResult} />}
    </main>
  );
}

function GenerationResultPanel({ result }: { result: GenerateApiResult }) {
  return (
    <div
      style={{
        marginTop: 32,
        background: result.ok ? "#f0fdf4" : "#fef2f2",
        border: `1px solid ${result.ok ? "#bbf7d0" : "#fecaca"}`,
        borderRadius: 8,
        padding: 16,
        fontSize: 13,
      }}
    >
      <h3 style={{ margin: "0 0 12px", fontSize: 16, fontWeight: 700 }}>
        {result.ok
          ? `${result.result?.dryRun ? "🧪 Dry Run" : "✓ 実行"} 結果`
          : "✗ エラー"}
      </h3>
      {result.error && (
        <div style={{ color: "#991b1b", marginBottom: 12 }}>{result.error}</div>
      )}
      {result.result && (
        <>
          <div style={{ color: "var(--muted)", marginBottom: 12 }}>
            model: <code>{result.result.model}</code> ・ 解像度{" "}
            {result.result.resolution} ・ 推定 ${result.result.totalEstimatedCostUsd.toFixed(3)} ・{" "}
            {result.result.totalElapsedSec.toFixed(1)}s
          </div>
          <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--muted)" }}>
                <th style={{ padding: 4 }}>#</th>
                <th style={{ padding: 4 }}>status</th>
                <th style={{ padding: 4 }}>duration</th>
                <th style={{ padding: 4 }}>$</th>
                <th style={{ padding: 4 }}>prompt / videoPath</th>
              </tr>
            </thead>
            <tbody>
              {result.result.scenes.map((s) => (
                <tr key={s.index} style={{ borderTop: "1px solid #e5e7eb" }}>
                  <td style={{ padding: 4 }}>{s.index}</td>
                  <td style={{ padding: 4 }}>
                    <span
                      style={{
                        fontWeight: 600,
                        color:
                          s.status === "done"
                            ? "var(--good)"
                            : s.status === "error"
                              ? "#991b1b"
                              : s.status === "dry-run"
                                ? "var(--accent)"
                                : "var(--muted)",
                      }}
                    >
                      {s.status}
                    </span>
                  </td>
                  <td style={{ padding: 4 }}>{s.duration > 0 ? `${s.duration}s` : "-"}</td>
                  <td style={{ padding: 4 }}>${s.estimatedCostUsd.toFixed(3)}</td>
                  <td style={{ padding: 4 }}>
                    {s.videoPath ? (
                      <code style={{ fontSize: 11 }}>{s.videoPath}</code>
                    ) : s.error ? (
                      <span style={{ color: "#991b1b" }}>{s.error}</span>
                    ) : (
                      <span style={{ color: "var(--muted)" }}>
                        {s.prompt.slice(0, 140)}
                        {s.prompt.length > 140 ? "…" : ""}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {result.logs.length > 0 && (
            <details style={{ marginTop: 12 }}>
              <summary style={{ cursor: "pointer", color: "var(--muted)" }}>
                logs ({result.logs.length})
              </summary>
              <pre
                style={{
                  background: "#f9fafb",
                  padding: 8,
                  borderRadius: 4,
                  fontSize: 11,
                  whiteSpace: "pre-wrap",
                  maxHeight: 240,
                  overflow: "auto",
                }}
              >
                {result.logs.join("\n")}
              </pre>
            </details>
          )}
        </>
      )}
    </div>
  );
}

const th: React.CSSProperties = {
  padding: "12px 16px",
  fontSize: 11,
  fontWeight: 700,
  color: "var(--muted)",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};

const td: React.CSSProperties = {
  padding: "16px",
  verticalAlign: "top",
};
