"use client";

import { useEffect, useState } from "react";
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

interface ExpandResult {
  ok: boolean;
  job?: ManabilabCanvaJob;
  scenes?: ManabilabCanvaScene[];
  error?: string;
}

interface SaveResult {
  ok: boolean;
  job?: ManabilabCanvaJob;
  error?: string;
}

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

export function ScenesStep({
  job,
  scenes: initialScenes,
  onJobChange,
  onScenesChange,
  onAdvance,
}: Props) {
  const [scenes, setScenes] = useState<ManabilabCanvaScene[] | null>(initialScenes);
  const [expanding, setExpanding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialScenes && !scenes) setScenes(initialScenes);
  }, [initialScenes, scenes]);

  const scriptDone = job.steps.script.status === "done";
  const status = job.steps.scenes.status;

  const handleExpand = async (force = false) => {
    if (!scriptDone) {
      setError("先に Script ステップを完了してください");
      return;
    }
    if (
      scenes &&
      scenes.length > 0 &&
      !force &&
      !confirm(
        "編集中のシーンが上書きされます。最新の台本から再展開しますか？",
      )
    ) {
      return;
    }
    setExpanding(true);
    setError(null);
    try {
      const res = await fetch(`/api/manabilab-canva/${job.id}/scenes/expand`, {
        method: "POST",
      });
      const data = (await res.json()) as ExpandResult;
      if (!data.ok || !data.job || !data.scenes) {
        setError(data.error ?? "シーン展開に失敗しました");
        return;
      }
      onJobChange(data.job);
      onScenesChange(data.scenes);
      setScenes(data.scenes);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setExpanding(false);
    }
  };

  const handleSave = async (advance: boolean) => {
    if (!scenes || scenes.length === 0) {
      setError("先にシーンを展開してください");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/manabilab-canva/${job.id}/scenes`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenes }),
      });
      const data = (await res.json()) as SaveResult;
      if (!data.ok || !data.job) {
        setError(data.error ?? "保存に失敗しました");
        return;
      }
      onJobChange(data.job);
      onScenesChange(scenes);
      if (advance) onAdvance();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const updateScene = (
    index: number,
    patch: Partial<Pick<ManabilabCanvaScene, "narration" | "caption">>,
  ) => {
    if (!scenes) return;
    setScenes(scenes.map((s) => (s.index === index ? { ...s, ...patch } : s)));
  };

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <header>
        <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>④ Scenes</h2>
        <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>
          台本の <code>hook / statements[] / cta / punchline</code> を 1 シーンずつに展開する。
          各シーンは TTS 用ナレと、シーンの要点フレーズ（caption。画像/動画 AI プロンプトの構図ヒントに使う）と、画像生成用プロンプトを持つ。
        </p>
        <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
          「保存して次へ →」で確定すると、Images ステップでシーンごとに <strong>3 つの構図候補</strong>{" "}
          が自動で生成される。
        </p>
      </header>

      {!scriptDone ? (
        <p style={{ color: "#d32f2f", fontSize: 13 }}>
          先に Script ステップを完了してください。
        </p>
      ) : null}

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={() => handleExpand(false)}
          disabled={expanding || saving || !scriptDone}
          style={primaryButtonStyle(expanding)}
        >
          {expanding
            ? "展開中..."
            : scenes && scenes.length > 0
            ? "台本から再展開"
            : "台本からシーンを展開"}
        </button>
        {status === "done" && !expanding ? (
          <span style={{ fontSize: 12, color: "#2e7d32" }}>✓ 保存済み</span>
        ) : null}
        {scenes ? (
          <span style={{ fontSize: 12, color: "var(--muted)" }}>
            {scenes.length} シーン
          </span>
        ) : null}
      </div>

      {error ? (
        <p style={{ color: "#d32f2f", fontSize: 13, margin: 0 }}>{error}</p>
      ) : null}

      {scenes && scenes.length > 0 ? (
        <>
          <div style={{ display: "grid", gap: 12 }}>
            {scenes.map((s) => (
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
                  <span style={{ fontSize: 11, color: "var(--muted)" }}>
                    ナレ {s.narration.length} 字 / 字幕 {s.caption.length} 字
                  </span>
                </div>

                <label style={fieldLabelStyle}>
                  <span style={fieldHeaderStyle}>
                    caption{" "}
                    <span style={hintStyle}>シーンの要点フレーズ（短文）。画像/動画 AI プロンプトの構図ヒントに使う</span>
                  </span>
                  <input
                    type="text"
                    value={s.caption}
                    onChange={(e) => updateScene(s.index, { caption: e.target.value })}
                    style={inputStyle}
                    disabled={saving || expanding}
                  />
                </label>

                <label style={fieldLabelStyle}>
                  <span style={fieldHeaderStyle}>
                    narration <span style={hintStyle}>TTS で読むナレ本文</span>
                  </span>
                  <textarea
                    value={s.narration}
                    onChange={(e) => updateScene(s.index, { narration: e.target.value })}
                    rows={3}
                    style={textareaStyle}
                    disabled={saving || expanding}
                  />
                </label>

              </div>
            ))}
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button
              type="button"
              onClick={() => handleSave(false)}
              disabled={saving || expanding}
              style={secondaryButtonStyle(saving)}
            >
              {saving ? "保存中..." : "下書き保存"}
            </button>
            <button
              type="button"
              onClick={() => handleSave(true)}
              disabled={saving || expanding}
              style={primaryButtonStyle(saving)}
            >
              保存して次へ →
            </button>
          </div>
        </>
      ) : (
        <p
          style={{
            color: "var(--muted)",
            fontSize: 13,
            padding: "32px 0",
            textAlign: "center",
          }}
        >
          まだシーンがありません。「台本からシーンを展開」を押してください。
        </p>
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: "8px 10px",
  border: "1px solid var(--border)",
  borderRadius: 6,
  fontSize: 14,
  background: "var(--card)",
  color: "inherit",
};

const textareaStyle: React.CSSProperties = {
  ...inputStyle,
  fontFamily: "ui-monospace, SFMono-Regular, monospace",
  fontSize: 13,
  lineHeight: 1.6,
  resize: "vertical",
};

const fieldLabelStyle: React.CSSProperties = {
  display: "grid",
  gap: 4,
  fontSize: 13,
};

const fieldHeaderStyle: React.CSSProperties = {
  fontWeight: 600,
};

const hintStyle: React.CSSProperties = {
  fontWeight: 400,
  color: "var(--muted)",
  fontSize: 11,
  marginLeft: 4,
};

function primaryButtonStyle(loading: boolean): React.CSSProperties {
  return {
    padding: "10px 20px",
    background: "var(--accent)",
    color: "white",
    border: "none",
    borderRadius: 6,
    fontWeight: 600,
    cursor: loading ? "not-allowed" : "pointer",
    opacity: loading ? 0.6 : 1,
  };
}

function secondaryButtonStyle(loading: boolean): React.CSSProperties {
  return {
    padding: "10px 20px",
    background: "transparent",
    color: "var(--accent)",
    border: "1.5px solid var(--accent)",
    borderRadius: 6,
    fontWeight: 600,
    cursor: loading ? "not-allowed" : "pointer",
    opacity: loading ? 0.6 : 1,
  };
}
