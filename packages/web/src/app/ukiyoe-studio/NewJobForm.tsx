"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Mode = "life" | "routine";

export function NewJobForm() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [person, setPerson] = useState("");
  const [era, setEra] = useState("");
  const [mode, setMode] = useState<Mode>("life");
  const [sceneCount, setSceneCount] = useState(8);
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
      const res = await fetch("/api/ukiyoe-studio/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          person: person.trim() || null,
          era: era.trim() || null,
          mode,
          sceneCount,
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
      router.push(`/ukiyoe-studio/${data.jobId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: "grid", gap: 12 }}>
      <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
        <span style={{ fontWeight: 600 }}>タイトル *</span>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="例: 野口英世の一生"
          style={inputStyle}
          required
          disabled={submitting}
        />
      </label>

      <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
        <span style={{ fontWeight: 600 }}>人物名（任意・jobId に使用）</span>
        <input
          type="text"
          value={person}
          onChange={(e) => setPerson(e.target.value)}
          placeholder="例: noguchi-hideyo"
          style={inputStyle}
          disabled={submitting}
        />
      </label>

      <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
        <span style={{ fontWeight: 600 }}>時代（任意）</span>
        <input
          type="text"
          value={era}
          onChange={(e) => setEra(e.target.value)}
          placeholder="例: 明治〜大正"
          style={inputStyle}
          disabled={submitting}
        />
      </label>

      <fieldset
        style={{
          border: "1px solid var(--border)",
          borderRadius: 6,
          padding: "8px 12px",
          margin: 0,
          fontSize: 13,
        }}
      >
        <legend style={{ fontWeight: 600, padding: "0 4px" }}>軸モード</legend>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, marginRight: 16 }}>
          <input
            type="radio"
            name="mode"
            value="life"
            checked={mode === "life"}
            onChange={() => setMode("life")}
            disabled={submitting}
          />
          一生（年齢軸 / 「○○の一生」）
        </label>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <input
            type="radio"
            name="mode"
            value="routine"
            checked={mode === "routine"}
            onChange={() => setMode("routine")}
            disabled={submitting}
          />
          1日（時刻軸 / 「○○の1日」）
        </label>
      </fieldset>

      <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
        <span style={{ fontWeight: 600 }}>シーン数（5秒×N）</span>
        <input
          type="number"
          min={2}
          max={12}
          value={sceneCount}
          onChange={(e) => setSceneCount(Number.parseInt(e.target.value, 10) || 8)}
          style={inputStyle}
          disabled={submitting}
        />
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
