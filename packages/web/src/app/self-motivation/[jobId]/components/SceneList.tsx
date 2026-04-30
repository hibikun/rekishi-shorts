"use client";

import { useState } from "react";
import type { SelfMotivationScene } from "@rekishi/shared";
import { LONGFORM_MOTION_PRESETS } from "@/lib/longform-motion-options";

interface Props {
  jobId: string;
  scenes: SelfMotivationScene[];
  selectedSceneId: string | null;
  onSelectScene: (sceneId: string) => void;
  onScenesChange: (scenes: SelfMotivationScene[]) => Promise<void>;
}

const NEW_SCENE_PLACEHOLDER = "（新規シーン：ここを編集してください）";

const generateLocalSceneId = () =>
  Math.random().toString(36).slice(2, 10).padStart(8, "0");

function autoSplitNarration(text: string): [string, string] {
  const trimmed = text.trim();
  if (trimmed.length < 4) return [trimmed, ""];
  const mid = Math.floor(trimmed.length / 2);
  const punct = /[。、！？!?]/;
  for (let dist = 0; dist < trimmed.length; dist++) {
    for (const dir of [1, -1] as const) {
      const i = mid + dir * dist;
      if (i > 0 && i < trimmed.length - 1 && punct.test(trimmed[i] ?? "")) {
        return [trimmed.slice(0, i + 1), trimmed.slice(i + 1).trim()];
      }
    }
  }
  return [trimmed.slice(0, mid), trimmed.slice(mid)];
}

function reindex(scenes: SelfMotivationScene[]): SelfMotivationScene[] {
  return scenes.map((s, i) => ({ ...s, index: i }));
}

export function SceneList({
  jobId,
  scenes,
  selectedSceneId,
  onSelectScene,
  onScenesChange,
}: Props) {
  const [savingSceneId, setSavingSceneId] = useState<string | null>(null);
  const [regeneratingSceneId, setRegeneratingSceneId] = useState<string | null>(
    null,
  );
  const [animatingSceneId, setAnimatingSceneId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const updateField = async <K extends keyof SelfMotivationScene>(
    sceneId: string,
    key: K,
    value: SelfMotivationScene[K],
  ) => {
    const next = scenes.map((s) =>
      s.sceneId === sceneId ? { ...s, [key]: value } : s,
    );
    setSavingSceneId(sceneId);
    setError(null);
    try {
      await onScenesChange(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingSceneId(null);
    }
  };

  const removeScene = async (sceneId: string) => {
    const next = reindex(scenes.filter((s) => s.sceneId !== sceneId));
    setSavingSceneId(sceneId);
    setError(null);
    try {
      await onScenesChange(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingSceneId(null);
    }
  };

  /**
   * シーンを 2 つに分割する。
   * - 元シーンは sceneId/画像を維持し、narration を前半に。音声は narration が変わるためクリア
   * - 後半は新 sceneId で画像/音声なし（chapterIndex/paragraphIndex は元と同じ）
   */
  const splitScene = async (
    sceneId: string,
    firstHalf: string,
    secondHalf: string,
  ) => {
    const idx = scenes.findIndex((s) => s.sceneId === sceneId);
    if (idx < 0) return;
    const original = scenes[idx];
    if (!original) return;
    const trimmedFirst = firstHalf.trim();
    const trimmedSecond = secondHalf.trim();
    if (!trimmedFirst || !trimmedSecond) {
      setError("前半・後半とも空にはできません");
      return;
    }
    const first: SelfMotivationScene = {
      ...original,
      narration: trimmedFirst,
      audioPath: undefined,
      audioDurationSec: undefined,
      audioGeneratedAt: undefined,
    };
    const second: SelfMotivationScene = {
      ...original,
      sceneId: generateLocalSceneId(),
      narration: trimmedSecond,
      imagePromptEn: "",
      imagePath: undefined,
      imageGeneratedAt: undefined,
      audioPath: undefined,
      audioDurationSec: undefined,
      audioGeneratedAt: undefined,
    };
    const next = reindex([
      ...scenes.slice(0, idx),
      first,
      second,
      ...scenes.slice(idx + 1),
    ]);
    setSavingSceneId(sceneId);
    setError(null);
    try {
      await onScenesChange(next);
      onSelectScene(second.sceneId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingSceneId(null);
    }
  };

  /**
   * insertAt の位置に新規シーンを挿入する。
   * - insertAt = 0: 先頭、insertAt = scenes.length: 末尾、それ以外は scenes[insertAt-1] と scenes[insertAt] の間
   * - chapter/paragraphIndex は前隣（無ければ後隣）から継承
   */
  const insertScene = async (insertAt: number) => {
    const anchor = scenes[insertAt - 1] ?? scenes[insertAt] ?? null;
    const newScene: SelfMotivationScene = {
      sceneId: generateLocalSceneId(),
      index: insertAt,
      chapterIndex: anchor?.chapterIndex ?? 0,
      paragraphIndex: anchor?.paragraphIndex ?? 0,
      narration: NEW_SCENE_PLACEHOLDER,
      imagePromptJa: "",
      imagePromptEn: "",
      motionPresetId: "auto",
      videoPromptJa: "",
      videoPromptEn: "",
    };
    const next = reindex([
      ...scenes.slice(0, insertAt),
      newScene,
      ...scenes.slice(insertAt),
    ]);
    setSavingSceneId(newScene.sceneId);
    setError(null);
    try {
      await onScenesChange(next);
      onSelectScene(newScene.sceneId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingSceneId(null);
    }
  };

  const regenerateImage = async (sceneId: string, userDirection: string) => {
    setRegeneratingSceneId(sceneId);
    setError(null);
    try {
      const res = await fetch(
        `/api/self-motivation/${jobId}/scenes/${sceneId}/regenerate-image`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userDirection }),
        },
      );
      const data = (await res.json()) as {
        ok: boolean;
        error?: string;
        scene?: SelfMotivationScene;
      };
      if (!data.ok || !data.scene) {
        setError(data.error ?? "画像再生成に失敗");
        return;
      }
      const next = scenes.map((s) =>
        s.sceneId === sceneId ? data.scene! : s,
      );
      await onScenesChange(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRegeneratingSceneId(null);
    }
  };

  const regenerateAnimation = async (
    sceneId: string,
    userDirection: string,
  ) => {
    setAnimatingSceneId(sceneId);
    setError(null);
    try {
      const res = await fetch(
        `/api/self-motivation/${jobId}/scenes/${sceneId}/regenerate-animation`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userDirection }),
        },
      );
      const data = (await res.json()) as {
        ok: boolean;
        error?: string;
        scene?: SelfMotivationScene;
      };
      if (!data.ok || !data.scene) {
        setError(data.error ?? "アニメ生成に失敗");
        return;
      }
      const next = scenes.map((s) =>
        s.sceneId === sceneId ? data.scene! : s,
      );
      await onScenesChange(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAnimatingSceneId(null);
    }
  };

  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 8,
        background: "var(--card)",
        padding: 12,
        display: "grid",
        gap: 4,
        maxHeight: "calc(100vh - 280px)",
        overflowY: "auto",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 4px 4px",
        }}
      >
        <strong style={{ fontSize: 14 }}>シーン ({scenes.length})</strong>
        {error ? (
          <span style={{ fontSize: 12, color: "#d32f2f" }}>{error}</span>
        ) : null}
      </div>
      {scenes.length === 0 ? (
        <p style={{ color: "var(--muted)", fontSize: 13, margin: 0 }}>
          シーンがまだ展開されていません。Pipeline の「Scenes」ボタンを押してください。
        </p>
      ) : (
        <>
          <Inserter onInsert={() => insertScene(0)} />
          {scenes.map((scene, i) => (
            <div key={scene.sceneId}>
              <SceneCard
                jobId={jobId}
                scene={scene}
                selected={scene.sceneId === selectedSceneId}
                saving={savingSceneId === scene.sceneId}
                regenerating={regeneratingSceneId === scene.sceneId}
                animating={animatingSceneId === scene.sceneId}
                onSelect={() => onSelectScene(scene.sceneId)}
                onChangeNarration={(v) =>
                  updateField(scene.sceneId, "narration", v)
                }
                onChangeMotion={(v) =>
                  updateField(scene.sceneId, "motionPresetId", v)
                }
                onChangePromptJa={(v) =>
                  updateField(scene.sceneId, "imagePromptJa", v)
                }
                onRegenerateImage={(d) => regenerateImage(scene.sceneId, d)}
                onRegenerateAnimation={(d) =>
                  regenerateAnimation(scene.sceneId, d)
                }
                onRemove={() => removeScene(scene.sceneId)}
                onSplit={(a, b) => splitScene(scene.sceneId, a, b)}
              />
              <Inserter onInsert={() => insertScene(i + 1)} />
            </div>
          ))}
        </>
      )}
    </div>
  );
}

interface InserterProps {
  onInsert: () => void;
}

function Inserter({ onInsert }: InserterProps) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        height: hover ? 28 : 8,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        transition: "height 120ms",
        cursor: "pointer",
      }}
      onClick={onInsert}
    >
      {hover ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onInsert();
          }}
          style={{
            fontSize: 11,
            padding: "2px 10px",
            border: "1px dashed var(--accent)",
            borderRadius: 12,
            background: "var(--card)",
            color: "var(--accent)",
            cursor: "pointer",
          }}
        >
          + ここに挿入
        </button>
      ) : (
        <div
          style={{
            width: "100%",
            height: 1,
            background: "transparent",
          }}
        />
      )}
    </div>
  );
}

interface SceneCardProps {
  jobId: string;
  scene: SelfMotivationScene;
  selected: boolean;
  saving: boolean;
  regenerating: boolean;
  animating: boolean;
  onSelect: () => void;
  onChangeNarration: (v: string) => void;
  onChangeMotion: (v: string) => void;
  onChangePromptJa: (v: string) => void;
  onRegenerateImage: (userDirection: string) => void;
  onRegenerateAnimation: (userDirection: string) => void;
  onRemove: () => void;
  onSplit: (firstHalf: string, secondHalf: string) => void;
}

function SceneCard({
  jobId: _jobId,
  scene,
  selected,
  saving,
  regenerating,
  animating,
  onSelect,
  onChangeNarration,
  onChangeMotion,
  onChangePromptJa,
  onRegenerateImage,
  onRegenerateAnimation,
  onRemove,
  onSplit,
}: SceneCardProps) {
  const imageUrl = scene.imagePath
    ? `/self-motivation/${scene.imagePath}?t=${scene.imageGeneratedAt ?? ""}`
    : null;

  const [splitOpen, setSplitOpen] = useState(false);
  const [splitFirst, setSplitFirst] = useState("");
  const [splitSecond, setSplitSecond] = useState("");

  const openSplit = () => {
    const [a, b] = autoSplitNarration(scene.narration);
    setSplitFirst(a);
    setSplitSecond(b);
    setSplitOpen(true);
  };

  return (
    <div
      onClick={onSelect}
      style={{
        border: selected ? "2px solid var(--accent)" : "1px solid var(--border)",
        borderRadius: 6,
        padding: 10,
        background: selected ? "rgba(33, 150, 243, 0.08)" : "transparent",
        cursor: "pointer",
        display: "grid",
        gap: 6,
      }}
    >
      <div
        style={{
          display: "flex",
          gap: 10,
          alignItems: "center",
          fontSize: 12,
          color: "var(--muted)",
        }}
      >
        <span style={{ fontWeight: 700, color: "inherit" }}>
          #{scene.index + 1}
        </span>
        <span>
          {scene.audioDurationSec
            ? `${scene.audioDurationSec.toFixed(1)}s`
            : "未生成"}
        </span>
        <span style={{ marginLeft: "auto" }}>
          {saving ? "保存中…" : null}
        </span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "96px 1fr", gap: 10 }}>
        <div
          style={{
            width: 96,
            height: 54,
            background: "#0A0A0A",
            borderRadius: 4,
            overflow: "hidden",
            position: "relative",
          }}
        >
          {imageUrl ? (
            <img
              src={imageUrl}
              alt=""
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
              }}
            />
          ) : (
            <div
              style={{
                width: "100%",
                height: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#666",
                fontSize: 10,
              }}
            >
              no image
            </div>
          )}
          {scene.videoPath ? (
            <div
              style={{
                position: "absolute",
                top: 2,
                right: 2,
                background: "rgba(33, 150, 243, 0.9)",
                color: "#fff",
                fontSize: 10,
                padding: "1px 4px",
                borderRadius: 3,
                fontWeight: 700,
              }}
              title="このシーンはアニメ生成済み"
            >
              🎬
            </div>
          ) : null}
        </div>

        <textarea
          value={scene.narration}
          onChange={(e) => onChangeNarration(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          rows={2}
          style={{
            width: "100%",
            fontSize: 13,
            padding: 6,
            border: "1px solid var(--border)",
            borderRadius: 4,
            background: "var(--card)",
            color: "inherit",
            resize: "vertical",
          }}
        />
      </div>

      <div
        style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}
        onClick={(e) => e.stopPropagation()}
      >
        <label
          style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12 }}
        >
          <span style={{ color: "var(--muted)" }}>Motion:</span>
          <select
            value={scene.motionPresetId}
            onChange={(e) => onChangeMotion(e.target.value)}
            style={{
              fontSize: 12,
              padding: "4px 6px",
              border: "1px solid var(--border)",
              borderRadius: 4,
              background: "var(--card)",
              color: "inherit",
            }}
          >
            {LONGFORM_MOTION_PRESETS.map((p) => (
              <option key={p.id} value={p.id} title={p.description}>
                {p.label}
              </option>
            ))}
          </select>
        </label>

        <input
          type="text"
          placeholder="画像指示 (任意・日本語)"
          value={scene.imagePromptJa ?? ""}
          onChange={(e) => onChangePromptJa(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          style={{
            flex: 1,
            minWidth: 120,
            fontSize: 12,
            padding: "4px 6px",
            border: "1px solid var(--border)",
            borderRadius: 4,
            background: "var(--card)",
            color: "inherit",
          }}
        />

        <button
          type="button"
          disabled={regenerating}
          onClick={(e) => {
            e.stopPropagation();
            onRegenerateImage(scene.imagePromptJa ?? "");
          }}
          style={smallBtn}
        >
          {regenerating ? "生成中…" : "🎨 画像"}
        </button>

        <button
          type="button"
          disabled={animating || !scene.imagePath}
          onClick={(e) => {
            e.stopPropagation();
            onRegenerateAnimation(scene.videoPromptJa ?? "");
          }}
          style={{
            ...smallBtn,
            borderColor: scene.videoPath ? "var(--accent)" : "var(--border)",
            color: scene.videoPath ? "var(--accent)" : "inherit",
          }}
          title={
            !scene.imagePath
              ? "先に画像を生成してください"
              : scene.videoPath
                ? "アニメを再生成 (約30秒〜3分・有料)"
                : "Seedance でアニメを生成 (約30秒〜3分・有料)"
          }
        >
          {animating
            ? "アニメ生成中…"
            : scene.videoPath
              ? "🎬 ✓ アニメ"
              : "🎬 アニメ"}
        </button>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (splitOpen) {
              setSplitOpen(false);
            } else {
              openSplit();
            }
          }}
          style={smallBtn}
          title="このシーンを 2 つに分割"
        >
          {splitOpen ? "✕ 分割キャンセル" : "✂ 分割"}
        </button>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (confirm(`シーン#${scene.index + 1} を削除しますか？`)) {
              onRemove();
            }
          }}
          style={{ ...smallBtn, color: "#c62828" }}
        >
          🗑
        </button>
      </div>

      {splitOpen ? (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            border: "1px dashed var(--accent)",
            borderRadius: 6,
            padding: 10,
            display: "grid",
            gap: 8,
            background: "rgba(33, 150, 243, 0.04)",
          }}
        >
          <div style={{ fontSize: 12, color: "var(--muted)" }}>
            前半は元シーンの画像を維持し音声をクリア / 後半は新シーンとして画像も音声もリセットされます。
          </div>
          <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
            <span style={{ color: "var(--muted)" }}>前半</span>
            <textarea
              value={splitFirst}
              onChange={(e) => setSplitFirst(e.target.value)}
              rows={2}
              style={splitTextareaStyle}
            />
          </label>
          <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
            <span style={{ color: "var(--muted)" }}>後半</span>
            <textarea
              value={splitSecond}
              onChange={(e) => setSplitSecond(e.target.value)}
              rows={2}
              style={splitTextareaStyle}
            />
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={() => {
                onSplit(splitFirst, splitSecond);
                setSplitOpen(false);
              }}
              disabled={!splitFirst.trim() || !splitSecond.trim()}
              style={{
                ...smallBtn,
                borderColor: "var(--accent)",
                color: "var(--accent)",
              }}
            >
              分割を確定
            </button>
            <button
              type="button"
              onClick={() => setSplitOpen(false)}
              style={smallBtn}
            >
              キャンセル
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const smallBtn: React.CSSProperties = {
  fontSize: 12,
  padding: "4px 8px",
  border: "1px solid var(--border)",
  borderRadius: 4,
  background: "transparent",
  color: "inherit",
  cursor: "pointer",
};

const splitTextareaStyle: React.CSSProperties = {
  width: "100%",
  fontSize: 13,
  padding: 6,
  border: "1px solid var(--border)",
  borderRadius: 4,
  background: "var(--card)",
  color: "inherit",
  resize: "vertical",
};
