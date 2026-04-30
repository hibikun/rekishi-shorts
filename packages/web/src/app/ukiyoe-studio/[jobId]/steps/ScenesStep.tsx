"use client";

import { useEffect, useState } from "react";
import type {
  UkiyoeActionTag,
  UkiyoeJob,
  UkiyoeScenePlan,
  UkiyoeSceneSpec,
} from "@rekishi/shared";

interface Props {
  job: UkiyoeJob;
  scenePlan: UkiyoeScenePlan | null;
  onJobChange: (job: UkiyoeJob) => void;
  onScenePlanChange: (plan: UkiyoeScenePlan) => void;
  onAdvance: () => void;
}

const ACTION_TAGS: UkiyoeActionTag[] = [
  "running_forward",
  "eating_meal",
  "drawing_sword",
  "walking_carrying",
  "sleeping",
  "crowd_cheering",
  "weather_dynamic",
  "still_subtle",
];

interface RunResult {
  ok: boolean;
  job?: UkiyoeJob;
  scenePlan?: UkiyoeScenePlan;
  error?: string;
}

interface SaveResult {
  ok: boolean;
  job?: UkiyoeJob;
  scenePlan?: UkiyoeScenePlan;
  error?: string;
}

interface TranslateResult {
  ok: boolean;
  en?: string;
  error?: string;
}

export function ScenesStep({
  job,
  scenePlan,
  onJobChange,
  onScenePlanChange,
  onAdvance,
}: Props) {
  const [draft, setDraft] = useState<UkiyoeScenePlan | null>(scenePlan);
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [translating, setTranslating] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (scenePlan && !draft) setDraft(scenePlan);
  }, [scenePlan, draft]);

  const status = job.steps.scenes.status;
  const scriptDone = job.steps.script.status === "done";

  const handleRun = async () => {
    if (!scriptDone) {
      setError("先に Script ステップを完了してください");
      return;
    }
    setRunning(true);
    setError(null);
    try {
      const res = await fetch(`/api/ukiyoe-studio/${job.id}/scenes/run`, {
        method: "POST",
      });
      const data = (await res.json()) as RunResult;
      if (!data.ok || !data.job || !data.scenePlan) {
        setError(data.error ?? "シーン生成に失敗しました");
        return;
      }
      onJobChange(data.job);
      onScenePlanChange(data.scenePlan);
      setDraft(data.scenePlan);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  };

  const handleSave = async (advance: boolean) => {
    if (!draft) {
      setError("先にシーンを生成してください");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/ukiyoe-studio/${job.id}/scenes`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenePlan: draft }),
      });
      const data = (await res.json()) as SaveResult;
      if (!data.ok || !data.job || !data.scenePlan) {
        setError(data.error ?? "保存に失敗しました");
        return;
      }
      onJobChange(data.job);
      onScenePlanChange(data.scenePlan);
      if (advance) onAdvance();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const updateScene = (idx: number, patch: Partial<UkiyoeSceneSpec>) => {
    if (!draft) return;
    const scenes = draft.scenes.map((s, i) =>
      i === idx ? { ...s, ...patch } : s,
    );
    setDraft({ ...draft, scenes });
  };

  const handleTranslate = async (idx: number) => {
    if (!draft) return;
    const scene = draft.scenes[idx];
    const ja = scene.videoPromptJa.trim();
    if (!ja) {
      setError("videoPromptJa を入力してから翻訳してください");
      return;
    }
    setTranslating(scene.index);
    setError(null);
    try {
      const res = await fetch(
        `/api/ukiyoe-studio/${job.id}/scenes/${scene.index}/translate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ja }),
        },
      );
      const data = (await res.json()) as TranslateResult;
      if (!data.ok || !data.en) {
        setError(data.error ?? "翻訳に失敗しました");
        return;
      }
      updateScene(idx, { videoPrompt: data.en, videoPromptJa: ja });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setTranslating(null);
    }
  };

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <header>
        <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>④ Scenes</h2>
        <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>
          ナレーションを {job.topic.sceneCount} シーンに分割し、画像/動画プロンプトと動勢タグを付与する。
        </p>
      </header>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={handleRun}
          disabled={running || saving || !scriptDone}
          style={primaryButtonStyle(running)}
        >
          {running ? "生成中..." : draft ? "再生成" : "シーンを生成"}
        </button>
        <span style={{ alignSelf: "center", fontSize: 12, color: "var(--muted)" }}>
          status: <strong>{status}</strong> / {draft?.scenes.length ?? 0} シーン
        </span>
      </div>

      {!draft ? (
        <p style={{ color: "var(--muted)", fontSize: 13 }}>
          「シーンを生成」を押してナレーションを {job.topic.sceneCount} シーンに分割します。
        </p>
      ) : (
        <ul
          style={{
            listStyle: "none",
            padding: 0,
            margin: 0,
            display: "grid",
            gap: 16,
          }}
        >
          {draft.scenes.map((scene, idx) => (
            <li
              key={scene.index}
              style={{
                border: "1px solid var(--border)",
                borderRadius: 8,
                padding: 16,
                background: "var(--bg)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                  marginBottom: 8,
                }}
              >
                <strong style={{ fontSize: 14 }}>scene[{scene.index}]</strong>
                <span style={{ fontSize: 11, color: "var(--muted)" }}>
                  {scene.durationSec.toFixed(1)}s
                </span>
              </div>

              <Field label="ナレーション">
                <input
                  type="text"
                  value={scene.narration}
                  onChange={(e) =>
                    updateScene(idx, { narration: e.target.value })
                  }
                  style={inputStyle}
                />
              </Field>

              <Field label="imagePrompt (英語)">
                <textarea
                  value={scene.imagePrompt}
                  onChange={(e) =>
                    updateScene(idx, { imagePrompt: e.target.value })
                  }
                  rows={2}
                  style={textareaStyle}
                />
              </Field>

              <Field label="videoPromptJa (日本語・編集用)">
                <textarea
                  value={scene.videoPromptJa}
                  onChange={(e) =>
                    updateScene(idx, { videoPromptJa: e.target.value })
                  }
                  rows={3}
                  style={textareaStyle}
                />
                <button
                  type="button"
                  onClick={() => handleTranslate(idx)}
                  disabled={translating !== null}
                  style={{
                    alignSelf: "start",
                    marginTop: 6,
                    padding: "4px 10px",
                    fontSize: 12,
                    border: "1px solid var(--accent)",
                    color: "var(--accent)",
                    background: "transparent",
                    borderRadius: 4,
                    cursor:
                      translating === scene.index ? "not-allowed" : "pointer",
                  }}
                >
                  {translating === scene.index
                    ? "翻訳中..."
                    : "videoPrompt に英訳反映"}
                </button>
              </Field>

              <Field label="videoPrompt (英語・Seedance 送信)">
                <textarea
                  value={scene.videoPrompt}
                  onChange={(e) =>
                    updateScene(idx, { videoPrompt: e.target.value })
                  }
                  rows={3}
                  style={textareaStyle}
                />
              </Field>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 12,
                  marginTop: 8,
                }}
              >
                <Field label="actionTag">
                  <select
                    value={scene.actionTag}
                    onChange={(e) =>
                      updateScene(idx, {
                        actionTag: e.target.value as UkiyoeActionTag,
                      })
                    }
                    style={inputStyle}
                  >
                    {ACTION_TAGS.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="cameraFixed">
                  <select
                    value={scene.cameraFixed === undefined ? "auto" : String(scene.cameraFixed)}
                    onChange={(e) => {
                      const v = e.target.value;
                      updateScene(idx, {
                        cameraFixed: v === "auto" ? undefined : v === "true",
                      });
                    }}
                    style={inputStyle}
                  >
                    <option value="auto">auto</option>
                    <option value="true">true (繊細な動き)</option>
                    <option value="false">false (大きく動く)</option>
                  </select>
                </Field>
              </div>

              <details style={{ marginTop: 8 }}>
                <summary style={{ cursor: "pointer", fontSize: 12, color: "var(--muted)" }}>
                  motion (Remotion 演出)
                </summary>
                <pre
                  style={{
                    fontSize: 11,
                    background: "var(--card)",
                    padding: 8,
                    borderRadius: 4,
                    overflowX: "auto",
                  }}
                >
                  {JSON.stringify(scene.motion ?? {}, null, 2)}
                </pre>
              </details>
            </li>
          ))}
        </ul>
      )}

      {error ? (
        <p style={{ color: "#d32f2f", fontSize: 13, margin: 0 }}>{error}</p>
      ) : null}

      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="button"
          onClick={() => handleSave(false)}
          disabled={saving || running || !draft}
          style={secondaryButtonStyle(saving)}
        >
          保存
        </button>
        <button
          type="button"
          onClick={() => handleSave(true)}
          disabled={saving || running || !draft}
          style={primaryButtonStyle(saving)}
        >
          保存して Images へ →
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: "grid", gap: 4, fontSize: 12, marginBottom: 8 }}>
      <span style={{ fontWeight: 600, color: "var(--muted)" }}>{label}</span>
      {children}
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  padding: "6px 10px",
  border: "1px solid var(--border)",
  borderRadius: 4,
  fontSize: 13,
  background: "var(--card)",
  color: "inherit",
};

const textareaStyle: React.CSSProperties = {
  ...inputStyle,
  resize: "vertical",
  fontFamily: "inherit",
  lineHeight: 1.5,
};

function primaryButtonStyle(loading: boolean): React.CSSProperties {
  return {
    padding: "10px 18px",
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
    padding: "10px 18px",
    background: "transparent",
    color: "var(--accent)",
    border: "1px solid var(--accent)",
    borderRadius: 6,
    fontWeight: 600,
    cursor: loading ? "not-allowed" : "pointer",
    opacity: loading ? 0.6 : 1,
  };
}
