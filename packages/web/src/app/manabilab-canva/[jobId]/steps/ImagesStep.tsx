"use client";

import { useState } from "react";
import type {
  CanvaSceneSource,
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

interface RegenPromptResult {
  ok: boolean;
  sceneIndex?: number;
  imagePromptEn?: string;
  poseSummaryJa?: string;
  error?: string;
}

interface GenImageResult {
  ok: boolean;
  sceneIndex?: number;
  imagePath?: string;
  imageUrl?: string;
  generatedAt?: string;
  imagePromptEn?: string;
  imagePromptJa?: string;
  promptRegenerated?: boolean;
  error?: string;
}

interface RegenBaseResult {
  ok: boolean;
  outputPath?: string;
  referenceUsed?: boolean;
  regeneratedAt?: string;
  error?: string;
}

interface GenerateAllResult {
  ok: boolean;
  job?: ManabilabCanvaJob;
  scenes?: ManabilabCanvaScene[];
  results?: Array<{
    index: number;
    status: "done" | "skipped" | "error";
    imagePath?: string;
    error?: string;
  }>;
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

export function ImagesStep({
  job,
  scenes: initialScenes,
  onJobChange,
  onScenesChange,
  onAdvance,
}: Props) {
  const [scenes, setScenes] = useState<ManabilabCanvaScene[] | null>(initialScenes);
  // index → cache-bust suffix（生成直後に img の URL を強制リロードするため）
  const [imageVersion, setImageVersion] = useState<Record<number, number>>({});
  const [regenPromptIdx, setRegenPromptIdx] = useState<number | null>(null);
  const [genImageIdx, setGenImageIdx] = useState<number | null>(null);
  const [genAnimationIdx, setGenAnimationIdx] = useState<number | null>(null);
  const [videoVersion, setVideoVersion] = useState<Record<number, number>>({});
  const [generatingAll, setGeneratingAll] = useState(false);
  const [batchSummary, setBatchSummary] = useState<string | null>(null);
  const [regeneratingBase, setRegeneratingBase] = useState(false);
  const [baseVersion, setBaseVersion] = useState<number>(0);
  const [baseError, setBaseError] = useState<string | null>(null);
  const [error, setError] = useState<{ index: number; message: string } | null>(null);
  const [globalError, setGlobalError] = useState<string | null>(null);

  const scenesDone = job.steps.scenes.status === "done";

  const handleRegeneratePrompt = async (sceneIndex: number) => {
    if (!scenes) return;
    const target = scenes.find((s) => s.index === sceneIndex);
    if (!target) return;
    setRegenPromptIdx(sceneIndex);
    setError(null);
    try {
      const res = await fetch(
        `/api/manabilab-canva/${job.id}/scenes/${sceneIndex}/regenerate-image-prompt`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userDirectionJa: (target.imagePromptJa ?? "").trim() || undefined,
          }),
        },
      );
      const data = (await res.json()) as RegenPromptResult;
      if (!data.ok || !data.imagePromptEn) {
        setError({ index: sceneIndex, message: data.error ?? "プロンプト生成に失敗しました" });
        return;
      }
      const next = scenes.map((s) =>
        s.index === sceneIndex ? { ...s, imagePromptEn: data.imagePromptEn! } : s,
      );
      setScenes(next);
      onScenesChange(next);
    } catch (err) {
      setError({
        index: sceneIndex,
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setRegenPromptIdx(null);
    }
  };

  const handleGenerateImage = async (sceneIndex: number) => {
    if (!scenes) return;
    const target = scenes.find((s) => s.index === sceneIndex);
    if (!target) return;

    setGenImageIdx(sceneIndex);
    setError(null);
    try {
      const res = await fetch(
        `/api/manabilab-canva/${job.id}/scenes/${sceneIndex}/generate-image`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userDirectionJa: (target.imagePromptJa ?? "").trim() || "",
            // 統合 API: ユーザー指示があれば必ず英語プロンプトを再生成する
            regeneratePrompt: true,
          }),
        },
      );
      const data = (await res.json()) as GenImageResult;
      if (!data.ok || !data.imagePath) {
        setError({ index: sceneIndex, message: data.error ?? "画像生成に失敗しました" });
        return;
      }
      const next = scenes.map((s) =>
        s.index === sceneIndex
          ? {
              ...s,
              imagePath: data.imagePath!,
              imageGeneratedAt: data.generatedAt,
              imagePromptEn: data.imagePromptEn ?? s.imagePromptEn,
              imagePromptJa: data.imagePromptJa ?? s.imagePromptJa,
            }
          : s,
      );
      setScenes(next);
      onScenesChange(next);
      setImageVersion((prev) => ({ ...prev, [sceneIndex]: Date.now() }));

      // images ステップを done にする（最低1枚生成されたら）
      const allHaveImage = next.every((s) => !!s.imagePath);
      if (allHaveImage && job.steps.images.status !== "done") {
        const now = new Date().toISOString();
        onJobChange({
          ...job,
          steps: {
            ...job.steps,
            images: { ...job.steps.images, status: "done", updatedAt: now },
          },
        });
      } else if (job.steps.images.status === "pending") {
        const now = new Date().toISOString();
        onJobChange({
          ...job,
          steps: {
            ...job.steps,
            images: { ...job.steps.images, status: "in-progress", updatedAt: now },
          },
        });
      }
    } catch (err) {
      setError({
        index: sceneIndex,
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setGenImageIdx(null);
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

  const handleGenerateAll = async (force: boolean) => {
    if (!scenes || scenes.length === 0) return;
    if (
      !confirm(
        force
          ? "既存画像も含めて全シーンを再生成します。よろしいですか？"
          : `未生成のシーンに対して画像をまとめて生成します。${scenes.length} シーン分、数分かかります。続行しますか？`,
      )
    ) {
      return;
    }
    setGeneratingAll(true);
    setBatchSummary(null);
    setGlobalError(null);
    setError(null);
    try {
      const res = await fetch(
        `/api/manabilab-canva/${job.id}/images/generate-all`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ force, generateMissingPrompts: true }),
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
        setImageVersion(versions);
      }
      if (data.job) onJobChange(data.job);
      if (data.results) {
        const done = data.results.filter((r) => r.status === "done").length;
        const skipped = data.results.filter((r) => r.status === "skipped").length;
        const errored = data.results.filter((r) => r.status === "error");
        const parts: string[] = [`生成 ${done}`];
        if (skipped > 0) parts.push(`スキップ ${skipped}`);
        if (errored.length > 0) {
          parts.push(`失敗 ${errored.length}`);
        }
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

  const updatePromptEn = (sceneIndex: number, value: string) => {
    if (!scenes) return;
    const next = scenes.map((s) =>
      s.index === sceneIndex ? { ...s, imagePromptEn: value } : s,
    );
    setScenes(next);
    onScenesChange(next);
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
        message: "先に静止画を生成してからアニメ化してください",
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

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <header>
        <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>⑤ Images</h2>
        <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>
          各シーンに対して、参照画像（マナビくん基準）と Gemini で組み立てた英語プロンプトで
          画像を生成する。背景は純白固定。Canva 上で背景削除して使う前提。
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
            <code>reference.png</code> を構造リファレンスに、
            <code>prompts/character-base.md</code> の規範でベースを生成し直せます。
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
          disabled={generatingAll || !scenesDone || !scenes || scenes.length === 0}
          style={{
            padding: "8px 16px",
            background: "var(--accent)",
            color: "white",
            border: "none",
            borderRadius: 6,
            fontWeight: 600,
            cursor: generatingAll ? "not-allowed" : "pointer",
            opacity: generatingAll ? 0.6 : 1,
          }}
        >
          {generatingAll ? "一括生成中..." : "未生成のシーンを一括生成"}
        </button>
        <button
          type="button"
          onClick={() => handleGenerateAll(true)}
          disabled={generatingAll || !scenesDone || !scenes || scenes.length === 0}
          style={{
            padding: "8px 16px",
            background: "transparent",
            color: "var(--accent)",
            border: "1px solid var(--accent)",
            borderRadius: 6,
            fontWeight: 600,
            cursor: generatingAll ? "not-allowed" : "pointer",
            opacity: generatingAll ? 0.6 : 1,
          }}
        >
          全シーンを上書き再生成
        </button>
        {batchSummary ? (
          <span style={{ fontSize: 12, color: "var(--muted)" }}>{batchSummary}</span>
        ) : null}
      </div>

      {globalError ? (
        <p style={{ color: "#d32f2f", fontSize: 13, margin: 0 }}>{globalError}</p>
      ) : null}

      {scenes && scenes.length > 0 ? (
        <div style={{ display: "grid", gap: 12 }}>
          {scenes.map((s) => {
            const v = imageVersion[s.index];
            const imageSrc = s.imagePath
              ? `${CANVA_PUBLIC_PREFIX}/${s.imagePath}${v ? `?t=${v}` : ""}`
              : null;
            const errForThis = error?.index === s.index ? error.message : null;
            const isRegen = regenPromptIdx === s.index;
            const isGen = genImageIdx === s.index;
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
                  gridTemplateColumns: "200px 1fr",
                }}
              >
                {/* 左: サムネ */}
                <div style={{ display: "grid", gap: 8 }}>
                  <div
                    style={{
                      width: 200,
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
                    {imageSrc ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={imageSrc}
                        alt={`scene ${s.index}`}
                        style={{ width: "100%", height: "100%", objectFit: "contain" }}
                      />
                    ) : (
                      <span style={{ fontSize: 11, color: "var(--muted)" }}>未生成</span>
                    )}
                  </div>
                  {imageSrc ? (
                    <a
                      href={imageSrc}
                      download={`scene-${String(s.index).padStart(2, "0")}.png`}
                      style={{
                        fontSize: 12,
                        textAlign: "center",
                        textDecoration: "none",
                        color: "var(--accent)",
                        border: "1px solid var(--accent)",
                        borderRadius: 4,
                        padding: "4px 8px",
                      }}
                    >
                      ⬇ ダウンロード
                    </a>
                  ) : null}
                </div>

                {/* 右: 情報 + プロンプト + ボタン */}
                <div style={{ display: "grid", gap: 8 }}>
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
                    {s.imageGeneratedAt ? (
                      <span style={{ fontSize: 11, color: "var(--muted)" }}>
                        生成 {new Date(s.imageGeneratedAt).toLocaleString("ja-JP")}
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
                    <strong style={{ color: "inherit" }}>caption:</strong> {s.caption}
                    <br />
                    <strong style={{ color: "inherit" }}>narration:</strong>{" "}
                    {s.narration.length > 80 ? s.narration.slice(0, 80) + "…" : s.narration}
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
                        日本語・任意 / 例: 「ケーキを食べている姿」「両手で板チョコを掲げてドヤ顔」
                      </span>
                    </span>
                    <textarea
                      value={s.imagePromptJa ?? ""}
                      onChange={(e) => updatePromptJa(s.index, e.target.value)}
                      rows={3}
                      placeholder="空でも OK。空なら caption / narration から AI が自動でポーズを推測します。"
                      disabled={isRegen || isGen}
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
                      onClick={() => handleGenerateImage(s.index)}
                      disabled={isRegen || isGen}
                      style={smallPrimary(isGen)}
                    >
                      {isGen
                        ? "生成中..."
                        : s.imagePath
                        ? "画像を再生成"
                        : "画像を生成"}
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
                      {/* 動画プレビュー / placeholder */}
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
                            : "先に静止画を生成してください"}
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
                        disabled={
                          !s.imagePath || genAnimationIdx === s.index || isGen
                        }
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

                  <details>
                    <summary
                      style={{
                        fontSize: 11,
                        color: "var(--muted)",
                        cursor: "pointer",
                      }}
                    >
                      ▼ 詳細・上級者向け（生成された英語プロンプトの確認・編集）
                    </summary>
                    <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
                      <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
                        <span style={{ fontWeight: 600 }}>
                          imagePromptEn{" "}
                          <span
                            style={{
                              fontWeight: 400,
                              color: "var(--muted)",
                              fontSize: 11,
                              marginLeft: 4,
                            }}
                          >
                            実際に Nano Banana に渡る英語プロンプト
                          </span>
                        </span>
                        <textarea
                          value={s.imagePromptEn ?? ""}
                          onChange={(e) => updatePromptEn(s.index, e.target.value)}
                          rows={5}
                          placeholder="まだ生成されていません。"
                          disabled={isRegen || isGen}
                          style={{
                            padding: "6px 8px",
                            border: "1px solid var(--border)",
                            borderRadius: 4,
                            fontSize: 11,
                            background: "var(--card)",
                            color: "inherit",
                            fontFamily: "ui-monospace, SFMono-Regular, monospace",
                            lineHeight: 1.5,
                            resize: "vertical",
                          }}
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() => handleRegeneratePrompt(s.index)}
                        disabled={isRegen || isGen}
                        style={smallSecondary(isRegen)}
                      >
                        {isRegen
                          ? "プロンプト生成中..."
                          : "英語プロンプトのみ再生成（画像は作らない）"}
                      </button>
                    </div>
                  </details>
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
