"use client";

import { useState } from "react";
import type { UkiyoeJob, UkiyoeYoutubeRef } from "@rekishi/shared";

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

interface YoutubeMutationResult {
  ok: boolean;
  job?: UkiyoeJob;
  ref?: UkiyoeYoutubeRef;
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
  const youtubeRefs = job.steps.research.youtubeRefs ?? [];
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

      <YoutubeReferenceSection
        jobId={job.id}
        refs={youtubeRefs}
        onJobChange={onJobChange}
      />

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

interface YoutubeReferenceSectionProps {
  jobId: string;
  refs: UkiyoeYoutubeRef[];
  onJobChange: (job: UkiyoeJob) => void;
}

function YoutubeReferenceSection({
  jobId,
  refs,
  onJobChange,
}: YoutubeReferenceSectionProps) {
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const add = async () => {
    setAdding(true);
    setAddError(null);
    try {
      const res = await fetch(`/api/ukiyoe-studio/${jobId}/research/youtube`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, title, note }),
      });
      const data = (await res.json()) as YoutubeMutationResult;
      if (data.job) onJobChange(data.job);
      if (!data.ok) {
        setAddError(data.error ?? "参考動画の追加に失敗しました");
        return;
      }
      setUrl("");
      setTitle("");
      setNote("");
    } catch (err) {
      setAddError(err instanceof Error ? err.message : String(err));
    } finally {
      setAdding(false);
    }
  };

  return (
    <section style={{ display: "grid", gap: 8 }}>
      <h3 style={{ fontSize: 14, fontWeight: 700, margin: 0 }}>
        参考 YouTube 動画 ({refs.length})
      </h3>
      <p style={{ fontSize: 12, color: "var(--muted)", margin: 0 }}>
        URL を入れると Gemini が動画を視聴し、書き起こしと構成分析を生成する。完了した分析は Script 生成時のコンテキストに含まれる。
      </p>

      <div
        style={{
          display: "grid",
          gap: 6,
          padding: 10,
          border: "1px dashed var(--border)",
          borderRadius: 6,
        }}
      >
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://www.youtube.com/watch?v=..."
          style={inputStyle}
          disabled={adding}
        />
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="タイトルメモ（任意）"
          style={inputStyle}
          disabled={adding}
        />
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="参考にしたい理由（任意）"
          style={inputStyle}
          disabled={adding}
        />
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button
            type="button"
            onClick={add}
            disabled={adding || !url.trim()}
            style={smallPrimaryButtonStyle(adding || !url.trim())}
          >
            {adding ? "Gemini が視聴中..." : "追加して書き起こし"}
          </button>
          {addError ? (
            <span style={{ color: "#d32f2f", fontSize: 12 }}>{addError}</span>
          ) : null}
        </div>
      </div>

      {refs.length === 0 ? (
        <p style={{ fontSize: 12, color: "var(--muted)", margin: 0 }}>
          まだ参考動画はありません。
        </p>
      ) : (
        <ul
          style={{
            listStyle: "none",
            padding: 0,
            margin: 0,
            display: "grid",
            gap: 8,
          }}
        >
          {refs.map((ref) => (
            <YoutubeReferenceRow
              key={ref.id}
              jobId={jobId}
              ref_={ref}
              onJobChange={onJobChange}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

interface YoutubeReferenceRowProps {
  jobId: string;
  ref_: UkiyoeYoutubeRef;
  onJobChange: (job: UkiyoeJob) => void;
}

function YoutubeReferenceRow({
  jobId,
  ref_,
  onJobChange,
}: YoutubeReferenceRowProps) {
  const [open, setOpen] = useState(false);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [loadingTranscript, setLoadingTranscript] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const toggleOpen = async () => {
    const next = !open;
    setOpen(next);
    if (next && transcript === null && ref_.status === "done") {
      setLoadingTranscript(true);
      setActionError(null);
      try {
        const res = await fetch(
          `/api/ukiyoe-studio/${jobId}/research/youtube/${ref_.id}/transcript`,
        );
        const data = (await res.json()) as {
          ok: boolean;
          markdown?: string;
          error?: string;
        };
        if (data.ok) setTranscript(data.markdown ?? "");
        else setActionError(data.error ?? "書き起こしの取得に失敗しました");
      } catch (err) {
        setActionError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoadingTranscript(false);
      }
    }
  };

  const retry = async () => {
    setRetrying(true);
    setActionError(null);
    try {
      const res = await fetch(
        `/api/ukiyoe-studio/${jobId}/research/youtube/${ref_.id}`,
        { method: "POST" },
      );
      const data = (await res.json()) as YoutubeMutationResult;
      if (data.job) onJobChange(data.job);
      if (!data.ok) setActionError(data.error ?? "再生成に失敗しました");
      else setTranscript(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setRetrying(false);
    }
  };

  const remove = async () => {
    if (!confirm(`「${ref_.title || ref_.url}」を削除しますか？`)) return;
    setDeleting(true);
    setActionError(null);
    try {
      const res = await fetch(
        `/api/ukiyoe-studio/${jobId}/research/youtube/${ref_.id}`,
        { method: "DELETE" },
      );
      const data = (await res.json()) as YoutubeMutationResult;
      if (data.job) onJobChange(data.job);
      if (!data.ok) setActionError(data.error ?? "削除に失敗しました");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeleting(false);
    }
  };

  const statusBadge: Record<
    UkiyoeYoutubeRef["status"],
    { label: string; color: string }
  > = {
    pending: { label: "待機", color: "#777" },
    running: { label: "視聴中", color: "#0277bd" },
    done: { label: "完了", color: "#2e7d32" },
    error: { label: "失敗", color: "#d32f2f" },
  };
  const badge = statusBadge[ref_.status];

  return (
    <li
      style={{
        border: "1px solid var(--border)",
        borderRadius: 6,
        padding: "10px 12px",
        display: "grid",
        gap: 6,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 8,
          alignItems: "flex-start",
        }}
      >
        <div style={{ display: "grid", gap: 2, minWidth: 0, flex: 1 }}>
          <a
            href={ref_.url}
            target="_blank"
            rel="noreferrer noopener"
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "var(--accent)",
              textDecoration: "none",
              wordBreak: "break-all",
            }}
          >
            {ref_.title || ref_.url}
          </a>
          {ref_.note ? (
            <span style={{ fontSize: 11, color: "var(--muted)" }}>
              {ref_.note}
            </span>
          ) : null}
          <span style={{ fontSize: 11, color: "var(--muted)" }}>
            videoId: {ref_.videoId}
            {ref_.model ? ` / ${ref_.model}` : ""}
            {ref_.outputTokens ? ` / out ${ref_.outputTokens} tok` : ""}
          </span>
        </div>
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: badge.color,
            border: `1px solid ${badge.color}`,
            padding: "2px 8px",
            borderRadius: 999,
            whiteSpace: "nowrap",
          }}
        >
          {badge.label}
        </span>
      </div>

      {ref_.error ? (
        <pre
          style={{
            fontSize: 11,
            color: "#d32f2f",
            margin: 0,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {ref_.error}
        </pre>
      ) : null}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={toggleOpen}
          disabled={ref_.status !== "done"}
          style={ghostButtonStyle(ref_.status !== "done")}
        >
          {open ? "閉じる" : "書き起こしを見る"}
        </button>
        <button
          type="button"
          onClick={retry}
          disabled={retrying || ref_.status === "running"}
          style={ghostButtonStyle(retrying || ref_.status === "running")}
        >
          {retrying ? "再生成中..." : "再生成"}
        </button>
        <button
          type="button"
          onClick={remove}
          disabled={deleting || ref_.status === "running"}
          style={ghostButtonStyle(deleting || ref_.status === "running", "#d32f2f")}
        >
          {deleting ? "削除中..." : "削除"}
        </button>
        {actionError ? (
          <span style={{ color: "#d32f2f", fontSize: 11 }}>{actionError}</span>
        ) : null}
      </div>

      {open && ref_.status === "done" ? (
        <div
          style={{
            marginTop: 6,
            padding: 10,
            background: "var(--background)",
            border: "1px solid var(--border)",
            borderRadius: 4,
            maxHeight: 320,
            overflow: "auto",
            fontSize: 11,
            fontFamily: "ui-monospace, monospace",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {loadingTranscript
            ? "読込中..."
            : (transcript ?? "(書き起こしファイルが見つかりませんでした)")}
        </div>
      ) : null}
    </li>
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

const inputStyle: React.CSSProperties = {
  width: "100%",
  fontSize: 12,
  padding: "6px 8px",
  border: "1px solid var(--border)",
  borderRadius: 4,
  background: "var(--card)",
  color: "inherit",
};

function smallPrimaryButtonStyle(disabled: boolean): React.CSSProperties {
  return {
    padding: "6px 14px",
    background: "var(--accent)",
    color: "white",
    border: "none",
    borderRadius: 6,
    fontSize: 13,
    fontWeight: 600,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.6 : 1,
  };
}

function ghostButtonStyle(
  disabled: boolean,
  color: string = "var(--accent)",
): React.CSSProperties {
  return {
    padding: "4px 10px",
    background: "transparent",
    color,
    border: `1px solid ${color}`,
    borderRadius: 6,
    fontSize: 12,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
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
