"use client";

import { useEffect, useRef, useState } from "react";
import type {
  CanvaSceneSource,
  ImageCandidate,
  ManabilabCanvaJob,
  ManabilabCanvaScene,
} from "@rekishi/shared";

interface Props {
  job: ManabilabCanvaJob;
  scenes: ManabilabCanvaScene[] | null;
  onJobChange: (job: ManabilabCanvaJob) => void;
  onScenesChange: (scenes: ManabilabCanvaScene[]) => void;
  onAdvance: () => void;
}

interface GenVariantsResult {
  ok: boolean;
  sceneIndex?: number;
  candidates?: ImageCandidate[];
  errors?: { variantIndex: number; error: string }[];
  error?: string;
}

interface SelectCandidateResult {
  ok: boolean;
  sceneIndex?: number;
  selectedCandidateIndex?: number;
  scene?: ManabilabCanvaScene;
  job?: ManabilabCanvaJob | null;
  error?: string;
}

interface RegenBaseResult {
  ok: boolean;
  outputPath?: string;
  referenceUsed?: boolean;
  regeneratedAt?: string;
  error?: string;
}

interface GenAnimationResult {
  ok: boolean;
  sceneIndex?: number;
  videoPath?: string;
  videoUrl?: string;
  generatedAt?: string;
  seedancePromptEn?: string;
  seedancePromptJa?: string;
  error?: string;
}

const CHARACTER_REF_URL = "/manabilab-canva/assets/character/manabikun-base.png";
const CANVA_PUBLIC_PREFIX = "/manabilab-canva";
const VARIANT_COUNT = 3;

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

function sceneNeedsGeneration(s: ManabilabCanvaScene): boolean {
  const cands = s.imageCandidates ?? [];
  if (cands.length === 0) return true;
  // 1 案でも画像が落ちていたら、ユーザーは個別に再生成できる。一括の自動再開はしない
  return false;
}

export function ImagesStep({
  job,
  scenes: initialScenes,
  onJobChange,
  onScenesChange,
  onAdvance,
}: Props) {
  const [scenes, setScenes] = useState<ManabilabCanvaScene[] | null>(initialScenes);

  // 進捗管理
  const [generatingIndex, setGeneratingIndex] = useState<number | null>(null);
  const [batchProgress, setBatchProgress] = useState<{
    completed: number;
    total: number;
  } | null>(null);
  const autoStartedRef = useRef(false);

  // バージョン bust（生成直後に img を再読み込みさせる）
  const [imageVersion, setImageVersion] = useState<Record<string, number>>({});
  const [videoVersion, setVideoVersion] = useState<Record<number, number>>({});

  // ベース画像
  const [regeneratingBase, setRegeneratingBase] = useState(false);
  const [baseVersion, setBaseVersion] = useState<number>(0);
  const [baseError, setBaseError] = useState<string | null>(null);

  // アニメ
  const [genAnimationIdx, setGenAnimationIdx] = useState<number | null>(null);

  // 選択中
  const [selectingIdx, setSelectingIdx] = useState<{
    scene: number;
    variant: number;
  } | null>(null);

  // エラー
  const [error, setError] = useState<{ index: number; message: string } | null>(null);
  const [globalError, setGlobalError] = useState<string | null>(null);

  const scenesDone = job.steps.scenes.status === "done";

  // 初回マウント時、未生成シーンがあれば自動で 3 案生成を開始
  useEffect(() => {
    if (autoStartedRef.current) return;
    if (!scenes || scenes.length === 0) return;
    if (!scenesDone) return;
    const pending = scenes.filter(sceneNeedsGeneration);
    if (pending.length === 0) return;
    autoStartedRef.current = true;
    void runBulkGenerate(pending.map((s) => s.index));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenes, scenesDone]);

  async function generateForScene(
    sceneIndex: number,
    userDirectionJa: string,
  ): Promise<{ ok: boolean; error?: string }> {
    setGeneratingIndex(sceneIndex);
    setError(null);
    try {
      const res = await fetch(
        `/api/manabilab-canva/${job.id}/scenes/${sceneIndex}/generate-variants`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userDirectionJa }),
        },
      );
      const data = (await res.json()) as GenVariantsResult;
      if (!data.candidates) {
        const msg = data.error ?? "3 案生成に失敗しました";
        setError({ index: sceneIndex, message: msg });
        return { ok: false, error: msg };
      }
      const candidates = data.candidates;
      const next =
        scenes?.map((s) =>
          s.index === sceneIndex
            ? {
                ...s,
                imagePromptJa: userDirectionJa,
                imageCandidates: candidates,
                selectedCandidateIndex: undefined,
                imagePath: undefined,
                imagePromptEn: "",
                imageGeneratedAt: undefined,
              }
            : s,
        ) ?? null;
      if (next) {
        setScenes(next);
        onScenesChange(next);
      }
      const v = Date.now();
      setImageVersion((prev) => {
        const updated = { ...prev };
        for (const c of candidates) {
          updated[`${sceneIndex}-${c.variantIndex}`] = v;
        }
        return updated;
      });

      // 部分的失敗の通知
      if (data.errors && data.errors.length > 0) {
        setError({
          index: sceneIndex,
          message: `一部失敗: ${data.errors
            .map((e) => `v${e.variantIndex}: ${e.error}`)
            .join(" / ")}`,
        });
      }
      return { ok: data.ok };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError({ index: sceneIndex, message: msg });
      return { ok: false, error: msg };
    } finally {
      setGeneratingIndex(null);
    }
  }

  async function runBulkGenerate(indices: number[]): Promise<void> {
    if (indices.length === 0) return;
    setBatchProgress({ completed: 0, total: indices.length });
    setGlobalError(null);

    // images ステップを in-progress に
    if (job.steps.images.status === "pending") {
      const now = new Date().toISOString();
      onJobChange({
        ...job,
        steps: {
          ...job.steps,
          images: { ...job.steps.images, status: "in-progress", updatedAt: now },
        },
      });
    }

    let completed = 0;
    for (const sceneIndex of indices) {
      const target = scenes?.find((s) => s.index === sceneIndex);
      const userDirection = (target?.imagePromptJa ?? "").trim();
      const result = await generateForScene(sceneIndex, userDirection);
      completed += 1;
      setBatchProgress({ completed, total: indices.length });
      if (!result.ok) {
        // 続行はするがグローバルエラーに残す
        setGlobalError(
          (prev) =>
            (prev ?? "") +
            (prev ? " / " : "") +
            `#${sceneIndex}: ${result.error ?? "失敗"}`,
        );
      }
    }
    setBatchProgress(null);
  }

  const handleRegenerateScene = async (
    sceneIndex: number,
    userDirectionJa: string,
  ) => {
    if (generatingIndex !== null || batchProgress) return;
    await generateForScene(sceneIndex, userDirectionJa);
  };

  const handleRegenerateAll = async () => {
    if (!scenes || scenes.length === 0) return;
    if (
      !confirm(
        `全 ${scenes.length} シーン × 3 案を再生成します。数分かかります。続行しますか？`,
      )
    ) {
      return;
    }
    autoStartedRef.current = true;
    await runBulkGenerate(scenes.map((s) => s.index));
  };

  const handleSelectCandidate = async (
    sceneIndex: number,
    variantIndex: number,
  ) => {
    setSelectingIdx({ scene: sceneIndex, variant: variantIndex });
    setError(null);
    try {
      const res = await fetch(
        `/api/manabilab-canva/${job.id}/scenes/${sceneIndex}/select-candidate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ variantIndex }),
        },
      );
      const data = (await res.json()) as SelectCandidateResult;
      if (!data.ok || !data.scene) {
        setError({
          index: sceneIndex,
          message: data.error ?? "選択に失敗しました",
        });
        return;
      }
      const next =
        scenes?.map((s) => (s.index === sceneIndex ? data.scene! : s)) ?? null;
      if (next) {
        setScenes(next);
        onScenesChange(next);
      }
      if (data.job) onJobChange(data.job);
    } catch (err) {
      setError({
        index: sceneIndex,
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSelectingIdx(null);
    }
  };

  const handleRegenerateBase = async () => {
    if (
      !confirm(
        "キャラ基準画像を再生成します。以降の全シーン画像はこの新しいベースから生成されます。続行しますか？",
      )
    ) {
      return;
    }
    setRegeneratingBase(true);
    setBaseError(null);
    try {
      const res = await fetch(
        `/api/manabilab-canva/character/regenerate-base`,
        { method: "POST" },
      );
      const data = (await res.json()) as RegenBaseResult;
      if (!data.ok) {
        setBaseError(data.error ?? "ベース画像の再生成に失敗しました");
        return;
      }
      setBaseVersion(Date.now());
    } catch (err) {
      setBaseError(err instanceof Error ? err.message : String(err));
    } finally {
      setRegeneratingBase(false);
    }
  };

  const updatePromptJa = (sceneIndex: number, value: string) => {
    if (!scenes) return;
    const next = scenes.map((s) =>
      s.index === sceneIndex ? { ...s, imagePromptJa: value } : s,
    );
    setScenes(next);
    onScenesChange(next);
  };

  const updateSeedancePromptJa = (sceneIndex: number, value: string) => {
    if (!scenes) return;
    const next = scenes.map((s) =>
      s.index === sceneIndex ? { ...s, seedancePromptJa: value } : s,
    );
    setScenes(next);
    onScenesChange(next);
  };

  const updateSeedancePromptEn = (sceneIndex: number, value: string) => {
    if (!scenes) return;
    const next = scenes.map((s) =>
      s.index === sceneIndex ? { ...s, seedancePromptEn: value } : s,
    );
    setScenes(next);
    onScenesChange(next);
  };

  const handleGenerateAnimation = async (sceneIndex: number) => {
    if (!scenes) return;
    const target = scenes.find((s) => s.index === sceneIndex);
    if (!target) return;
    if (!target.imagePath) {
      setError({
        index: sceneIndex,
        message: "先に静止画の候補を 1 つ「決定」してからアニメ化してください",
      });
      return;
    }

    setGenAnimationIdx(sceneIndex);
    setError(null);
    try {
      const res = await fetch(
        `/api/manabilab-canva/${job.id}/scenes/${sceneIndex}/generate-animation`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userDirectionJa: (target.seedancePromptJa ?? "").trim() || "",
            regeneratePrompt: true,
          }),
        },
      );
      const data = (await res.json()) as GenAnimationResult;
      if (!data.ok || !data.videoPath) {
        setError({
          index: sceneIndex,
          message: data.error ?? "アニメ生成に失敗しました",
        });
        return;
      }
      const next = scenes.map((s) =>
        s.index === sceneIndex
          ? {
              ...s,
              videoPath: data.videoPath!,
              videoGeneratedAt: data.generatedAt,
              seedancePromptEn: data.seedancePromptEn ?? s.seedancePromptEn,
              seedancePromptJa: data.seedancePromptJa ?? s.seedancePromptJa,
            }
          : s,
      );
      setScenes(next);
      onScenesChange(next);
      setVideoVersion((prev) => ({ ...prev, [sceneIndex]: Date.now() }));
    } catch (err) {
      setError({
        index: sceneIndex,
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setGenAnimationIdx(null);
    }
  };

  const allSelected =
    !!scenes && scenes.length > 0 && scenes.every((s) => !!s.imagePath);

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <header>
        <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>⑤ Images</h2>
        <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>
          各シーンに対して <strong>3 つの構図候補</strong>を独立に生成します。
          1 案だけを「✓ これに決定」で確定すると、後段の TTS / アニメ /
          レンダリングがその 1 枚を使います。
        </p>
      </header>

      {!scenesDone ? (
        <p style={{ color: "#d32f2f", fontSize: 13 }}>
          先に Scenes ステップを完了してください。
        </p>
      ) : null}

      <section
        style={{
          display: "flex",
          gap: 12,
          alignItems: "flex-start",
          border: "1px dashed var(--border)",
          borderRadius: 8,
          padding: 10,
        }}
      >
        <img
          src={`${CHARACTER_REF_URL}${baseVersion ? `?t=${baseVersion}` : ""}`}
          alt="マナビくん基準画像"
          style={{
            width: 96,
            height: 96,
            objectFit: "contain",
            background: "white",
            borderRadius: 4,
            border: "1px solid var(--border)",
          }}
        />
        <div style={{ fontSize: 12, color: "var(--muted)", flex: 1, display: "grid", gap: 6 }}>
          <div>
            <strong style={{ color: "inherit" }}>参照キャラ画像</strong>:{" "}
            <code>assets/character/manabikun-base.png</code>
            <br />
            全シーンの画像生成でこの 1 枚を referenceImages として使います。
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={handleRegenerateBase}
              disabled={regeneratingBase}
              style={{
                padding: "6px 12px",
                background: "transparent",
                color: "var(--accent)",
                border: "1px solid var(--accent)",
                borderRadius: 4,
                fontSize: 12,
                fontWeight: 600,
                cursor: regeneratingBase ? "not-allowed" : "pointer",
                opacity: regeneratingBase ? 0.6 : 1,
              }}
            >
              {regeneratingBase ? "再生成中..." : "⟲ ベース画像を再生成"}
            </button>
            {baseError ? (
              <span style={{ color: "#d32f2f", fontSize: 11 }}>{baseError}</span>
            ) : null}
          </div>
        </div>
      </section>

      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={handleRegenerateAll}
          disabled={
            !!batchProgress || generatingIndex !== null || !scenes || scenes.length === 0
          }
          style={{
            padding: "8px 16px",
            background: "transparent",
            color: "var(--accent)",
            border: "1px solid var(--accent)",
            borderRadius: 6,
            fontWeight: 600,
            cursor: batchProgress ? "not-allowed" : "pointer",
            opacity: batchProgress ? 0.6 : 1,
          }}
        >
          全シーン × 3 案を再生成
        </button>

        {batchProgress ? (
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <div
              aria-hidden
              style={{
                width: 14,
                height: 14,
                border: "2px solid var(--accent)",
                borderTopColor: "transparent",
                borderRadius: "50%",
                animation: "imagesstep-spin 0.8s linear infinite",
              }}
            />
            <span style={{ fontSize: 13, fontWeight: 600 }}>
              生成中: シーン {batchProgress.completed} / {batchProgress.total}{" "}
              完了
              {generatingIndex !== null ? `（#${generatingIndex} 進行中）` : ""}
            </span>
          </div>
        ) : null}

        {!batchProgress && allSelected ? (
          <span style={{ fontSize: 12, color: "#2e7d32", fontWeight: 600 }}>
            ✓ 全シーンで候補が選択されています
          </span>
        ) : null}
      </div>

      <style jsx>{`
        @keyframes imagesstep-spin {
          to {
            transform: rotate(360deg);
          }
        }
      `}</style>

      {globalError ? (
        <p style={{ color: "#d32f2f", fontSize: 13, margin: 0 }}>{globalError}</p>
      ) : null}

      {scenes && scenes.length > 0 ? (
        <div style={{ display: "grid", gap: 12 }}>
          {scenes.map((s) => {
            const errForThis = error?.index === s.index ? error.message : null;
            const isThisGenerating = generatingIndex === s.index;
            const candidates = s.imageCandidates ?? [];
            const selectedIdx = s.selectedCandidateIndex;
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
                  {selectedIdx !== undefined ? (
                    <span style={{ fontSize: 11, color: "#2e7d32", fontWeight: 600 }}>
                      ✓ v{selectedIdx} 採用中
                    </span>
                  ) : candidates.length > 0 ? (
                    <span style={{ fontSize: 11, color: "#f57c00", fontWeight: 600 }}>
                      未選択
                    </span>
                  ) : null}
                  {isThisGenerating ? (
                    <span style={{ fontSize: 11, color: "var(--accent)", fontWeight: 600 }}>
                      生成中...
                    </span>
                  ) : null}
                </div>

                <div style={{ fontSize: 12, color: "var(--muted)" }}>
                  <strong style={{ color: "inherit" }}>caption:</strong>{" "}
                  {s.caption}
                  <br />
                  <strong style={{ color: "inherit" }}>narration:</strong>{" "}
                  {s.narration.length > 80
                    ? s.narration.slice(0, 80) + "…"
                    : s.narration}
                </div>

                {/* 3 候補のサムネ横並び */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: `repeat(${VARIANT_COUNT}, 1fr)`,
                    gap: 10,
                  }}
                >
                  {Array.from({ length: VARIANT_COUNT }, (_, vi) => {
                    const c = candidates.find((x) => x.variantIndex === vi);
                    const v = imageVersion[`${s.index}-${vi}`];
                    const imageSrc = c?.imagePath
                      ? `${CANVA_PUBLIC_PREFIX}/${c.imagePath}${v ? `?t=${v}` : ""}`
                      : null;
                    const isSelected = selectedIdx === vi;
                    const isSelecting =
                      selectingIdx?.scene === s.index &&
                      selectingIdx.variant === vi;
                    return (
                      <div
                        key={vi}
                        style={{
                          display: "grid",
                          gap: 6,
                          padding: 8,
                          border: isSelected
                            ? "2px solid #2e7d32"
                            : "1px solid var(--border)",
                          borderRadius: 6,
                          background: isSelected
                            ? "rgba(46, 125, 50, 0.06)"
                            : "transparent",
                        }}
                      >
                        <div
                          style={{
                            fontSize: 10,
                            color: "var(--muted)",
                            fontWeight: 600,
                            textTransform: "uppercase",
                          }}
                        >
                          v{vi}
                          {c?.poseSummaryJa ? ` · ${c.poseSummaryJa}` : ""}
                        </div>
                        <div
                          style={{
                            width: "100%",
                            aspectRatio: "9 / 16",
                            background: "#fafafa",
                            border: "1px solid var(--border)",
                            borderRadius: 4,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            overflow: "hidden",
                          }}
                        >
                          {isThisGenerating && !imageSrc ? (
                            <div
                              aria-hidden
                              style={{
                                width: 18,
                                height: 18,
                                border: "2px solid var(--accent)",
                                borderTopColor: "transparent",
                                borderRadius: "50%",
                                animation:
                                  "imagesstep-spin 0.8s linear infinite",
                              }}
                            />
                          ) : imageSrc ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={imageSrc}
                              alt={`scene ${s.index} v${vi}`}
                              style={{
                                width: "100%",
                                height: "100%",
                                objectFit: "contain",
                              }}
                            />
                          ) : c && !c.imagePath ? (
                            <span
                              style={{
                                fontSize: 10,
                                color: "#d32f2f",
                                padding: 4,
                                textAlign: "center",
                              }}
                            >
                              画像生成失敗
                            </span>
                          ) : (
                            <span style={{ fontSize: 11, color: "var(--muted)" }}>
                              未生成
                            </span>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => handleSelectCandidate(s.index, vi)}
                          disabled={
                            !imageSrc ||
                            isSelecting ||
                            isThisGenerating ||
                            !!batchProgress
                          }
                          style={{
                            padding: "4px 8px",
                            fontSize: 11,
                            fontWeight: 600,
                            border: isSelected
                              ? "1px solid #2e7d32"
                              : "1px solid var(--accent)",
                            background: isSelected ? "#2e7d32" : "transparent",
                            color: isSelected ? "white" : "var(--accent)",
                            borderRadius: 4,
                            cursor:
                              !imageSrc || isSelecting || isThisGenerating
                                ? "not-allowed"
                                : "pointer",
                            opacity: !imageSrc ? 0.4 : isSelecting ? 0.6 : 1,
                          }}
                        >
                          {isSelected
                            ? "✓ 採用中"
                            : isSelecting
                            ? "決定中..."
                            : "✓ これに決定"}
                        </button>
                      </div>
                    );
                  })}
                </div>

                <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
                  <span style={{ fontWeight: 600 }}>
                    ポーズの指示{" "}
                    <span
                      style={{
                        fontWeight: 400,
                        color: "var(--muted)",
                        fontSize: 11,
                        marginLeft: 4,
                      }}
                    >
                      日本語・任意 / 3 案すべての種として渡される
                    </span>
                  </span>
                  <textarea
                    value={s.imagePromptJa ?? ""}
                    onChange={(e) => updatePromptJa(s.index, e.target.value)}
                    rows={2}
                    placeholder="空でも OK。空なら caption / narration から AI がポーズを推測します。"
                    disabled={isThisGenerating || !!batchProgress}
                    style={{
                      padding: "8px 10px",
                      border: "1px solid var(--border)",
                      borderRadius: 6,
                      fontSize: 13,
                      background: "var(--card)",
                      color: "inherit",
                      lineHeight: 1.5,
                      resize: "vertical",
                    }}
                  />
                </label>

                {errForThis ? (
                  <p style={{ color: "#d32f2f", fontSize: 12, margin: 0 }}>
                    {errForThis}
                  </p>
                ) : null}

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    onClick={() =>
                      handleRegenerateScene(s.index, (s.imagePromptJa ?? "").trim())
                    }
                    disabled={
                      isThisGenerating ||
                      !!batchProgress ||
                      generatingIndex !== null
                    }
                    style={smallPrimary(isThisGenerating)}
                  >
                    {isThisGenerating
                      ? "3 案生成中..."
                      : candidates.length > 0
                      ? "3 案を再生成"
                      : "3 案を生成"}
                  </button>
                </div>

                <details
                  open={!!s.imagePath && !s.videoPath ? false : !!s.videoPath}
                  style={{
                    borderTop: "1px dashed var(--border)",
                    paddingTop: 8,
                    marginTop: 4,
                  }}
                >
                  <summary
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: "pointer",
                      color: s.videoPath ? "#2e7d32" : "var(--accent)",
                    }}
                  >
                    🎬 アニメーション {s.videoPath ? "（生成済み）" : "（任意）"}
                  </summary>
                  <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                    {s.videoPath ? (
                      <div style={{ display: "grid", gap: 4 }}>
                        <video
                          key={`${s.index}-${videoVersion[s.index] ?? 0}`}
                          src={`${CANVA_PUBLIC_PREFIX}/${s.videoPath}${
                            videoVersion[s.index]
                              ? `?t=${videoVersion[s.index]}`
                              : ""
                          }`}
                          controls
                          loop
                          muted
                          playsInline
                          style={{
                            width: "100%",
                            maxWidth: 320,
                            aspectRatio: "9 / 16",
                            background: "#000",
                            borderRadius: 4,
                          }}
                        />
                        <div
                          style={{
                            display: "flex",
                            gap: 8,
                            fontSize: 11,
                            color: "var(--muted)",
                          }}
                        >
                          {s.videoGeneratedAt ? (
                            <span>
                              生成{" "}
                              {new Date(s.videoGeneratedAt).toLocaleString(
                                "ja-JP",
                              )}
                            </span>
                          ) : null}
                          <a
                            href={`${CANVA_PUBLIC_PREFIX}/${s.videoPath}`}
                            download={`scene-${String(s.index).padStart(
                              2,
                              "0",
                            )}.mp4`}
                            style={{
                              color: "var(--accent)",
                              textDecoration: "none",
                            }}
                          >
                            ⬇ MP4 をダウンロード
                          </a>
                        </div>
                      </div>
                    ) : (
                      <div
                        style={{
                          fontSize: 11,
                          color: "var(--muted)",
                          padding: "8px 0",
                        }}
                      >
                        {s.imagePath
                          ? "未生成（指示を書いて「アニメを生成」を押してください）"
                          : "先に 3 案から 1 つ「決定」してください"}
                      </div>
                    )}

                    <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
                      <span style={{ fontWeight: 600 }}>
                        アニメ指示{" "}
                        <span
                          style={{
                            fontWeight: 400,
                            color: "var(--muted)",
                            fontSize: 11,
                            marginLeft: 4,
                          }}
                        >
                          日本語・任意 / 例: 「血流が巡る」「マナビくんがチョコをかじる」
                        </span>
                      </span>
                      <textarea
                        value={s.seedancePromptJa ?? ""}
                        onChange={(e) =>
                          updateSeedancePromptJa(s.index, e.target.value)
                        }
                        rows={2}
                        placeholder="空でも OK。空なら caption / narration から AI が控えめなアニメを推測します。"
                        disabled={genAnimationIdx === s.index || !s.imagePath}
                        style={{
                          padding: "8px 10px",
                          border: "1px solid var(--border)",
                          borderRadius: 6,
                          fontSize: 13,
                          background: "var(--card)",
                          color: "inherit",
                          lineHeight: 1.5,
                          resize: "vertical",
                        }}
                      />
                    </label>

                    <button
                      type="button"
                      onClick={() => handleGenerateAnimation(s.index)}
                      disabled={!s.imagePath || genAnimationIdx === s.index}
                      style={smallPrimary(genAnimationIdx === s.index)}
                    >
                      {genAnimationIdx === s.index
                        ? "アニメ生成中... (30〜90秒)"
                        : s.videoPath
                        ? "アニメを再生成"
                        : "アニメを生成"}
                    </button>

                    <details>
                      <summary
                        style={{
                          fontSize: 11,
                          color: "var(--muted)",
                          cursor: "pointer",
                        }}
                      >
                        ▼ アニメ詳細（Seedance に渡る英語プロンプト）
                      </summary>
                      <div style={{ marginTop: 6 }}>
                        <textarea
                          value={s.seedancePromptEn ?? ""}
                          onChange={(e) =>
                            updateSeedancePromptEn(s.index, e.target.value)
                          }
                          rows={4}
                          placeholder="まだ生成されていません。"
                          disabled={genAnimationIdx === s.index}
                          style={{
                            width: "100%",
                            padding: "6px 8px",
                            border: "1px solid var(--border)",
                            borderRadius: 4,
                            fontSize: 11,
                            background: "var(--card)",
                            color: "inherit",
                            fontFamily:
                              "ui-monospace, SFMono-Regular, monospace",
                            lineHeight: 1.5,
                            resize: "vertical",
                            boxSizing: "border-box",
                          }}
                        />
                      </div>
                    </details>
                  </div>
                </details>
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
          style={{
            padding: "10px 20px",
            background: "var(--accent)",
            color: "white",
            border: "none",
            borderRadius: 6,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          次へ →
        </button>
      </div>
    </div>
  );
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
