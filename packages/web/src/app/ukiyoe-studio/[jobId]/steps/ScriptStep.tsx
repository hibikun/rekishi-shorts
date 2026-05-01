"use client";

import { useEffect, useState } from "react";
import type { UkiyoeJob, UkiyoeScript } from "@rekishi/shared";

interface Props {
  job: UkiyoeJob;
  script: UkiyoeScript | null;
  onJobChange: (job: UkiyoeJob) => void;
  onScriptChange: (script: UkiyoeScript) => void;
  onAdvance: () => void;
}

interface ReadingDraft {
  term: string;
  reading: string;
}

interface DraftFields {
  hook: string;
  narration: string;
  keyTerms: string[];
  readings: ReadingDraft[];
  estimatedDurationSec: number;
}

function scriptToDraft(s: UkiyoeScript): DraftFields {
  return {
    hook: s.hook,
    narration: s.narration,
    keyTerms: [...s.keyTerms],
    readings: Object.entries(s.readings).map(([term, reading]) => ({
      term,
      reading,
    })),
    estimatedDurationSec: s.estimatedDurationSec,
  };
}

function draftToScript(prev: UkiyoeScript, d: DraftFields): UkiyoeScript {
  const readings: Record<string, string> = {};
  for (const r of d.readings) {
    if (r.term && r.reading && !readings[r.term]) readings[r.term] = r.reading;
  }
  return {
    ...prev,
    hook: d.hook,
    narration: d.narration,
    keyTerms: d.keyTerms,
    readings,
    estimatedDurationSec: d.estimatedDurationSec,
  };
}

interface RunResult {
  ok: boolean;
  job?: UkiyoeJob;
  script?: UkiyoeScript;
  error?: string;
}

interface SaveResult {
  ok: boolean;
  job?: UkiyoeJob;
  script?: UkiyoeScript;
  error?: string;
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
      const res = await fetch(`/api/ukiyoe-studio/${job.id}/script/run`, {
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
    const next = draftToScript(script, draft);
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/ukiyoe-studio/${job.id}/script`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ script: next }),
      });
      const data = (await res.json()) as SaveResult;
      if (!data.ok || !data.job || !data.script) {
        setError(data.error ?? "保存に失敗しました");
        return;
      }
      onJobChange(data.job);
      onScriptChange(data.script);
      if (advance) onAdvance();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const totalChars = draft
    ? draft.hook.length + draft.narration.length
    : 0;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <header>
        <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>③ Script</h2>
        <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>
          Gemini で {job.topic.mode === "life" ? "「○○の一生」" : "「○○の1日」"}
          フォーマットの台本を生成。フック / ナレーション / 重要語 / 読みを編集できる。
        </p>
      </header>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={handleRun}
          disabled={running || saving || !researchDone}
          style={primaryButtonStyle(running)}
        >
          {running ? "生成中..." : draft ? "再生成" : "台本を生成"}
        </button>
        <span style={{ alignSelf: "center", fontSize: 12, color: "var(--muted)" }}>
          status: <strong>{status}</strong> / {totalChars} 字 / 推定{" "}
          {draft?.estimatedDurationSec.toFixed(1) ?? "?"}秒
        </span>
      </div>

      {!researchDone ? (
        <p style={{ color: "var(--muted)", fontSize: 13 }}>
          Research ステップが完了していません。
        </p>
      ) : !draft ? (
        <p style={{ color: "var(--muted)", fontSize: 13 }}>
          「台本を生成」を押して LLM で台本草案を作成してください。
        </p>
      ) : (
        <>
          <Field label="フック">
            <input
              type="text"
              value={draft.hook}
              onChange={(e) => setDraft({ ...draft, hook: e.target.value })}
              style={inputStyle}
              spellCheck={false}
            />
          </Field>

          <Field label="ナレーション全文">
            <textarea
              value={draft.narration}
              onChange={(e) =>
                setDraft({ ...draft, narration: e.target.value })
              }
              rows={10}
              spellCheck={false}
              style={textareaStyle}
            />
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
              {draft.narration.length} 字
            </div>
          </Field>

          <Field label="重要語 keyTerms（カンマ区切り）">
            <input
              type="text"
              value={draft.keyTerms.join(", ")}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  keyTerms: e.target.value
                    .split(",")
                    .map((t) => t.trim())
                    .filter(Boolean),
                })
              }
              style={inputStyle}
              spellCheck={false}
            />
          </Field>

          <Field label="難読語の読み（term と reading のペア）">
            <ReadingsEditor
              readings={draft.readings}
              onChange={(rs) => setDraft({ ...draft, readings: rs })}
            />
          </Field>
        </>
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
          保存して Scenes へ →
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
    <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
      <span style={{ fontWeight: 600 }}>{label}</span>
      {children}
    </label>
  );
}

function ReadingsEditor({
  readings,
  onChange,
}: {
  readings: ReadingDraft[];
  onChange: (rs: ReadingDraft[]) => void;
}) {
  const update = (i: number, key: "term" | "reading", value: string) => {
    const next = readings.map((r, idx) =>
      idx === i ? { ...r, [key]: value } : r,
    );
    onChange(next);
  };
  const addRow = () => onChange([...readings, { term: "", reading: "" }]);
  const removeRow = (i: number) => onChange(readings.filter((_, idx) => idx !== i));

  return (
    <div style={{ display: "grid", gap: 6 }}>
      {readings.map((r, i) => (
        <div
          key={i}
          style={{ display: "grid", gridTemplateColumns: "1fr 1fr 32px", gap: 6 }}
        >
          <input
            type="text"
            value={r.term}
            placeholder="term (例: 野口英世)"
            onChange={(e) => update(i, "term", e.target.value)}
            style={inputStyle}
          />
          <input
            type="text"
            value={r.reading}
            placeholder="reading (例: のぐちひでよ)"
            onChange={(e) => update(i, "reading", e.target.value)}
            style={inputStyle}
          />
          <button
            type="button"
            onClick={() => removeRow(i)}
            style={{
              border: "1px solid var(--border)",
              borderRadius: 6,
              background: "transparent",
              cursor: "pointer",
            }}
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={addRow}
        style={{
          padding: "6px 12px",
          alignSelf: "start",
          fontSize: 12,
          border: "1px dashed var(--border)",
          borderRadius: 6,
          background: "transparent",
          cursor: "pointer",
        }}
      >
        + 行を追加
      </button>
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
  resize: "vertical",
  fontFamily: "inherit",
  lineHeight: 1.6,
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
