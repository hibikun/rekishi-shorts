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

interface RegenerateImageApiResult {
  ok: boolean;
  sceneIndex?: number;
  imagePath?: string;
  imageUrl?: string;
  prompt?: string;
  usedReference?: boolean;
  referenceSource?: "current" | "fallback-hero" | "none";
  seedancePrompt?: string;
  seedancePromptDerived?: boolean;
  error?: string;
}

interface RefreshSeedanceApiResult {
  ok: boolean;
  sceneIndex?: number;
  description?: string;
  seedancePrompt?: string;
  oldPrompt?: string;
  error?: string;
}

interface GenerateTtsApiResult {
  ok: boolean;
  result?: {
    audioPath: string;
    totalDurationSec: number;
    characters: number;
    scenes: Array<{
      index: number;
      startSec: number;
      endSec: number;
      durationSec: number;
    }>;
    brokenByGuard: boolean;
    qualityReasons: string[];
  };
  error?: string;
  logs: string[];
}

interface RenderApiResult {
  ok: boolean;
  result?: {
    outputPath: string;
    outputRelPath: string;
    totalDurationSec: number;
    sceneCount: number;
  };
  elapsedSec?: number;
  error?: string;
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
  const [imageInstructions, setImageInstructions] = useState<Record<number, string>>({});
  const [regeneratingScene, setRegeneratingScene] = useState<number | null>(null);
  const [regenError, setRegenError] = useState<{ index: number; message: string } | null>(null);
  const [refreshingSeedanceScene, setRefreshingSeedanceScene] = useState<number | null>(null);
  const [ttsGenerating, setTtsGenerating] = useState(false);
  const [ttsResult, setTtsResult] = useState<GenerateTtsApiResult | null>(null);
  const [audioCacheBust, setAudioCacheBust] = useState<number>(0);
  const [rendering, setRendering] = useState(false);
  const [renderResult, setRenderResult] = useState<RenderApiResult | null>(null);

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

  const handleRegenerateImage = async (sceneIndex: number) => {
    const instruction = (imageInstructions[sceneIndex] ?? "").trim();
    if (!instruction) {
      setRegenError({ index: sceneIndex, message: "変更要望を入力してください" });
      return;
    }
    setRegenError(null);
    setRegeneratingScene(sceneIndex);
    try {
      const res = await fetch(
        `/api/manabilab/${planId}/scenes/${sceneIndex}/regenerate-image`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ instruction }),
        },
      );
      const data = (await res.json()) as RegenerateImageApiResult;
      if (!data.ok || !data.imagePath || !data.imageUrl) {
        setRegenError({
          index: sceneIndex,
          message: data.error ?? "画像生成に失敗しました",
        });
        return;
      }
      // 画像を差し替え + キャッシュバスタを付けてブラウザに再取得させる
      // Seedance プロンプトも自動派生されていればそれに更新する
      const cacheBustedUrl = `${data.imageUrl}?t=${Date.now()}`;
      setScenes((prev) =>
        prev.map((s) => {
          if (s.spec.index !== sceneIndex || s.spec.kind !== "image") return s;
          return {
            ...s,
            imageUrl: cacheBustedUrl,
            spec: {
              ...s.spec,
              imagePath: data.imagePath!,
              approved: false,
              ...(data.seedancePrompt
                ? { seedancePrompt: data.seedancePrompt }
                : {}),
            },
          };
        }),
      );
      // 入力欄をクリア
      setImageInstructions((prev) => {
        const next = { ...prev };
        delete next[sceneIndex];
        return next;
      });
    } catch (err) {
      setRegenError({
        index: sceneIndex,
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setRegeneratingScene(null);
    }
  };

  const handleGenerateTts = async () => {
    const ok = window.confirm(
      "VOICEVOX で TTS を生成し、Whisper で字幕アラインを実行します。\n\n" +
        "・VOICEVOX engine が起動している必要があります（http://127.0.0.1:50021）\n" +
        "・所要時間: 約1〜2分\n" +
        "・実行後、各シーンの startSec/endSec が実音声の値で上書きされます\n\n" +
        "続行しますか？",
    );
    if (!ok) return;
    setTtsGenerating(true);
    setTtsResult(null);
    try {
      const res = await fetch(`/api/manabilab/${planId}/generate-tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = (await res.json()) as GenerateTtsApiResult;
      setTtsResult(data);
      if (data.ok && data.result) {
        // scene の startSec/endSec を新しい timing に更新
        const timings = new Map(
          data.result.scenes.map((s) => [s.index, s] as const),
        );
        setScenes((prev) =>
          prev.map((s) => {
            const t = timings.get(s.spec.index);
            if (!t) return s;
            return {
              ...s,
              spec: { ...s.spec, startSec: t.startSec, endSec: t.endSec },
            };
          }),
        );
        setAudioCacheBust(Date.now());
      }
    } catch (err) {
      setTtsResult({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        logs: [],
      });
    } finally {
      setTtsGenerating(false);
    }
  };

  const handleRender = async () => {
    const ok = window.confirm(
      "Remotion で最終 mp4 を合成します。\n\n" +
        "・前提: TTS音声 / Seedance mp4 12本 / 全シーン startSec/endSec が確定済\n" +
        "・所要時間: 約1〜3分（Remotion bundle + ffmpeg encode）\n" +
        "・出力先: packages/channels/manabilab/assets/videos/{title}-{planId}.mp4\n\n" +
        "続行しますか？",
    );
    if (!ok) return;
    setRendering(true);
    setRenderResult(null);
    try {
      const res = await fetch(`/api/manabilab/${planId}/render`, {
        method: "POST",
      });
      const data = (await res.json()) as RenderApiResult;
      setRenderResult(data);
    } catch (err) {
      setRenderResult({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setRendering(false);
    }
  };

  const handleRefreshSeedance = async (sceneIndex: number) => {
    setRegenError(null);
    setRefreshingSeedanceScene(sceneIndex);
    try {
      const res = await fetch(
        `/api/manabilab/${planId}/scenes/${sceneIndex}/refresh-seedance`,
        { method: "POST" },
      );
      const data = (await res.json()) as RefreshSeedanceApiResult;
      if (!data.ok || !data.seedancePrompt) {
        setRegenError({
          index: sceneIndex,
          message: data.error ?? "Seedance プロンプト更新に失敗しました",
        });
        return;
      }
      setScenes((prev) =>
        prev.map((s) => {
          if (s.spec.index !== sceneIndex || s.spec.kind !== "image") return s;
          return {
            ...s,
            spec: { ...s.spec, seedancePrompt: data.seedancePrompt! },
          };
        }),
      );
    } catch (err) {
      setRegenError({
        index: sceneIndex,
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setRefreshingSeedanceScene(null);
    }
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
          padding: 16,
          marginBottom: 24,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
        }}
      >
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
            🎤 TTS + 字幕アライン
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>
            VOICEVOX で <code>{audio.path.split("/").pop()}</code> を生成 → Whisper で word
            timing を取得 → plan の startSec/endSec を実測値で上書き
          </div>
          {audioCacheBust > 0 && (
            <audio
              key={audioCacheBust}
              controls
              src={`/manabilab/audio/${audio.path.split("/").pop()}?t=${audioCacheBust}`}
              style={{ marginTop: 8, width: "100%", maxWidth: 480 }}
            />
          )}
        </div>
        <button
          onClick={handleGenerateTts}
          disabled={ttsGenerating}
          style={{
            background: ttsGenerating ? "var(--border)" : "var(--accent)",
            color: "#fff",
            border: 0,
            padding: "12px 20px",
            borderRadius: 8,
            cursor: ttsGenerating ? "not-allowed" : "pointer",
            fontSize: 14,
            fontWeight: 700,
            whiteSpace: "nowrap",
          }}
        >
          {ttsGenerating ? "🎤 生成中... (~1-2分)" : "🎤 TTS生成 + 字幕アライン"}
        </button>
      </div>

      {ttsResult && <TtsResultPanel result={ttsResult} />}

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
                <td style={{ ...td, width: 200 }}>
                  {imageUrl ? (
                    <a href={imageUrl} target="_blank" rel="noopener noreferrer">
                      <img
                        src={imageUrl}
                        alt={`scene ${spec.index}`}
                        style={{
                          width: 180,
                          height: 300,
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
                        width: 180,
                        height: 300,
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
                  {spec.kind === "image" && (
                    <div style={{ marginTop: 8 }}>
                      <textarea
                        value={imageInstructions[spec.index] ?? ""}
                        onChange={(e) =>
                          setImageInstructions((prev) => ({
                            ...prev,
                            [spec.index]: e.target.value,
                          }))
                        }
                        placeholder="変更要望（例: 太陽の下で勉強している感じに）"
                        disabled={regeneratingScene !== null}
                        style={{
                          width: "100%",
                          minHeight: 60,
                          padding: 6,
                          fontSize: 11,
                          fontFamily: "inherit",
                          border: "1px solid var(--border)",
                          borderRadius: 4,
                          resize: "vertical",
                          boxSizing: "border-box",
                        }}
                      />
                      <button
                        onClick={() => handleRegenerateImage(spec.index)}
                        disabled={regeneratingScene !== null}
                        style={{
                          marginTop: 4,
                          width: "100%",
                          background: regeneratingScene === spec.index ? "#e5e7eb" : "#fff",
                          color: "var(--accent)",
                          border: "1px solid var(--accent)",
                          padding: "6px 8px",
                          borderRadius: 4,
                          fontSize: 11,
                          fontWeight: 600,
                          cursor: regeneratingScene !== null ? "not-allowed" : "pointer",
                          opacity: regeneratingScene !== null && regeneratingScene !== spec.index ? 0.5 : 1,
                        }}
                      >
                        {regeneratingScene === spec.index
                          ? "🎨 生成中..."
                          : "🎨 画像を再生成"}
                      </button>
                      {regenError?.index === spec.index && (
                        <div
                          style={{
                            marginTop: 4,
                            fontSize: 10,
                            color: "#991b1b",
                          }}
                        >
                          {regenError.message}
                        </div>
                      )}
                    </div>
                  )}
                </td>
                <td style={td}>
                  {spec.kind === "image" ? (
                    <>
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
                          boxSizing: "border-box",
                        }}
                      />
                      <button
                        onClick={() => handleRefreshSeedance(spec.index)}
                        disabled={
                          regeneratingScene !== null ||
                          refreshingSeedanceScene !== null
                        }
                        title="現画像を Gemini Vision で読み取って Seedance プロンプトを再派生"
                        style={{
                          marginTop: 6,
                          width: "100%",
                          background:
                            refreshingSeedanceScene === spec.index
                              ? "#e5e7eb"
                              : "#fff",
                          color: "var(--accent)",
                          border: "1px dashed var(--accent)",
                          padding: "4px 8px",
                          borderRadius: 4,
                          fontSize: 11,
                          fontWeight: 600,
                          cursor:
                            regeneratingScene !== null ||
                            refreshingSeedanceScene !== null
                              ? "not-allowed"
                              : "pointer",
                          opacity:
                            (regeneratingScene !== null &&
                              regeneratingScene !== spec.index) ||
                            (refreshingSeedanceScene !== null &&
                              refreshingSeedanceScene !== spec.index)
                              ? 0.5
                              : 1,
                        }}
                      >
                        {refreshingSeedanceScene === spec.index
                          ? "🎬 Vision 解析中..."
                          : "🎬 Seedance のみ更新"}
                      </button>
                    </>
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

      <div
        style={{
          marginTop: 32,
          background: "var(--card)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          padding: 16,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
        }}
      >
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
            🎞️ 最終動画合成（Remotion）
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>
            ナレ wav + Seedance mp4 ×{imageSceneCount} + 自動字幕（budoux 分割）+ BGM
            を合成して 1 本の mp4 に出力。
          </div>
        </div>
        <button
          onClick={handleRender}
          disabled={rendering}
          style={{
            background: rendering ? "var(--border)" : "#10b981",
            color: "#fff",
            border: 0,
            padding: "12px 20px",
            borderRadius: 8,
            cursor: rendering ? "not-allowed" : "pointer",
            fontSize: 14,
            fontWeight: 700,
            whiteSpace: "nowrap",
          }}
        >
          {rendering ? "🎞️ 合成中... (~1-3分)" : "🎞️ Remotion で合成"}
        </button>
      </div>

      {renderResult && <RenderResultPanel result={renderResult} />}
    </main>
  );
}

function outputRelToUrl(p: string): string {
  const prefix = "packages/channels/manabilab/assets/";
  if (p.startsWith(prefix)) return `/manabilab/${p.slice(prefix.length)}`;
  return p;
}

function RenderResultPanel({ result }: { result: RenderApiResult }) {
  const videoUrl = result.result
    ? `${outputRelToUrl(result.result.outputRelPath)}?t=${Date.now()}`
    : "";
  return (
    <div
      style={{
        marginTop: 16,
        background: result.ok ? "#f0fdf4" : "#fef2f2",
        border: `1px solid ${result.ok ? "#bbf7d0" : "#fecaca"}`,
        borderRadius: 8,
        padding: 16,
        fontSize: 13,
      }}
    >
      <h3 style={{ margin: "0 0 12px", fontSize: 16, fontWeight: 700 }}>
        {result.ok ? "✓ 動画合成 完了" : "✗ 合成エラー"}
      </h3>
      {result.error && (
        <div style={{ color: "#991b1b", marginBottom: 12 }}>{result.error}</div>
      )}
      {result.result && (
        <>
          <div style={{ marginBottom: 8 }}>
            <code style={{ fontSize: 11 }}>{result.result.outputRelPath}</code>
          </div>
          <div style={{ color: "var(--muted)", fontSize: 12, marginBottom: 12 }}>
            {result.result.totalDurationSec.toFixed(2)}秒 / {result.result.sceneCount}{" "}
            シーン
            {result.elapsedSec
              ? ` ・ 合成時間 ${result.elapsedSec.toFixed(1)}s`
              : ""}
          </div>
          <video
            controls
            src={videoUrl}
            style={{
              width: "100%",
              maxWidth: 360,
              borderRadius: 4,
              background: "#000",
            }}
          />
        </>
      )}
    </div>
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

function TtsResultPanel({ result }: { result: GenerateTtsApiResult }) {
  return (
    <div
      style={{
        marginBottom: 24,
        background: result.ok ? "#f0fdf4" : "#fef2f2",
        border: `1px solid ${result.ok ? "#bbf7d0" : "#fecaca"}`,
        borderRadius: 8,
        padding: 16,
        fontSize: 13,
      }}
    >
      <h3 style={{ margin: "0 0 12px", fontSize: 16, fontWeight: 700 }}>
        {result.ok ? "✓ TTS + Alignment 完了" : "✗ TTS Pipeline エラー"}
      </h3>
      {result.error && (
        <div style={{ color: "#991b1b", marginBottom: 12 }}>{result.error}</div>
      )}
      {result.result && (
        <>
          <div style={{ color: "var(--muted)", marginBottom: 12 }}>
            総尺 <strong>{result.result.totalDurationSec.toFixed(2)}秒</strong> ({result.result.characters}{" "}
            文字) ・ scene 数 {result.result.scenes.length}
            {result.result.brokenByGuard && (
              <span style={{ color: "#b45309", marginLeft: 8 }}>
                ⚠ Whisper 破綻 → linear fallback ({result.result.qualityReasons.join(", ")})
              </span>
            )}
          </div>
          <details>
            <summary style={{ cursor: "pointer", color: "var(--muted)" }}>
              scene timings ({result.result.scenes.length})
            </summary>
            <table style={{ width: "100%", fontSize: 11, marginTop: 8 }}>
              <thead>
                <tr style={{ textAlign: "left", color: "var(--muted)" }}>
                  <th style={{ padding: 4 }}>#</th>
                  <th style={{ padding: 4 }}>start</th>
                  <th style={{ padding: 4 }}>end</th>
                  <th style={{ padding: 4 }}>duration</th>
                </tr>
              </thead>
              <tbody>
                {result.result.scenes.map((s) => (
                  <tr key={s.index} style={{ borderTop: "1px solid #e5e7eb" }}>
                    <td style={{ padding: 4 }}>{s.index}</td>
                    <td style={{ padding: 4 }}>{s.startSec.toFixed(2)}s</td>
                    <td style={{ padding: 4 }}>{s.endSec.toFixed(2)}s</td>
                    <td style={{ padding: 4 }}>{s.durationSec.toFixed(2)}s</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </>
      )}
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
