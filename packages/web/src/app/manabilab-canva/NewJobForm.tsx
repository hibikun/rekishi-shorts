"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const SUBJECT_PRESETS = [
  "学習科学",
  "認知科学",
  "脳科学",
  "心理学",
  "教育",
];

const TARGETS = ["共通テスト", "二次", "汎用"] as const;

export function NewJobForm() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [subject, setSubject] = useState("学習科学");
  const [target, setTarget] = useState<(typeof TARGETS)[number]>("汎用");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError("タイトルを入力してください");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/manabilab-canva/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          subject,
          target,
          format: "single",
        }),
      });
      const data = (await res.json()) as { ok: boolean; jobId?: string; error?: string };
      if (!data.ok || !data.jobId) {
        setError(data.error ?? "作成に失敗しました");
        return;
      }
      router.push(`/manabilab-canva/${data.jobId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: "grid", gap: 12 }}>
      <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
        <span style={{ fontWeight: 600 }}>タイトル</span>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="例: 暗記は寝る前にしろ。理由は脳科学"
          style={inputStyle}
          required
          disabled={submitting}
        />
      </label>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
          <span style={{ fontWeight: 600 }}>サブジェクト</span>
          <input
            list="subject-presets"
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            style={inputStyle}
            disabled={submitting}
          />
          <datalist id="subject-presets">
            {SUBJECT_PRESETS.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </label>

        <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
          <span style={{ fontWeight: 600 }}>対象</span>
          <select
            value={target}
            onChange={(e) => setTarget(e.target.value as (typeof TARGETS)[number])}
            style={inputStyle}
            disabled={submitting}
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

      <button
        type="submit"
        disabled={submitting}
        style={{
          padding: "10px 16px",
          background: "var(--accent)",
          color: "white",
          border: "none",
          borderRadius: 6,
          fontWeight: 600,
          cursor: submitting ? "not-allowed" : "pointer",
          opacity: submitting ? 0.6 : 1,
        }}
      >
        {submitting ? "作成中..." : "ジョブを作成"}
      </button>
    </form>
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
