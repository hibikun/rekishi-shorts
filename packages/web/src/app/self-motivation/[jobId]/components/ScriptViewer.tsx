"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  SelfMotivationChapter,
  SelfMotivationJob,
  SelfMotivationScript,
} from "@rekishi/shared";

interface Props {
  jobId: string;
  script: SelfMotivationScript | null;
  onScriptChange: (script: SelfMotivationScript) => void;
  onJobChange: (job: SelfMotivationJob) => void;
}

export function ScriptViewer({
  jobId,
  script,
  onScriptChange,
  onJobChange,
}: Props) {
  // 親 (Editor) の script が外側から再取得された場合に追随するため、ローカル草案を持つ。
  const [draft, setDraft] = useState<SelfMotivationScript | null>(script);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  useEffect(() => {
    setDraft(script);
    setSavedAt(null);
  }, [script]);

  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(script),
    [draft, script],
  );

  if (!draft) {
    return (
      <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 12 }}>
        台本がまだ生成されていません。「Script」ボタンを押してください。
      </p>
    );
  }

  const update = (patch: Partial<SelfMotivationScript>) => {
    setDraft({ ...draft, ...patch });
  };

  const updateChapter = (
    index: number,
    patch: Partial<SelfMotivationChapter>,
  ) => {
    setDraft({
      ...draft,
      chapters: draft.chapters.map((c, i) =>
        i === index ? { ...c, ...patch } : c,
      ),
    });
  };

  const updateParagraph = (
    chapterIndex: number,
    paragraphIndex: number,
    value: string,
  ) => {
    const chapter = draft.chapters[chapterIndex];
    if (!chapter) return;
    const nextParas = chapter.narrationParagraphs.map((p, i) =>
      i === paragraphIndex ? value : p,
    );
    updateChapter(chapterIndex, { narrationParagraphs: nextParas });
  };

  const addParagraph = (chapterIndex: number) => {
    const chapter = draft.chapters[chapterIndex];
    if (!chapter) return;
    updateChapter(chapterIndex, {
      narrationParagraphs: [...chapter.narrationParagraphs, ""],
    });
  };

  const deleteParagraph = (chapterIndex: number, paragraphIndex: number) => {
    const chapter = draft.chapters[chapterIndex];
    if (!chapter) return;
    if (chapter.narrationParagraphs.length <= 1) return;
    updateChapter(chapterIndex, {
      narrationParagraphs: chapter.narrationParagraphs.filter(
        (_, i) => i !== paragraphIndex,
      ),
    });
  };

  const addChapter = () => {
    setDraft({
      ...draft,
      chapters: [
        ...draft.chapters,
        { title: "新しい章", narrationParagraphs: [""] },
      ],
    });
  };

  const deleteChapter = (index: number) => {
    if (draft.chapters.length <= 1) return;
    if (!confirm(`章「${draft.chapters[index]?.title}」を削除しますか?`)) return;
    setDraft({
      ...draft,
      chapters: draft.chapters.filter((_, i) => i !== index),
    });
  };

  const moveChapter = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= draft.chapters.length) return;
    const next = [...draft.chapters];
    const a = next[index];
    const b = next[target];
    if (!a || !b) return;
    next[index] = b;
    next[target] = a;
    setDraft({ ...draft, chapters: next });
  };

  const cancel = () => {
    setDraft(script);
    setError(null);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/self-motivation/${jobId}/script`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const data = (await res.json()) as {
        ok: boolean;
        error?: string;
        job?: SelfMotivationJob;
      };
      if (!data.ok) {
        setError(data.error ?? "保存に失敗しました");
        return;
      }
      onScriptChange(draft);
      if (data.job) onJobChange(data.job);
      setSavedAt(new Date().toLocaleTimeString("ja-JP"));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const totalChars = draft.chapters.reduce(
    (s, c) => s + c.narrationParagraphs.reduce((a, p) => a + p.length, 0),
    0,
  );

  return (
    <div style={{ display: "grid", gap: 12, marginTop: 12, fontSize: 13 }}>
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 1,
          display: "flex",
          gap: 8,
          alignItems: "center",
          padding: "6px 8px",
          background: "var(--card)",
          border: "1px solid var(--border)",
          borderRadius: 6,
        }}
      >
        <button
          type="button"
          onClick={save}
          disabled={!dirty || saving}
          style={primaryButtonStyle(!dirty || saving)}
        >
          {saving ? "保存中…" : "💾 保存"}
        </button>
        <button
          type="button"
          onClick={cancel}
          disabled={!dirty || saving}
          style={ghostButtonStyle(!dirty || saving)}
        >
          ↺ 取消
        </button>
        <span style={{ fontSize: 12, color: "var(--muted)", marginLeft: 4 }}>
          {dirty ? "未保存の変更あり" : savedAt ? `${savedAt} 保存済` : "保存済"}
        </span>
        <span
          style={{
            marginLeft: "auto",
            fontSize: 11,
            color: "var(--muted)",
          }}
        >
          全 {draft.chapters.length} 章 / {totalChars} 字 · 推定{" "}
          {(draft.estimatedDurationSec / 60).toFixed(1)} 分
        </span>
        {error ? (
          <span style={{ color: "#d32f2f", fontSize: 12 }}>{error}</span>
        ) : null}
      </div>

      <FieldRow label="タイトル上段">
        <input
          type="text"
          value={draft.openingTitle.top ?? ""}
          onChange={(e) =>
            update({
              openingTitle: { ...draft.openingTitle, top: e.target.value },
            })
          }
          style={inputStyle}
        />
      </FieldRow>
      <FieldRow label="タイトル下段">
        <input
          type="text"
          value={draft.openingTitle.bottom ?? ""}
          onChange={(e) =>
            update({
              openingTitle: { ...draft.openingTitle, bottom: e.target.value },
            })
          }
          style={inputStyle}
        />
      </FieldRow>

      <FieldRow label="冒頭フック">
        <textarea
          value={draft.openingHook}
          onChange={(e) => update({ openingHook: e.target.value })}
          rows={3}
          style={textareaStyle}
        />
      </FieldRow>

      <div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 6,
          }}
        >
          <strong>章 ({draft.chapters.length})</strong>
          <button type="button" onClick={addChapter} style={smallButtonStyle()}>
            + 章を追加
          </button>
        </div>
        <div style={{ display: "grid", gap: 8 }}>
          {draft.chapters.map((c, i) => {
            const totalChapterChars = c.narrationParagraphs.reduce(
              (s, p) => s + p.length,
              0,
            );
            return (
              <details
                key={i}
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  background: "var(--card)",
                  padding: "8px 10px",
                }}
              >
                <summary
                  style={{
                    cursor: "pointer",
                    listStyle: "none",
                    display: "flex",
                    alignItems: "baseline",
                    gap: 8,
                    userSelect: "none",
                  }}
                >
                  <span
                    style={{
                      fontSize: 11,
                      fontFamily: "ui-monospace, monospace",
                      color: "var(--muted)",
                      minWidth: 24,
                    }}
                  >
                    #{i + 1}
                  </span>
                  <strong style={{ flex: 1 }}>{c.title}</strong>
                  <span
                    style={{
                      fontSize: 11,
                      color: "var(--muted)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {c.narrationParagraphs.length} 段落 · {totalChapterChars}{" "}
                    字
                  </span>
                </summary>
                <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                  <input
                    type="text"
                    value={c.title}
                    onChange={(e) =>
                      updateChapter(i, { title: e.target.value })
                    }
                    placeholder="章タイトル"
                    style={inputStyle}
                  />
                  <ol
                    style={{
                      margin: 0,
                      paddingLeft: 20,
                      display: "grid",
                      gap: 6,
                    }}
                  >
                    {c.narrationParagraphs.map((p, pi) => (
                      <li key={pi} style={{ display: "grid", gap: 2 }}>
                        <textarea
                          value={p}
                          onChange={(e) =>
                            updateParagraph(i, pi, e.target.value)
                          }
                          rows={2}
                          style={textareaStyle}
                        />
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            fontSize: 10,
                            color: "var(--muted)",
                          }}
                        >
                          <span>{p.length} 字</span>
                          <button
                            type="button"
                            onClick={() => deleteParagraph(i, pi)}
                            disabled={c.narrationParagraphs.length <= 1}
                            style={tinyDangerButtonStyle(
                              c.narrationParagraphs.length <= 1,
                            )}
                          >
                            段落を削除
                          </button>
                        </div>
                      </li>
                    ))}
                  </ol>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <button
                      type="button"
                      onClick={() => addParagraph(i)}
                      style={smallButtonStyle()}
                    >
                      + 段落を追加
                    </button>
                    <button
                      type="button"
                      onClick={() => moveChapter(i, -1)}
                      disabled={i === 0}
                      style={smallButtonStyle(i === 0)}
                    >
                      ↑ 上へ
                    </button>
                    <button
                      type="button"
                      onClick={() => moveChapter(i, 1)}
                      disabled={i === draft.chapters.length - 1}
                      style={smallButtonStyle(i === draft.chapters.length - 1)}
                    >
                      ↓ 下へ
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteChapter(i)}
                      disabled={draft.chapters.length <= 1}
                      style={smallDangerButtonStyle(
                        draft.chapters.length <= 1,
                      )}
                    >
                      🗑 章を削除
                    </button>
                  </div>
                </div>
              </details>
            );
          })}
        </div>
      </div>

      <FieldRow label="CTA">
        <textarea
          value={draft.closingCta}
          onChange={(e) => update({ closingCta: e.target.value })}
          rows={3}
          style={textareaStyle}
        />
      </FieldRow>

      <p
        style={{
          fontSize: 11,
          color: "var(--muted)",
          margin: 0,
          lineHeight: 1.6,
        }}
      >
        ⚠ シーン展開後に章タイトルや段落を変えると、既存 scenes.json と整合しなくなります。必要に応じて「シーンを再展開」してください。
      </p>
    </div>
  );
}

function FieldRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: "grid", gap: 4 }}>
      <span style={{ fontWeight: 700 }}>{label}</span>
      {children}
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "6px 8px",
  border: "1px solid var(--border)",
  borderRadius: 4,
  background: "var(--card)",
  color: "inherit",
  fontSize: 13,
  fontFamily: "inherit",
};

const textareaStyle: React.CSSProperties = {
  ...inputStyle,
  fontFamily: "inherit",
  lineHeight: 1.7,
  resize: "vertical",
};

function primaryButtonStyle(disabled: boolean): React.CSSProperties {
  return {
    padding: "6px 12px",
    background: "var(--accent)",
    color: "white",
    border: "none",
    borderRadius: 6,
    fontSize: 12,
    fontWeight: 600,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
  };
}

function ghostButtonStyle(disabled: boolean): React.CSSProperties {
  return {
    padding: "6px 12px",
    background: "transparent",
    color: "var(--muted)",
    border: "1px solid var(--border)",
    borderRadius: 6,
    fontSize: 12,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
  };
}

function smallButtonStyle(disabled = false): React.CSSProperties {
  return {
    padding: "3px 8px",
    background: "transparent",
    color: "var(--accent)",
    border: "1px solid var(--accent)",
    borderRadius: 4,
    fontSize: 11,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
  };
}

function smallDangerButtonStyle(disabled: boolean): React.CSSProperties {
  return { ...smallButtonStyle(disabled), color: "#d32f2f", borderColor: "#d32f2f" };
}

function tinyDangerButtonStyle(disabled: boolean): React.CSSProperties {
  return {
    padding: "1px 6px",
    background: "transparent",
    color: "#d32f2f",
    border: "1px solid #d32f2f",
    borderRadius: 3,
    fontSize: 10,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.4 : 1,
  };
}
