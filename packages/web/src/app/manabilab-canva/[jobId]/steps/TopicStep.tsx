"use client";

import { useState } from "react";
import type { ManabilabCanvaJob, Topic } from "@rekishi/shared";

interface Props {
  job: ManabilabCanvaJob;
  onChange: (job: ManabilabCanvaJob) => void;
  onAdvance: () => void;
}

const TARGETS = ["共通テスト", "二次", "汎用"] as const;

export function TopicStep({ job, onChange, onAdvance }: Props) {
  const [topic, setTopic] = useState<Topic>(job.topic);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!topic.title.trim()) {
      setError("タイトルは必須です");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/manabilab-canva/${job.id}/topic`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(topic),
      });
      const data = (await res.json()) as {
        ok: boolean;
        job?: ManabilabCanvaJob;
        error?: string;
      };
      if (!data.ok || !data.job) {
        setError(data.error ?? "保存に失敗しました");
        return;
      }
      onChange(data.job);
      onAdvance();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <header>
        <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>① Topic</h2>
        <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>
          動画のトピック・対象を確定する。後段の Research / Script はここを起点に走る。
        </p>
      </header>

      <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
        <span style={{ fontWeight: 600 }}>タイトル</span>
        <input
          type="text"
          value={topic.title}
          onChange={(e) => setTopic({ ...topic, title: e.target.value })}
          style={inputStyle}
          disabled={saving}
        />
      </label>

      <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
        <span style={{ fontWeight: 600 }}>時代 / 文脈 (任意)</span>
        <input
          type="text"
          value={topic.era ?? ""}
          onChange={(e) => setTopic({ ...topic, era: e.target.value || undefined })}
          placeholder="例: 現代 / 受験生向け"
          style={inputStyle}
          disabled={saving}
        />
      </label>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
          <span style={{ fontWeight: 600 }}>サブジェクト</span>
          <input
            type="text"
            value={topic.subject}
            onChange={(e) => setTopic({ ...topic, subject: e.target.value })}
            style={inputStyle}
            disabled={saving}
          />
        </label>

        <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
          <span style={{ fontWeight: 600 }}>対象</span>
          <select
            value={topic.target}
            onChange={(e) =>
              setTopic({ ...topic, target: e.target.value as Topic["target"] })
            }
            style={inputStyle}
            disabled={saving}
          >
            {TARGETS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error ? (
        <p style={{ color: "#d32f2f", fontSize: 13, margin: 0 }}>{error}</p>
      ) : null}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          style={{
            padding: "10px 20px",
            background: "var(--accent)",
            color: "white",
            border: "none",
            borderRadius: 6,
            fontWeight: 600,
            cursor: saving ? "not-allowed" : "pointer",
            opacity: saving ? 0.6 : 1,
          }}
        >
          {saving ? "保存中..." : "保存して次へ →"}
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
