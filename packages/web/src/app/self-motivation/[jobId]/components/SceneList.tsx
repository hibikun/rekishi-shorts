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
    const next = scenes
      .filter((s) => s.sceneId !== sceneId)
      .map((s, i) => ({ ...s, index: i }));
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

  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 8,
        background: "var(--card)",
        padding: 12,
        display: "grid",
        gap: 8,
        maxHeight: "calc(100vh - 280px)",
        overflowY: "auto",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 4px",
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
        scenes.map((scene) => (
          <SceneCard
            key={scene.sceneId}
            jobId={jobId}
            scene={scene}
            selected={scene.sceneId === selectedSceneId}
            saving={savingSceneId === scene.sceneId}
            regenerating={regeneratingSceneId === scene.sceneId}
            onSelect={() => onSelectScene(scene.sceneId)}
            onChangeNarration={(v) => updateField(scene.sceneId, "narration", v)}
            onChangeMotion={(v) =>
              updateField(scene.sceneId, "motionPresetId", v)
            }
            onChangePromptJa={(v) =>
              updateField(scene.sceneId, "imagePromptJa", v)
            }
            onRegenerateImage={(d) => regenerateImage(scene.sceneId, d)}
            onRemove={() => removeScene(scene.sceneId)}
          />
        ))
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
  onSelect: () => void;
  onChangeNarration: (v: string) => void;
  onChangeMotion: (v: string) => void;
  onChangePromptJa: (v: string) => void;
  onRegenerateImage: (userDirection: string) => void;
  onRemove: () => void;
}

function SceneCard({
  jobId,
  scene,
  selected,
  saving,
  regenerating,
  onSelect,
  onChangeNarration,
  onChangeMotion,
  onChangePromptJa,
  onRegenerateImage,
  onRemove,
}: SceneCardProps) {
  const imageUrl = scene.imagePath
    ? `/self-motivation/${scene.imagePath}?t=${scene.imageGeneratedAt ?? ""}`
    : null;

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
