import Link from "next/link";
import { listJobs } from "@/lib/canva-job";
import { STEP_LABELS, STEP_ORDER, type StepKey } from "@rekishi/shared";
import { NewJobForm } from "./NewJobForm";

export const dynamic = "force-dynamic";

export default async function ManabilabCanvaListPage() {
  const jobs = await listJobs();

  return (
    <main style={{ maxWidth: 880, margin: "60px auto", padding: "0 24px" }}>
      <Link
        href="/"
        style={{ fontSize: 13, color: "var(--muted)", textDecoration: "none" }}
      >
        ← トップに戻る
      </Link>
      <h1 style={{ fontSize: 28, fontWeight: 800, margin: "12px 0 8px" }}>
        manabilab × Canva
      </h1>
      <p style={{ color: "var(--muted)", marginBottom: 32, fontSize: 14 }}>
        トピック → リサーチ → 台本 → シーン割 → 画像 → TTS まで AI と一緒に作り、
        最終アニメーション/SE は Canva で人間が組み立てるためのウィザード。
      </p>

      <section
        style={{
          border: "1px solid var(--border)",
          borderRadius: 8,
          padding: 20,
          background: "var(--card)",
          marginBottom: 32,
        }}
      >
        <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>
          新しいジョブを作成
        </h2>
        <NewJobForm />
      </section>

      <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>
        既存ジョブ ({jobs.length})
      </h2>
      {jobs.length === 0 ? (
        <p style={{ color: "var(--muted)", fontSize: 13 }}>
          まだジョブがありません。上のフォームから作成してください。
        </p>
      ) : (
        <ul
          style={{
            listStyle: "none",
            padding: 0,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          {jobs.map((job) => {
            const doneCount = STEP_ORDER.filter(
              (k) => job.steps[k as StepKey].status === "done",
            ).length;
            return (
              <li
                key={job.id}
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  padding: "12px 16px",
                  background: "var(--card)",
                }}
              >
                <Link
                  href={`/manabilab-canva/${job.id}`}
                  style={{
                    fontWeight: 600,
                    textDecoration: "none",
                    color: "var(--accent)",
                  }}
                >
                  {job.topic.title} →
                </Link>
                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
                  {job.id}
                </div>
                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
                  進捗: {doneCount} / {STEP_ORDER.length}{" "}
                  ステップ完了 ({STEP_ORDER.map((k) => {
                    const status = job.steps[k as StepKey].status;
                    const mark =
                      status === "done"
                        ? "✓"
                        : status === "in-progress"
                        ? "…"
                        : status === "error"
                        ? "✕"
                        : "・";
                    return `${mark}${STEP_LABELS[k as StepKey]}`;
                  }).join(" / ")})
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
