"use client";

import { useEffect, useState } from "react";
import type { ManabilabCanvaJob, Script } from "@rekishi/shared";

interface Props {
  job: ManabilabCanvaJob;
  script: Script | null;
  onJobChange: (job: ManabilabCanvaJob) => void;
  onScriptChange: (script: Script) => void;
  onAdvance: () => void;
}

interface RunResult {
  ok: boolean;
  job?: ManabilabCanvaJob;
  script?: Script;
  error?: string;
}

interface SaveResult {
  ok: boolean;
  job?: ManabilabCanvaJob;
  error?: string;
}

interface DraftFields {
  narration: string;
  hook: string;
  body: string;
  closing: string;
  titleTop: string;
  titleBottom: string;
  estimatedDurationSec: number;
}

function scriptToDraft(s: Script): DraftFields {
  return {
    narration: s.narration,
    hook: s.hook,
    body: s.body,
    closing: s.closing,
    titleTop: s.title.top,
    titleBottom: s.title.bottom,
    estimatedDurationSec: s.estimatedDurationSec,
  };
}

export function ScriptStep({
  job,
  script,
  onJobChange,
  onScriptChange,
  onAdvance,
}: Props) {
  const [draft, setDraft] = useState<DraftFields | null>(
    script ? scriptToDraft(script) : null,
  );
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (script && !draft) setDraft(scriptToDraft(script));
  }, [script, draft]);

  const status = job.steps.script.status;
  const researchDone = job.steps.research.status === "done";

  const handleRun = async () => {
    if (!researchDone) {
      setError("先に Research ステップを完了してください");
      return;
    }
    setRunning(true);
    setError(null);
    try {
      const res = await fetch(`/api/manabilab-canva/${job.id}/script/run`, {
        method: "POST",
      });
      const data = (await res.json()) as RunResult;
      if (!data.ok || !data.job || !data.script) {
        setError(data.error ?? "台本生成に失敗しました");
        return;
      }
      onJobChange(data.job);
      onScriptChange(data.script);
      setDraft(scriptToDraft(data.script));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  };

  const handleSave = async (advance: boolean) => {
    if (!draft || !script) {
      setError("先に台本を生成してください");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const next: Script = {
        ...script,
        narration: draft.narration,
        hook: draft.hook,
        body: draft.body,
        closing: draft.closing,
        title: { top: draft.titleTop, bottom: draft.titleBottom },
        estimatedDurationSec: draft.estimatedDurationSec,
      };
      const res = await fetch(`/api/manabilab-canva/${job.id}/script`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ script: next }),
      });
      const data = (await res.json()) as SaveResult;
      if (!data.ok || !data.job) {
        setError(data.error ?? "保存に失敗しました");
        return;
      }
      onJobChange(data.job);
      onScriptChange(next);
      if (advance) onAdvance();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <header>
        <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>③ Script</h2>
        <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>
          リサーチを元に台本を生成。narration / hook / closing / タイトルを編集できる。
        </p>
      </header>

      {!researchDone ? (
        <p style={{ color: "#d32f2f", fontSize: 13 }}>
          先に Research ステップを完了してください。
        </p>
      ) : null}

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button
          type="button"
          onClick={handleRun}
          disabled={running || saving || !researchDone}
          style={primaryButtonStyle(running)}
        >
          {running ? "生成中..." : draft ? "台本を再生成" : "AIで台本を生成"}
        </button>
        {status === "done" && !running ? (
          <span style={{ fontSize: 12, color: "#2e7d32" }}>✓ 保存済み</span>
        ) : null}
        {draft ? (
          <span style={{ fontSize: 12, color: "var(--muted)" }}>
            推定 {draft.estimatedDurationSec.toFixed(1)} 秒 / {draft.narration.length} 字
          </span>
        ) : null}
      </div>

      {error ? (
        <p style={{ color: "#d32f2f", fontSize: 13, margin: 0 }}>{error}</p>
      ) : null}

      {draft ? (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <label style={fieldLabelStyle}>
              <span style={fieldHeaderStyle}>タイトル上段</span>
              <input
                type="text"
                value={draft.titleTop}
                onChange={(e) => setDraft({ ...draft, titleTop: e.target.value })}
                style={inputStyle}
                disabled={saving || running}
              />
            </label>
            <label style={fieldLabelStyle}>
              <span style={fieldHeaderStyle}>タイトル下段</span>
              <input
                type="text"
                value={draft.titleBottom}
                onChange={(e) => setDraft({ ...draft, titleBottom: e.target.value })}
                style={inputStyle}
                disabled={saving || running}
              />
            </label>
          </div>

          <label style={fieldLabelStyle}>
            <span style={fieldHeaderStyle}>Hook（掴みの 1〜2 文）</span>
            <textarea
              value={draft.hook}
              onChange={(e) => setDraft({ ...draft, hook: e.target.value })}
              rows={2}
              style={textareaStyle}
              disabled={saving || running}
            />
          </label>

          <label style={fieldLabelStyle}>
            <span style={fieldHeaderStyle}>Narration（全体ナレーション）</span>
            <textarea
              value={draft.narration}
              onChange={(e) => setDraft({ ...draft, narration: e.target.value })}
              rows={10}
              style={textareaStyle}
              disabled={saving || running}
            />
          </label>

          <label style={fieldLabelStyle}>
            <span style={fieldHeaderStyle}>Body（本文 / 構成メモ）</span>
            <textarea
              value={draft.body}
              onChange={(e) => setDraft({ ...draft, body: e.target.value })}
              rows={6}
              style={textareaStyle}
              disabled={saving || running}
            />
          </label>

          <label style={fieldLabelStyle}>
            <span style={fieldHeaderStyle}>Closing（締め）</span>
            <textarea
              value={draft.closing}
              onChange={(e) => setDraft({ ...draft, closing: e.target.value })}
              rows={2}
              style={textareaStyle}
              disabled={saving || running}
            />
          </label>

          <label style={fieldLabelStyle}>
            <span style={fieldHeaderStyle}>推定秒数</span>
            <input
              type="number"
              value={draft.estimatedDurationSec}
              step={0.1}
              min={0}
              onChange={(e) =>
                setDraft({ ...draft, estimatedDurationSec: Number(e.target.value) || 0 })
              }
              style={{ ...inputStyle, width: 120 }}
              disabled={saving || running}
            />
          </label>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button
              type="button"
              onClick={() => handleSave(false)}
              disabled={saving || running}
              style={secondaryButtonStyle(saving)}
            >
              {saving ? "保存中..." : "下書き保存"}
            </button>
            <button
              type="button"
              onClick={() => handleSave(true)}
              disabled={saving || running}
              style={primaryButtonStyle(saving)}
            >
              保存して次へ →
            </button>
          </div>
        </>
      ) : (
        <p style={{ color: "var(--muted)", fontSize: 13, padding: "32px 0", textAlign: "center" }}>
          まだ台本がありません。「AIで台本を生成」を押してください。
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
