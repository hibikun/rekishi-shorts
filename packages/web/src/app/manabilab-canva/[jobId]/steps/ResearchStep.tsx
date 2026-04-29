"use client";

import { useMemo, useState } from "react";
import type { ManabilabCanvaJob, ResearchSource, Topic } from "@rekishi/shared";

interface Props {
  job: ManabilabCanvaJob;
  researchMd: string;
  promptTemplate: string;
  onJobChange: (job: ManabilabCanvaJob) => void;
  onResearchChange: (md: string) => void;
  onAdvance: () => void;
}

function renderPromptPreview(template: string, topic: Topic): string {
  return template
    .replace(/\{\{topic\.title\}\}/g, topic.title)
    .replace(/\{\{topic\.era\}\}/g, topic.era ?? "指定なし")
    .replace(/\{\{topic\.subject\}\}/g, topic.subject)
    .replace(/\{\{topic\.target\}\}/g, topic.target);
}

interface RunResult {
  ok: boolean;
  job?: ManabilabCanvaJob;
  markdown?: string;
  sources?: ResearchSource[];
  queries?: string[];
  error?: string;
}

interface SaveResult {
  ok: boolean;
  job?: ManabilabCanvaJob;
  error?: string;
}

export function ResearchStep({
  job,
  researchMd,
  promptTemplate,
  onJobChange,
  onResearchChange,
  onAdvance,
}: Props) {
  const [md, setMd] = useState(researchMd);
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sources = job.steps.research.sources ?? [];
  const queries = job.steps.research.queries ?? [];
  const status = job.steps.research.status;
  const promptPreview = useMemo(
    () => renderPromptPreview(promptTemplate, job.topic),
    [promptTemplate, job.topic],
  );

  const handleRun = async () => {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch(`/api/manabilab-canva/${job.id}/research/run`, {
        method: "POST",
      });
      const data = (await res.json()) as RunResult;
      if (!data.ok || !data.job || data.markdown === undefined) {
        setError(data.error ?? "リサーチ生成に失敗しました");
        return;
      }
      onJobChange(data.job);
      setMd(data.markdown);
      onResearchChange(data.markdown);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  };

  const handleSave = async (advance: boolean) => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/manabilab-canva/${job.id}/research`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markdown: md }),
      });
      const data = (await res.json()) as SaveResult;
      if (!data.ok || !data.job) {
        setError(data.error ?? "保存に失敗しました");
        return;
      }
      onJobChange(data.job);
      onResearchChange(md);
      if (advance) onAdvance();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const hasContent = md.trim().length > 0;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <header>
        <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>② Research</h2>
        <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>
          Gemini + Google Search でトピックの素材を収集する。生成後はマークダウンを直接編集して整える。
        </p>
      </header>

      <details
        open={!hasContent}
        style={{
          border: "1px solid var(--border)",
          borderRadius: 6,
          padding: "8px 12px",
          background: "var(--card)",
        }}
      >
        <summary
          style={{
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
            color: "var(--accent)",
          }}
        >
          ▼ Gemini に送るプロンプトを確認 ({promptPreview.length.toLocaleString()} 字)
        </summary>
        <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>
          下記が <code>generateResearch</code> 経由で Gemini に投げられる最終プロンプトです。
          Topic を変更すると即座に反映されます。プロンプト本体を編集したい場合は{" "}
          <code>packages/channels/manabilab-canva/prompts/research.md</code> を直接編集してください。
        </p>
        <pre
          style={{
            fontSize: 11,
            lineHeight: 1.5,
            background: "rgba(0,0,0,0.04)",
            padding: 12,
            borderRadius: 4,
            maxHeight: 360,
            overflow: "auto",
            whiteSpace: "pre-wrap",
            margin: "8px 0 0 0",
          }}
        >
          {promptPreview}
        </pre>
      </details>

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button
          type="button"
          onClick={handleRun}
          disabled={running || saving}
          style={primaryButtonStyle(running)}
        >
          {running ? "リサーチ中..." : hasContent ? "リサーチを再生成" : "AIでリサーチを生成"}
        </button>
        {status === "done" && !running ? (
          <span style={{ fontSize: 12, color: "#2e7d32" }}>✓ 保存済み</span>
        ) : null}
      </div>

      {error ? (
        <p style={{ color: "#d32f2f", fontSize: 13, margin: 0 }}>{error}</p>
      ) : null}

      <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
        <span style={{ fontWeight: 600 }}>リサーチ Markdown</span>
        <textarea
          value={md}
          onChange={(e) => setMd(e.target.value)}
          rows={20}
          placeholder="まだリサーチが生成されていません。「AIでリサーチを生成」を押してください。"
          disabled={running || saving}
          style={{
            ...inputStyle,
            fontFamily: "ui-monospace, SFMono-Regular, monospace",
            fontSize: 13,
            lineHeight: 1.5,
            minHeight: 360,
            resize: "vertical",
          }}
        />
      </label>

      {sources.length > 0 ? (
        <details>
          <summary style={{ fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
            出典 ({sources.length})
          </summary>
          <ul style={{ fontSize: 12, color: "var(--muted)", margin: "8px 0 0 0", paddingLeft: 20 }}>
            {sources.map((s, i) => (
              <li key={i}>
                <a href={s.uri} target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>
                  {s.title ?? s.domain ?? s.uri}
                </a>
                {s.domain ? <span style={{ color: "var(--muted)" }}> — {s.domain}</span> : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {queries.length > 0 ? (
        <details>
          <summary style={{ fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
            検索クエリ ({queries.length})
          </summary>
          <ul style={{ fontSize: 12, color: "var(--muted)", margin: "8px 0 0 0", paddingLeft: 20 }}>
            {queries.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
        </details>
      ) : null}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <button
          type="button"
          onClick={() => handleSave(false)}
          disabled={saving || running || !hasContent}
          style={secondaryButtonStyle(saving)}
        >
          {saving ? "保存中..." : "下書き保存"}
        </button>
        <button
          type="button"
          onClick={() => handleSave(true)}
          disabled={saving || running || !hasContent}
          style={primaryButtonStyle(saving)}
        >
          保存して次へ →
        </button>
      </div>
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
