import Link from "next/link";
import { listUkiyoeJobs } from "@/lib/ukiyoe-plan";

export default async function HomePage() {
  const ukiyoeJobs = await listUkiyoeJobs();

  return (
    <main style={{ maxWidth: 720, margin: "60px auto", padding: "0 24px" }}>
      <h1 style={{ fontSize: 28, fontWeight: 800, marginBottom: 24 }}>
        rekishi-shorts レビュー UI
      </h1>
      <p style={{ color: "var(--muted)", marginBottom: 32 }}>
        scene plan の中身を確認して、動画生成を起動するための内部ツール。
      </p>

      <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 12 }}>
        学びラボ × Canva (manabilab-canva)
      </h2>
      <ul style={{ listStyle: "none", padding: 0, marginBottom: 32 }}>
        <li
          style={{
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: "12px 16px",
            background: "var(--card)",
          }}
        >
          <Link
            href="/manabilab-canva"
            style={{
              fontWeight: 600,
              textDecoration: "none",
              color: "var(--accent)",
            }}
          >
            ジョブ一覧 / 新規作成 →
          </Link>
          <div
            style={{
              fontSize: 12,
              color: "var(--muted)",
              marginTop: 4,
            }}
          >
            ステップウィザード: Topic → Research → Script → Scenes → Images → TTS → Export
          </div>
        </li>
      </ul>

      <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 12 }}>
        学びラボ (manabilab)
      </h2>
      <ul style={{ listStyle: "none", padding: 0, marginBottom: 40 }}>
        <li
          style={{
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: "12px 16px",
            background: "var(--card)",
          }}
        >
          <Link
            href="/manabilab/001-note-matome"
            style={{
              fontWeight: 600,
              textDecoration: "none",
              color: "var(--accent)",
            }}
          >
            001 ノートまとめは時間の無駄 →
          </Link>
          <div
            style={{
              fontSize: 12,
              color: "var(--muted)",
              marginTop: 4,
            }}
          >
            10 シーン / 35.06 秒 / VOICEVOX 青山龍星
          </div>
        </li>
      </ul>

      <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 12 }}>
        浮世絵 (ukiyoe) — Seedance V1 Lite
      </h2>
      {ukiyoeJobs.length === 0 ? (
        <p style={{ color: "var(--muted)", fontSize: 13 }}>
          ukiyoe-plan.json を持つジョブがまだありません。
          <code style={{ marginLeft: 6 }}>pnpm ukiyoe-plan</code> で生成してください。
        </p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          {ukiyoeJobs.map((job) => (
            <li
              key={job.jobId}
              style={{
                border: "1px solid var(--border)",
                borderRadius: 8,
                padding: "12px 16px",
                background: "var(--card)",
              }}
            >
              <Link
                href={`/ukiyoe/${job.jobId}`}
                style={{
                  fontWeight: 600,
                  textDecoration: "none",
                  color: "var(--accent)",
                }}
              >
                {job.jobId} →
              </Link>
              <div style={{ fontSize: 13, marginTop: 2 }}>{job.topic}</div>
              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                {job.sceneCount} シーン / {job.totalDurationSec.toFixed(2)} 秒
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
