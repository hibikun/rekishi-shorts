import Link from "next/link";
import {
  UKIYOE_STEP_LABELS,
  UKIYOE_STEP_ORDER,
  type UkiyoeStepKey,
} from "@rekishi/shared";
import { listJobs } from "@/lib/ukiyoe-studio-job";
import { NewJobForm } from "./NewJobForm";

export const dynamic = "force-dynamic";

export default async function UkiyoeStudioListPage() {
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
        浮世絵スタジオ (ukiyoe-studio)
      </h1>
      <p style={{ color: "var(--muted)", marginBottom: 32, fontSize: 14 }}>
        Topic → Research → Script → Scenes → Images → TTS → Videos → Render → Ship
        まで Web UI で完結する浮世絵タッチ動画ウィザード。
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
            const doneCount = UKIYOE_STEP_ORDER.filter(
              (k) => job.steps[k as UkiyoeStepKey].status === "done",
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
                  href={`/ukiyoe-studio/${job.id}`}
                  style={{
                    fontWeight: 600,
                    textDecoration: "none",
                    color: "var(--accent)",
                  }}
                >
                  {job.topic.title} →
                </Link>
                <div
                  style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}
                >
                  {job.id}
                </div>
                <div
                  style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}
                >
                  mode: <strong>{job.topic.mode}</strong> / scenes:{" "}
                  {job.topic.sceneCount} / 進捗: {doneCount} /{" "}
                  {UKIYOE_STEP_ORDER.length} (
                  {UKIYOE_STEP_ORDER.map((k) => {
                    const status =
                      job.steps[k as UkiyoeStepKey].status;
                    const mark =
                      status === "done"
                        ? "✓"
                        : status === "in-progress"
                          ? "…"
                          : status === "error"
                            ? "✕"
                            : "・";
                    return `${mark}${UKIYOE_STEP_LABELS[k as UkiyoeStepKey]}`;
                  }).join(" / ")}
                  )
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
