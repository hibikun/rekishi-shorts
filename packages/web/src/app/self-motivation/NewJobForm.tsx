"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const SUBJECT_PRESETS = [
  "自己啓発",
  "行動科学",
  "脳科学",
  "心理学",
  "キャリア",
  "習慣",
];

export function NewJobForm() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [subject, setSubject] = useState("自己啓発");
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
      const res = await fetch("/api/self-motivation/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          subject,
        }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        jobId?: string;
        error?: string;
      };
      if (!data.ok || !data.jobId) {
        setError(data.error ?? "作成に失敗しました");
        return;
      }
      router.push(`/self-motivation/${data.jobId}`);
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
          placeholder="例: 朝5時起きで人生が変わる脳科学的理由"
          style={inputStyle}
          required
          disabled={submitting}
        />
      </label>

      <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
        <span style={{ fontWeight: 600 }}>カテゴリ</span>
        <input
          list="self-motivation-subject-presets"
          type="text"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          style={inputStyle}
          disabled={submitting}
        />
        <datalist id="self-motivation-subject-presets">
          {SUBJECT_PRESETS.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      </label>

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
