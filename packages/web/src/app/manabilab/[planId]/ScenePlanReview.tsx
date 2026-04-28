"use client";

import { useMemo, useState } from "react";
import type { PlanAudio, SceneSpec } from "@/lib/plan";
import type { SceneWithUrl } from "./page";

interface Props {
  planId: string;
  title: string;
  totalDurationSec: number;
  audio: PlanAudio;
  scenes: SceneWithUrl[];
}

interface GenerateApiResult {
  ok: boolean;
  result?: {
    planId: string;
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

const KIND_LABEL: Record<SceneSpec["kind"], string> = {
  image: "C/B 画像",
  "title-card": "T タイトル",
};

const KIND_COLOR: Record<SceneSpec["kind"], string> = {
  image: "#fce4ec",
  "title-card": "#e3f2fd",
};

export function ScenePlanReview({
  planId,
  title,
  totalDurationSec,
  audio,
  scenes: initialScenes,
}: Props) {
  const [scenes, setScenes] = useState(initialScenes);
  const [generating, setGenerating] = useState(false);
  const [genResult, setGenResult] = useState<GenerateApiResult | null>(null);

  const totalScenes = scenes.length;
  const approvedCount = scenes.filter((s) => s.spec.approved).length;
  const allApproved = approvedCount === totalScenes;

  const imageSceneCount = useMemo(
    () => scenes.filter((s) => s.spec.kind === "image").length,
    [scenes],
  );

  const setSceneApproved = (index: number, approved: boolean) => {
    setScenes((prev) =>
      prev.map((s) =>
        s.spec.index === index ? { ...s, spec: { ...s.spec, approved } } : s,
      ),
    );
  };

  const setScenePrompt = (index: number, prompt: string) => {
    setScenes((prev) =>
      prev.map((s) => {
        if (s.spec.index !== index || s.spec.kind !== "image") return s;
        return { ...s, spec: { ...s.spec, seedancePrompt: prompt } };
      }),
    );
  };

  const handleApproveAll = () => {
    setScenes((prev) => prev.map((s) => ({ ...s, spec: { ...s.spec, approved: true } })));
  };

  const handleGenerate = async (mode: "dry-run" | "exec") => {
    if (mode === "exec") {
      const ok = window.confirm(
        `本実行します。Seedance Lite に ${imageSceneCount} 個のシーンを送信し、約 $${(imageSceneCount * 0.15).toFixed(2)} の課金が発生します。続行しますか？`,
      );
      if (!ok) return;
    }
    setGenerating(true);
    setGenResult(null);
    try {
      const res = await fetch(`/api/manabilab/${planId}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun: mode === "dry-run" }),
      });
      const data = (await res.json()) as GenerateApiResult;
      setGenResult(data);
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
          {planId} : {title}
        </h1>
        <div style={{ fontSize: 13, color: "var(--muted)" }}>
          {totalScenes} シーン (うち画像 {imageSceneCount} / タイトル{" "}
          {totalScenes - imageSceneCount}) ・ {totalDurationSec.toFixed(2)} 秒 ・ 音声:{" "}
          {audio.voiceProvider}
          {audio.voiceName ? `（${audio.voiceName}）` : ""}
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
              <th style={th}>種別</th>
              <th style={th}>Beat / 時間</th>
              <th style={th}>ナレーション</th>
              <th style={th}>素材</th>
              <th style={{ ...th, width: 360 }}>Seedance プロンプト</th>
              <th style={{ ...th, width: 80, textAlign: "center" }}>OK</th>
            </tr>
          </thead>
          <tbody>
            {scenes.map(({ spec, imageUrl }) => (
              <tr key={spec.index} style={{ borderTop: "1px solid var(--border)" }}>
                <td style={td}>{spec.index}</td>
                <td style={td}>
                  <span
                    style={{
                      display: "inline-block",
                      padding: "2px 8px",
                      borderRadius: 4,
                      background: KIND_COLOR[spec.kind],
                      fontSize: 11,
                      fontWeight: 600,
                    }}
                  >
                    {KIND_LABEL[spec.kind]}
                  </span>
                </td>
                <td style={td}>
                  <div style={{ fontWeight: 600 }}>{spec.beat}</div>
                  <div style={{ color: "var(--muted)", fontSize: 11, marginTop: 2 }}>
                    {spec.startSec.toFixed(2)} - {spec.endSec.toFixed(2)}s ({(spec.endSec - spec.startSec).toFixed(2)}s)
                  </div>
                </td>
                <td style={{ ...td, maxWidth: 280 }}>
                  <div>{spec.narration}</div>
                  {spec.kind === "image" && spec.overlay && (
                    <div
                      style={{
                        marginTop: 6,
                        fontSize: 11,
                        color: "var(--accent)",
                      }}
                    >
                      ▸ overlay: 「{spec.overlay.text}」（{spec.overlay.color}/
                      {spec.overlay.position}）
                    </div>
                  )}
                </td>
                <td style={{ ...td, width: 140 }}>
                  {imageUrl ? (
                    <a href={imageUrl} target="_blank" rel="noopener noreferrer">
                      <img
                        src={imageUrl}
                        alt={`scene ${spec.index}`}
                        style={{
                          width: 120,
                          height: 200,
                          objectFit: "contain",
                          background: "#f9fafb",
                          border: "1px solid var(--border)",
                          borderRadius: 4,
                        }}
                      />
                    </a>
                  ) : (
                    <div
                      style={{
                        width: 120,
                        height: 200,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        background: "#fafafa",
                        border: "1px dashed var(--border)",
                        borderRadius: 4,
                        fontSize: 11,
                        color: "var(--muted)",
                        textAlign: "center",
                        padding: 8,
                      }}
                    >
                      Remotion<br />タイトルカード<br />
                      {spec.kind === "title-card" && (
                        <span
                          style={{
                            display: "block",
                            marginTop: 4,
                            fontWeight: 600,
                          }}
                        >
                          {spec.titleCardKind}
                          {spec.kind === "title-card" && spec.methodName ? ` / ${spec.methodName}` : ""}
                        </span>
                      )}
                    </div>
                  )}
                </td>
                <td style={td}>
                  {spec.kind === "image" ? (
                    <textarea
                      value={spec.seedancePrompt}
                      onChange={(e) => setScenePrompt(spec.index, e.target.value)}
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
                  ) : (
                    <div style={{ color: "var(--muted)", fontSize: 12 }}>
                      （Remotion 描画のため Seedance 不要）
                    </div>
                  )}
                </td>
                <td style={{ ...td, textAlign: "center" }}>
                  <input
                    type="checkbox"
                    checked={spec.approved}
                    onChange={(e) => setSceneApproved(spec.index, e.target.checked)}
                    style={{ width: 20, height: 20, cursor: "pointer" }}
                  />
                </td>
              </tr>
            ))}
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
            🧪 Dry Run（無課金 / 内容確認のみ）
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
        画像シーン {imageSceneCount} 個を Seedance V1 Lite (720p / 9:16) で動画化します。
        Dry Run は fal.ai を呼ばず、各シーンに送られる prompt と推定コストだけ表示します。
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
                        {s.prompt.slice(0, 120)}
                        {s.prompt.length > 120 ? "…" : ""}
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
