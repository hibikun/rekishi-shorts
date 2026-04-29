"use client";

import { useEffect, useState } from "react";
import type {
  CanvaStatement,
  ManabilabCanvaJob,
  ManabilabCanvaScript,
} from "@rekishi/shared";

interface Props {
  job: ManabilabCanvaJob;
  script: ManabilabCanvaScript | null;
  onJobChange: (job: ManabilabCanvaJob) => void;
  onScriptChange: (script: ManabilabCanvaScript) => void;
  onAdvance: () => void;
}

interface RunResult {
  ok: boolean;
  job?: ManabilabCanvaJob;
  script?: ManabilabCanvaScript;
  error?: string;
}

interface SaveResult {
  ok: boolean;
  job?: ManabilabCanvaJob;
  error?: string;
}

interface DraftFields {
  hook: string;
  statements: CanvaStatement[];
  cta: string;
  punchline: string;
  titleTop: string;
  titleBottom: string;
  estimatedDurationSec: number;
}

function scriptToDraft(s: ManabilabCanvaScript): DraftFields {
  return {
    hook: s.hook,
    statements: s.statements.map((st) => ({ ...st })),
    cta: s.cta,
    punchline: s.punchline,
    titleTop: s.title.top,
    titleBottom: s.title.bottom,
    estimatedDurationSec: s.estimatedDurationSec,
  };
}

function draftToScript(
  prev: ManabilabCanvaScript,
  draft: DraftFields,
): ManabilabCanvaScript {
  return {
    ...prev,
    hook: draft.hook,
    statements: draft.statements,
    cta: draft.cta,
    punchline: draft.punchline,
    title: { top: draft.titleTop, bottom: draft.titleBottom },
    estimatedDurationSec: draft.estimatedDurationSec,
  };
}

function totalChars(d: DraftFields): number {
  const segs = d.statements
    .map((s) => `${s.claim}${s.backupLogic}`)
    .join("");
  return d.hook.length + segs.length + d.cta.length + d.punchline.length;
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
      const next = draftToScript(script, draft);
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

  const updateStatement = (idx: number, patch: Partial<CanvaStatement>) => {
    if (!draft) return;
    setDraft({
      ...draft,
      statements: draft.statements.map((s, i) => (i === idx ? { ...s, ...patch } : s)),
    });
  };

  const moveStatement = (idx: number, dir: -1 | 1) => {
    if (!draft) return;
    const next = idx + dir;
    if (next < 0 || next >= draft.statements.length) return;
    const arr = [...draft.statements];
    [arr[idx], arr[next]] = [arr[next], arr[idx]];
    setDraft({ ...draft, statements: arr });
  };

  const removeStatement = (idx: number) => {
    if (!draft) return;
    if (draft.statements.length <= 2) {
      setError("statements は最低 2 つ必要です");
      return;
    }
    setDraft({
      ...draft,
      statements: draft.statements.filter((_, i) => i !== idx),
    });
  };

  const addStatement = () => {
    if (!draft) return;
    if (draft.statements.length >= 7) {
      setError("statements は最大 7 つです");
      return;
    }
    setDraft({
      ...draft,
      statements: [
        ...draft.statements,
        { label: "", claim: "", backupLogic: "" },
      ],
    });
  };

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <header>
        <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>③ Script</h2>
        <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>
          リサーチを元に台本を生成。 <code>hook</code> →{" "}
          <code>statements[]</code> → <code>cta</code> → <code>punchline</code>{" "}
          の構成。各セグメントが後段の Scenes ステップで 1 シーンに対応する想定。
        </p>
      </header>

      {!researchDone ? (
        <p style={{ color: "#d32f2f", fontSize: 13 }}>
          先に Research ステップを完了してください。
        </p>
      ) : null}

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
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
            推定 {draft.estimatedDurationSec.toFixed(1)} 秒 / 全体{" "}
            {totalChars(draft)} 字 / segments {draft.statements.length}
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
              <span style={fieldHeaderStyle}>タイトル上段（top）</span>
              <input
                type="text"
                value={draft.titleTop}
                maxLength={20}
                onChange={(e) => setDraft({ ...draft, titleTop: e.target.value })}
                style={inputStyle}
                disabled={saving || running}
              />
            </label>
            <label style={fieldLabelStyle}>
              <span style={fieldHeaderStyle}>タイトル下段（bottom）</span>
              <input
                type="text"
                value={draft.titleBottom}
                maxLength={20}
                onChange={(e) => setDraft({ ...draft, titleBottom: e.target.value })}
                style={inputStyle}
                disabled={saving || running}
              />
            </label>
          </div>

          <label style={fieldLabelStyle}>
            <span style={fieldHeaderStyle}>
              hook <span style={hintStyle}>1〜2文 / 20-50字 / ツッコミ余地のある軽さ</span>
            </span>
            <textarea
              value={draft.hook}
              onChange={(e) => setDraft({ ...draft, hook: e.target.value })}
              rows={2}
              style={textareaStyle}
              disabled={saving || running}
            />
          </label>

          <div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 8,
              }}
            >
              <h3 style={{ fontSize: 14, fontWeight: 700, margin: 0 }}>
                statements ({draft.statements.length})
              </h3>
              <button
                type="button"
                onClick={addStatement}
                disabled={saving || running || draft.statements.length >= 7}
                style={smallButtonStyle}
              >
                + 追加
              </button>
            </div>

            <div style={{ display: "grid", gap: 12 }}>
              {draft.statements.map((s, i) => (
                <div
                  key={i}
                  style={{
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    padding: 12,
                    background: "rgba(0,0,0,0.02)",
                    display: "grid",
                    gap: 8,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      justifyContent: "space-between",
                    }}
                  >
                    <span style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)" }}>
                      #{i + 1}
                    </span>
                    <div style={{ display: "flex", gap: 4 }}>
                      <button
                        type="button"
                        onClick={() => moveStatement(i, -1)}
                        disabled={saving || running || i === 0}
                        style={tinyButtonStyle}
                        title="上へ"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        onClick={() => moveStatement(i, 1)}
                        disabled={saving || running || i === draft.statements.length - 1}
                        style={tinyButtonStyle}
                        title="下へ"
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        onClick={() => removeStatement(i)}
                        disabled={saving || running || draft.statements.length <= 2}
                        style={{ ...tinyButtonStyle, color: "#d32f2f" }}
                        title="削除"
                      >
                        ✕
                      </button>
                    </div>
                  </div>

                  <label style={fieldLabelStyle}>
                    <span style={fieldHeaderStyle}>
                      label <span style={hintStyle}>シーン上に大きく出すラベル / 5-18字</span>
                    </span>
                    <input
                      type="text"
                      value={s.label}
                      onChange={(e) => updateStatement(i, { label: e.target.value })}
                      style={inputStyle}
                      disabled={saving || running}
                    />
                  </label>

                  <label style={fieldLabelStyle}>
                    <span style={fieldHeaderStyle}>
                      claim <span style={hintStyle}>主張本体 1〜2文 / 30-60字</span>
                    </span>
                    <textarea
                      value={s.claim}
                      onChange={(e) => updateStatement(i, { claim: e.target.value })}
                      rows={2}
                      style={textareaStyle}
                      disabled={saving || running}
                    />
                  </label>

                  <label style={fieldLabelStyle}>
                    <span style={fieldHeaderStyle}>
                      backupLogic{" "}
                      <span style={hintStyle}>裏付け / メカニズム + 数字 + 出典 / 60-120字</span>
                    </span>
                    <textarea
                      value={s.backupLogic}
                      onChange={(e) => updateStatement(i, { backupLogic: e.target.value })}
                      rows={3}
                      style={textareaStyle}
                      disabled={saving || running}
                    />
                  </label>
                </div>
              ))}
            </div>
          </div>

          <label style={fieldLabelStyle}>
            <span style={fieldHeaderStyle}>
              cta <span style={hintStyle}>行動を促す 1 文 / 15-35字 / 小さな一歩</span>
            </span>
            <textarea
              value={draft.cta}
              onChange={(e) => setDraft({ ...draft, cta: e.target.value })}
              rows={2}
              style={textareaStyle}
              disabled={saving || running}
            />
          </label>

          <label style={fieldLabelStyle}>
            <span style={fieldHeaderStyle}>
              punchline{" "}
              <span style={hintStyle}>
                ツッコミどころ満載で締める 1 文 / 10-30字 / 期間×情景の決め台詞は禁止
              </span>
            </span>
            <textarea
              value={draft.punchline}
              onChange={(e) => setDraft({ ...draft, punchline: e.target.value })}
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
                setDraft({
                  ...draft,
                  estimatedDurationSec: Number(e.target.value) || 0,
                })
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
        <p
          style={{
            color: "var(--muted)",
            fontSize: 13,
            padding: "32px 0",
            textAlign: "center",
          }}
        >
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

const hintStyle: React.CSSProperties = {
  fontWeight: 400,
  color: "var(--muted)",
  fontSize: 11,
  marginLeft: 4,
};

const smallButtonStyle: React.CSSProperties = {
  padding: "4px 10px",
  border: "1px solid var(--accent)",
  background: "transparent",
  color: "var(--accent)",
  borderRadius: 4,
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
};

const tinyButtonStyle: React.CSSProperties = {
  padding: "2px 8px",
  border: "1px solid var(--border)",
  background: "var(--card)",
  color: "inherit",
  borderRadius: 4,
  fontSize: 12,
  cursor: "pointer",
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
