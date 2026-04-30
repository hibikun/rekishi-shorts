"use client";

import { useState } from "react";
import type { UkiyoeJob } from "@rekishi/shared";

interface Props {
  job: UkiyoeJob;
  researchMd: string;
  onJobChange: (job: UkiyoeJob) => void;
  onResearchChange: (md: string) => void;
  onAdvance: () => void;
}

interface RunResult {
  ok: boolean;
  job?: UkiyoeJob;
  markdown?: string;
  sources?: { uri: string; title?: string; domain?: string }[];
  queries?: string[];
  error?: string;
}

interface SaveResult {
  ok: boolean;
  job?: UkiyoeJob;
  error?: string;
}

export function ResearchStep({
  job,
  researchMd,
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

  const handleRun = async () => {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch(`/api/ukiyoe-studio/${job.id}/research/run`, {
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
      const res = await fetch(`/api/ukiyoe-studio/${job.id}/research`, {
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

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={handleRun}
          disabled={running || saving}
          style={primaryButtonStyle(running)}
        >
          {running ? "生成中..." : hasContent ? "再生成" : "リサーチを生成"}
        </button>
        <span style={{ alignSelf: "center", fontSize: 12, color: "var(--muted)" }}>
          status: <strong>{status}</strong>
        </span>
      </div>

      <textarea
        value={md}
        onChange={(e) => setMd(e.target.value)}
        rows={20}
        spellCheck={false}
        placeholder="リサーチを生成すると、ここに Markdown が入ります。手動で編集も可能。"
        style={{
          width: "100%",
          padding: 12,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: 13,
          lineHeight: 1.6,
          border: "1px solid var(--border)",
          borderRadius: 6,
          background: "var(--card)",
          color: "inherit",
          resize: "vertical",
        }}
      />

      <div style={{ fontSize: 12, color: "var(--muted)" }}>
        {md.length} 字
      </div>

      {sources.length > 0 ? (
        <details>
          <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
            参考ソース ({sources.length})
          </summary>
          <ul style={{ fontSize: 12, paddingLeft: 16, marginTop: 8 }}>
            {sources.map((s) => (
              <li key={s.uri}>
                <a href={s.uri} target="_blank" rel="noreferrer">
                  {s.title ?? s.uri}
                </a>{" "}
                {s.domain ? <span style={{ color: "var(--muted)" }}>({s.domain})</span> : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {queries.length > 0 ? (
        <details>
          <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
            検索クエリ ({queries.length})
          </summary>
          <ul style={{ fontSize: 12, paddingLeft: 16, marginTop: 8 }}>
            {queries.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
        </details>
      ) : null}

      {error ? (
        <p style={{ color: "#d32f2f", fontSize: 13, margin: 0 }}>{error}</p>
      ) : null}

      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="button"
          onClick={() => handleSave(false)}
          disabled={saving || running || !hasContent}
          style={secondaryButtonStyle(saving)}
        >
          保存
        </button>
        <button
          type="button"
          onClick={() => handleSave(true)}
          disabled={saving || running || !hasContent}
          style={primaryButtonStyle(saving)}
        >
          保存して Script へ →
        </button>
      </div>
    </div>
  );
}

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
