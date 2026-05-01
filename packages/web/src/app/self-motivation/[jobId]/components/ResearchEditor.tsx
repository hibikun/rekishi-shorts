"use client";

import { useState } from "react";
import type {
  SelfMotivationJob,
  SelfMotivationYoutubeRef,
} from "@rekishi/shared";

interface Props {
  jobId: string;
  markdown: string;
  onChange: (md: string) => void;
  youtubeRefs: SelfMotivationYoutubeRef[];
  onJobChange: (job: SelfMotivationJob) => void;
}

export function ResearchEditor({
  jobId,
  markdown,
  onChange,
  youtubeRefs,
  onJobChange,
}: Props) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/self-motivation/${jobId}/research`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markdown }),
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
      if (data.job) onJobChange(data.job);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ display: "grid", gap: 16, marginTop: 12 }}>
      <section style={{ display: "grid", gap: 8 }}>
        <h3 style={sectionTitleStyle}>📝 一般リサーチ Markdown</h3>
        <textarea
          value={markdown}
          onChange={(e) => onChange(e.target.value)}
          placeholder="リサーチ Markdown。空ならパイプラインの Research を実行してください"
          style={textareaStyle}
        />
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            style={primaryButtonStyle(saving)}
          >
            {saving ? "保存中..." : "保存"}
          </button>
          {error ? (
            <span style={{ color: "#d32f2f", fontSize: 12 }}>{error}</span>
          ) : null}
        </div>
      </section>

      <YoutubeRefsSection
        jobId={jobId}
        refs={youtubeRefs}
        onJobChange={onJobChange}
      />
    </div>
  );
}

interface YoutubeProps {
  jobId: string;
  refs: SelfMotivationYoutubeRef[];
  onJobChange: (job: SelfMotivationJob) => void;
}

function YoutubeRefsSection({ jobId, refs, onJobChange }: YoutubeProps) {
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const add = async () => {
    setAdding(true);
    setAddError(null);
    try {
      const res = await fetch(
        `/api/self-motivation/${jobId}/research/youtube`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url, note: note || undefined }),
        },
      );
      const data = (await res.json()) as {
        ok: boolean;
        error?: string;
        job?: SelfMotivationJob;
      };
      if (data.job) onJobChange(data.job);
      if (!data.ok) {
        setAddError(data.error ?? "追加に失敗しました");
      } else {
        setUrl("");
        setNote("");
      }
    } catch (e) {
      setAddError(e instanceof Error ? e.message : String(e));
    } finally {
      setAdding(false);
    }
  };

  return (
    <section style={{ display: "grid", gap: 8 }}>
      <h3 style={sectionTitleStyle}>
        🎥 参考 YouTube 動画 ({refs.length})
      </h3>
      <p style={{ fontSize: 12, color: "var(--muted)", margin: 0 }}>
        URL を入れると Gemini が動画を視聴して書き起こし＋構成分析を生成します。書き起こしは台本生成時のコンテキストに自動で含まれます。
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr",
          gap: 6,
          padding: 10,
          border: "1px dashed var(--border)",
          borderRadius: 6,
          background: "var(--card)",
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
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="メモ（参考にしたい理由など、任意）"
          style={inputStyle}
          disabled={adding}
        />
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button
            type="button"
            onClick={add}
            disabled={adding || !url.trim()}
            style={primaryButtonStyle(adding || !url.trim())}
          >
            {adding ? "Gemini が視聴中..." : "追加して書き起こし"}
          </button>
          {addError ? (
            <span style={{ color: "#d32f2f", fontSize: 12 }}>{addError}</span>
          ) : null}
        </div>
      </div>

      {refs.length === 0 ? (
        <p style={{ fontSize: 12, color: "var(--muted)" }}>
          まだ参考動画はありません。
        </p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
          {refs.map((r) => (
            <YoutubeRefRow
              key={r.id}
              jobId={jobId}
              ref_={r}
              onJobChange={onJobChange}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

interface RowProps {
  jobId: string;
  ref_: SelfMotivationYoutubeRef;
  onJobChange: (job: SelfMotivationJob) => void;
}

function YoutubeRefRow({ jobId, ref_, onJobChange }: RowProps) {
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
      try {
        const res = await fetch(
          `/api/self-motivation/${jobId}/research/youtube/${ref_.id}/transcript`,
        );
        const data = (await res.json()) as {
          ok: boolean;
          markdown?: string;
          error?: string;
        };
        if (data.ok) setTranscript(data.markdown ?? "");
        else setActionError(data.error ?? "書き起こしの取得に失敗しました");
      } catch (e) {
        setActionError(e instanceof Error ? e.message : String(e));
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
        `/api/self-motivation/${jobId}/research/youtube/${ref_.id}`,
        { method: "POST" },
      );
      const data = (await res.json()) as {
        ok: boolean;
        error?: string;
        job?: SelfMotivationJob;
      };
      if (data.job) onJobChange(data.job);
      if (!data.ok) setActionError(data.error ?? "再生成に失敗しました");
      else setTranscript(null); // 次回 open で再ロード
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
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
        `/api/self-motivation/${jobId}/research/youtube/${ref_.id}`,
        { method: "DELETE" },
      );
      const data = (await res.json()) as {
        ok: boolean;
        error?: string;
        job?: SelfMotivationJob;
      };
      if (data.job) onJobChange(data.job);
      if (!data.ok) setActionError(data.error ?? "削除に失敗しました");
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(false);
    }
  };

  const statusBadge: Record<typeof ref_.status, { label: string; color: string }> = {
    pending: { label: "待機", color: "#888" },
    running: { label: "視聴中…", color: "#0288d1" },
    done: { label: "完了", color: "#2e7d32" },
    error: { label: "失敗", color: "#d32f2f" },
  };
  const badge = statusBadge[ref_.status];

  return (
    <li
      style={{
        border: "1px solid var(--border)",
        borderRadius: 6,
        background: "var(--card)",
        padding: "10px 12px",
        display: "grid",
        gap: 6,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
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
              📝 {ref_.note}
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
          {open ? "▲ 閉じる" : "▼ 書き起こしを見る"}
        </button>
        <button
          type="button"
          onClick={retry}
          disabled={retrying || ref_.status === "running"}
          style={ghostButtonStyle(retrying || ref_.status === "running")}
        >
          {retrying ? "再生成中…" : ref_.status === "error" ? "🔄 リトライ" : "🔄 再生成"}
        </button>
        <button
          type="button"
          onClick={remove}
          disabled={deleting || ref_.status === "running"}
          style={ghostButtonStyle(deleting || ref_.status === "running", "#d32f2f")}
        >
          {deleting ? "削除中…" : "🗑 削除"}
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
            background: "var(--card-strong, #f6f6f6)",
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
            ? "読込中…"
            : (transcript ?? "(書き起こしファイルが見つかりませんでした)")}
        </div>
      ) : null}
    </li>
  );
}

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 700,
  margin: 0,
};

const textareaStyle: React.CSSProperties = {
  width: "100%",
  minHeight: 240,
  fontFamily: "ui-monospace, monospace",
  fontSize: 12,
  padding: 12,
  border: "1px solid var(--border)",
  borderRadius: 6,
  background: "var(--card)",
  color: "inherit",
  resize: "vertical",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  fontSize: 12,
  padding: "6px 8px",
  border: "1px solid var(--border)",
  borderRadius: 4,
  background: "var(--card)",
  color: "inherit",
};

function primaryButtonStyle(disabled: boolean): React.CSSProperties {
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
