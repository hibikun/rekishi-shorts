import Link from "next/link";
import { setChannel } from "@rekishi/shared/channel";
import {
  SELF_MOTIVATION_CHANNEL,
  listJobs,
} from "@rekishi/pipeline/self-motivation";
import {
  SELF_MOTIVATION_STEP_LABELS,
  SELF_MOTIVATION_STEP_ORDER,
  type SelfMotivationStepKey,
} from "@rekishi/shared";
import { NewJobForm } from "./NewJobForm";

export const dynamic = "force-dynamic";

setChannel(SELF_MOTIVATION_CHANNEL);

export default async function SelfMotivationListPage() {
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
        Self-Motivation 長尺動画
      </h1>
      <p style={{ color: "var(--muted)", marginBottom: 32, fontSize: 14 }}>
        トピック → リサーチ → 章立て台本 → シーン展開 → 画像 → TTS → レンダリング
        まで一本道。シーン単位で Remotion アニメを差し替えられるエディタ付き。
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
            const doneCount = SELF_MOTIVATION_STEP_ORDER.filter(
              (k) =>
                job.steps[k as SelfMotivationStepKey].status === "done",
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
                  href={`/self-motivation/${job.id}`}
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
                  進捗: {doneCount} / {SELF_MOTIVATION_STEP_ORDER.length}{" "}
                  ステップ完了 (
                  {SELF_MOTIVATION_STEP_ORDER.map((k) => {
                    const status =
                      job.steps[k as SelfMotivationStepKey].status;
                    const mark =
                      status === "done"
                        ? "✓"
                        : status === "in-progress"
                          ? "…"
                          : status === "error"
                            ? "✕"
                            : "・";
                    return `${mark}${SELF_MOTIVATION_STEP_LABELS[k as SelfMotivationStepKey]}`;
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
