"use client";

import { useMemo, useState } from "react";
import type { UkiyoeSceneWithUrls } from "./page";

interface Props {
  jobId: string;
  topic: string;
  hook: string;
  narration: string;
  era: string | null;
  keyTerms: string[];
  readings: Record<string, string>;
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
  videoPromptJa: string;
  videoPromptEn: string;
  /** Ja を編集したが英訳ボタン未押下＝ En が古い可能性あり */
  videoPromptDirty: boolean;
  cameraFixed: boolean | undefined;
  approved: boolean;
}

interface TranslateApiResult {
  ok: boolean;
  sceneIndex?: number;
  en?: string;
  ja?: string;
  error?: string;
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

interface RegenerateApiResult {
  ok: boolean;
  jobId?: string;
  elapsedSec?: number;
  stdoutTail?: string;
  error?: string;
}

export function SceneReview({
  jobId,
  topic,
  hook,
  narration: initialNarration,
  era,
  keyTerms,
  readings,
  totalDurationSec,
  sceneCount,
  scenes: initialScenes,
}: Props) {
  const [sceneState, setSceneState] = useState<Record<number, SceneState>>(() => {
    const init: Record<number, SceneState> = {};
    for (const { spec } of initialScenes) {
      init[spec.index] = {
        videoPromptJa: spec.videoPromptJa ?? "",
        videoPromptEn: spec.videoPrompt,
        videoPromptDirty: false,
        cameraFixed: spec.cameraFixed,
        approved: false,
      };
    }
    return init;
  });
  const [generating, setGenerating] = useState(false);
  const [genResult, setGenResult] = useState<GenerateApiResult | null>(null);
  const [videoCacheBust, setVideoCacheBust] = useState<number>(0);
  const [translatingScene, setTranslatingScene] = useState<number | null>(null);
  const [translateError, setTranslateError] = useState<{
    index: number;
    message: string;
  } | null>(null);

  // 台本編集 state
  const [editorOpen, setEditorOpen] = useState(false);
  const [editNarration, setEditNarration] = useState(initialNarration);
  const [editTopic, setEditTopic] = useState(topic);
  const [editHook, setEditHook] = useState(hook);
  const [editEra, setEditEra] = useState(era ?? "");
  const [editSceneCount, setEditSceneCount] = useState<number>(sceneCount);
  const [editKeyTerms, setEditKeyTerms] = useState(keyTerms.join("\n"));
  const [editReadings, setEditReadings] = useState(
    Object.entries(readings)
      .map(([k, v]) => `${k}=${v}`)
      .join("\n"),
  );
  const [regenerating, setRegenerating] = useState(false);
  const [regenResult, setRegenResult] = useState<RegenerateApiResult | null>(null);

  const narrationDirty =
    editNarration !== initialNarration ||
    editTopic !== topic ||
    editHook !== hook ||
    (editEra || null) !== era ||
    editSceneCount !== sceneCount ||
    editKeyTerms !== keyTerms.join("\n") ||
    editReadings !==
      Object.entries(readings)
        .map(([k, v]) => `${k}=${v}`)
        .join("\n");

  const totalScenes = initialScenes.length;
  const approvedCount = useMemo(
    () =>
      Object.values(sceneState).filter((s) => s.approved).length,
    [sceneState],
  );
  const allApproved = approvedCount === totalScenes;
  const dirtyCount = useMemo(
    () => Object.values(sceneState).filter((s) => s.videoPromptDirty).length,
    [sceneState],
  );
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
        const cur = next[Number(i)]!;
        // dirty な行は承認しない（未翻訳の Ja で Seedance を呼ぶ事故を防ぐ）
        if (cur.videoPromptDirty) continue;
        next[Number(i)] = { ...cur, approved: true };
      }
      return next;
    });
  };

  const handleTranslate = async (sceneIndex: number) => {
    const cur = sceneState[sceneIndex];
    if (!cur) return;
    const ja = cur.videoPromptJa.trim();
    if (!ja) {
      setTranslateError({ index: sceneIndex, message: "日本語を入力してください" });
      return;
    }
    setTranslateError(null);
    setTranslatingScene(sceneIndex);
    try {
      const res = await fetch(`/api/ukiyoe/${jobId}/translate-video-prompt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ index: sceneIndex, ja }),
      });
      const data = (await res.json()) as TranslateApiResult;
      if (!data.ok || !data.en) {
        setTranslateError({
          index: sceneIndex,
          message: data.error ?? "英訳に失敗しました",
        });
        return;
      }
      updateScene(sceneIndex, {
        videoPromptEn: data.en,
        videoPromptDirty: false,
      });
    } catch (err) {
      setTranslateError({
        index: sceneIndex,
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setTranslatingScene(null);
    }
  };

  const handleSaveAndRegenerate = async () => {
    if (
      !window.confirm(
        `台本を保存して scene-plan / 画像 / TTS を一から再生成します。既存の動画 (.mp4) も無効になり再生成が必要になります。続行しますか？`,
      )
    ) {
      return;
    }
    const keyTermsArr = editKeyTerms
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    const readingsObj: Record<string, string> = {};
    for (const line of editReadings.split("\n")) {
      const [k, v] = line.split("=").map((s) => s.trim());
      if (k && v) readingsObj[k] = v;
    }

    setRegenerating(true);
    setRegenResult(null);
    try {
      const res = await fetch(`/api/ukiyoe/${jobId}/regenerate-from-script`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          narration: editNarration,
          hook: editHook,
          topic: editTopic,
          era: editEra || undefined,
          keyTerms: keyTermsArr,
          readings: readingsObj,
          targetSceneCount: editSceneCount,
        }),
      });
      const data = (await res.json()) as RegenerateApiResult;
      setRegenResult(data);
      if (data.ok) {
        // 新しい scene-plan / 画像で表示し直し
        window.location.reload();
      }
    } catch (err) {
      setRegenResult({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setRegenerating(false);
    }
  };

  const handleGenerate = async (mode: "dry-run" | "exec") => {
    if (dirtyCount > 0) {
      const skip = window.confirm(
        `${dirtyCount} シーンに未翻訳の日本語編集があります。\n` +
          `（このまま実行すると古い英語プロンプトで Seedance が呼ばれます）\n\n` +
          `OK: そのまま続行 / キャンセル: 中止して英訳ボタンを押す`,
      );
      if (!skip) return;
    }
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
            videoPrompt:
              sceneState[spec.index]?.videoPromptEn ?? spec.videoPrompt,
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

      <details
        open={editorOpen}
        onToggle={(e) => setEditorOpen((e.target as HTMLDetailsElement).open)}
        style={{
          marginBottom: 24,
          background: "var(--card)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          padding: "12px 16px",
        }}
      >
        <summary style={{ cursor: "pointer", fontWeight: 700, fontSize: 14 }}>
          📝 台本を編集して再生成
          {narrationDirty && (
            <span style={{ marginLeft: 8, color: "#dc2626", fontSize: 12 }}>
              (未保存の変更あり)
            </span>
          )}
        </summary>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "120px 1fr",
            gap: 8,
            marginTop: 12,
            fontSize: 13,
          }}
        >
          <label style={editLabel}>topic</label>
          <input
            value={editTopic}
            onChange={(e) => setEditTopic(e.target.value)}
            style={editInput}
          />
          <label style={editLabel}>era</label>
          <input
            value={editEra}
            onChange={(e) => setEditEra(e.target.value)}
            style={editInput}
            placeholder="幕末 / 江戸 / 戦国 など"
          />
          <label style={editLabel}>hook</label>
          <input
            value={editHook}
            onChange={(e) => setEditHook(e.target.value)}
            style={editInput}
          />
          <label style={editLabel}>narration</label>
          <textarea
            value={editNarration}
            onChange={(e) => setEditNarration(e.target.value)}
            style={{ ...editInput, minHeight: 160, fontFamily: "inherit", resize: "vertical" }}
          />
          <label style={editLabel}>scene 数</label>
          <input
            type="number"
            min={2}
            max={12}
            value={editSceneCount}
            onChange={(e) => setEditSceneCount(Number(e.target.value))}
            style={{ ...editInput, width: 80 }}
          />
          <label style={editLabel}>keyTerms<br/><span style={editLabelSub}>1行1語</span></label>
          <textarea
            value={editKeyTerms}
            onChange={(e) => setEditKeyTerms(e.target.value)}
            style={{ ...editInput, minHeight: 80, fontFamily: "inherit", resize: "vertical" }}
          />
          <label style={editLabel}>readings<br/><span style={editLabelSub}>用語=読み (1行)</span></label>
          <textarea
            value={editReadings}
            onChange={(e) => setEditReadings(e.target.value)}
            style={{ ...editInput, minHeight: 80, fontFamily: "inherit", resize: "vertical" }}
            placeholder={"大政奉還=たいせいほうかん\n徳川慶喜=とくがわよしのぶ"}
          />
        </div>
        <div style={{ marginTop: 16, display: "flex", justifyContent: "flex-end", gap: 12 }}>
          <button
            onClick={handleSaveAndRegenerate}
            disabled={!narrationDirty || regenerating}
            style={{
              background: narrationDirty && !regenerating ? "#dc2626" : "var(--border)",
              color: "#fff",
              border: 0,
              padding: "10px 20px",
              borderRadius: 6,
              cursor: narrationDirty && !regenerating ? "pointer" : "not-allowed",
              fontSize: 13,
              fontWeight: 700,
            }}
          >
            {regenerating ? "再生成中... (数分かかります)" : "💾 保存して scene-plan / 画像 / TTS を再生成"}
          </button>
        </div>
        {regenResult && !regenResult.ok && (
          <div
            style={{
              marginTop: 12,
              background: "#fef2f2",
              border: "1px solid #fecaca",
              padding: 10,
              borderRadius: 6,
              fontSize: 12,
              color: "#991b1b",
            }}
          >
            ✗ {regenResult.error}
            {regenResult.stdoutTail && (
              <details style={{ marginTop: 6 }}>
                <summary style={{ cursor: "pointer" }}>stdout tail</summary>
                <pre style={{ whiteSpace: "pre-wrap", fontSize: 11, maxHeight: 240, overflow: "auto" }}>
                  {regenResult.stdoutTail}
                </pre>
              </details>
            )}
          </div>
        )}
      </details>

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
              <th style={{ ...th, width: 360 }}>video prompt（日本語で編集）</th>
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
                      value={state.videoPromptJa}
                      onChange={(e) =>
                        updateScene(spec.index, {
                          videoPromptJa: e.target.value,
                          videoPromptDirty: true,
                          // 未翻訳の Ja で承認されないよう、編集時に approved を外す
                          approved: false,
                        })
                      }
                      placeholder="動作描写を日本語で入力（例: 飛脚が裸足で街道を駆け、旗指物が風にはためく…）"
                      style={{
                        width: "100%",
                        minHeight: 90,
                        padding: 8,
                        fontSize: 12,
                        fontFamily: "inherit",
                        border: state.videoPromptDirty
                          ? "1px solid #dc2626"
                          : "1px solid var(--border)",
                        borderRadius: 4,
                        resize: "vertical",
                        boxSizing: "border-box",
                      }}
                    />
                    <div
                      style={{
                        marginTop: 8,
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                      }}
                    >
                      <button
                        onClick={() => handleTranslate(spec.index)}
                        disabled={
                          translatingScene !== null ||
                          !state.videoPromptJa.trim()
                        }
                        style={translateButton({
                          isDirty: state.videoPromptDirty,
                          isTranslating: translatingScene === spec.index,
                          isDisabled:
                            translatingScene !== null ||
                            !state.videoPromptJa.trim(),
                          othersBusy:
                            translatingScene !== null &&
                            translatingScene !== spec.index,
                        })}
                      >
                        {translatingScene === spec.index
                          ? "🌐 英訳中..."
                          : "🌐 英訳して反映"}
                      </button>
                      {state.videoPromptDirty && (
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 700,
                            color: "#dc2626",
                            whiteSpace: "nowrap",
                          }}
                        >
                          ⚠ 未翻訳
                        </span>
                      )}
                    </div>
                    {translateError?.index === spec.index && (
                      <div
                        style={{
                          marginTop: 4,
                          fontSize: 10,
                          color: "#991b1b",
                        }}
                      >
                        {translateError.message}
                      </div>
                    )}
                    <details style={{ marginTop: 8 }}>
                      <summary
                        style={{
                          cursor: "pointer",
                          fontSize: 11,
                          color: "var(--muted)",
                        }}
                      >
                        ▼ Seedance 送信用（英語）
                      </summary>
                      <pre
                        style={{
                          marginTop: 6,
                          padding: 6,
                          background: "#f9fafb",
                          border: "1px solid var(--border)",
                          borderRadius: 4,
                          fontSize: 11,
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-word",
                          color: state.videoPromptDirty
                            ? "var(--muted)"
                            : "inherit",
                        }}
                      >
                        {state.videoPromptEn || "(まだ英訳されていません)"}
                      </pre>
                    </details>
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
          {dirtyCount > 0 && (
            <span style={{ marginLeft: 8, color: "#dc2626", fontSize: 12 }}>
              ⚠ 未翻訳 {dirtyCount} 件
            </span>
          )}
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

const editLabel: React.CSSProperties = {
  fontSize: 12,
  color: "var(--muted)",
  fontWeight: 600,
  paddingTop: 6,
};

const editLabelSub: React.CSSProperties = {
  fontWeight: 400,
  fontSize: 10,
};

const editInput: React.CSSProperties = {
  padding: 8,
  fontSize: 13,
  border: "1px solid var(--border)",
  borderRadius: 4,
  width: "100%",
  fontFamily: "inherit",
};

function translateButton(args: {
  isDirty: boolean;
  isTranslating: boolean;
  isDisabled: boolean;
  othersBusy: boolean;
}): React.CSSProperties {
  // Dirty（未翻訳の編集あり）→ アクセントカラーで強い CTA
  // Clean（最新の英訳あり）→ ややくすんだ「再翻訳」風
  // Translating → グレーで進行中表示
  const base: React.CSSProperties = {
    padding: "9px 16px",
    borderRadius: 6,
    fontSize: 12,
    fontWeight: 700,
    border: 0,
    cursor: args.isDisabled ? "not-allowed" : "pointer",
    boxShadow: args.isDisabled ? "none" : "0 1px 2px rgba(0,0,0,0.08)",
    transition: "background 0.15s, box-shadow 0.15s",
    whiteSpace: "nowrap",
    opacity: args.othersBusy ? 0.5 : 1,
  };
  if (args.isTranslating) {
    return { ...base, background: "#e5e7eb", color: "#6b7280" };
  }
  if (args.isDisabled) {
    return { ...base, background: "#e5e7eb", color: "#9ca3af" };
  }
  if (args.isDirty) {
    return {
      ...base,
      background: "var(--accent)",
      color: "#fff",
      boxShadow: "0 2px 6px rgba(99,102,241,0.35)",
    };
  }
  // Clean: 既に翻訳済み、再翻訳もできる軽いボタン
  return {
    ...base,
    background: "#eef2ff",
    color: "var(--accent)",
  };
}
