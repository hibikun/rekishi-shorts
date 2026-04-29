"use client";

import { useState } from "react";
import type { SelfMotivationJob } from "@rekishi/shared";

interface Props {
  jobId: string;
  markdown: string;
  onChange: (md: string) => void;
  onJobChange: (job: SelfMotivationJob) => void;
}

export function ResearchEditor({
  jobId,
  markdown,
  onChange,
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
    <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
      <textarea
        value={markdown}
        onChange={(e) => onChange(e.target.value)}
        placeholder="リサーチ Markdown。空ならパイプラインの Research を実行してください"
        style={{
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
        }}
      />
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          style={{
            padding: "6px 14px",
            background: "var(--accent)",
            color: "white",
            border: "none",
            borderRadius: 6,
            fontSize: 13,
            fontWeight: 600,
            cursor: saving ? "not-allowed" : "pointer",
            opacity: saving ? 0.6 : 1,
          }}
        >
          {saving ? "保存中..." : "保存"}
        </button>
        {error ? (
          <span style={{ color: "#d32f2f", fontSize: 12 }}>{error}</span>
        ) : null}
      </div>
    </div>
  );
}
