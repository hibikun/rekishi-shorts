import Link from "next/link";
import { notFound } from "next/navigation";
import { setChannel } from "@rekishi/shared/channel";
import {
  SELF_MOTIVATION_CHANNEL,
  loadJob,
  readResearchMarkdown,
  readScenesJson,
  readScriptJson,
} from "@rekishi/pipeline/self-motivation";
import { Editor } from "./Editor";

export const dynamic = "force-dynamic";

setChannel(SELF_MOTIVATION_CHANNEL);

interface PageProps {
  params: Promise<{ jobId: string }>;
}

export default async function SelfMotivationJobPage({ params }: PageProps) {
  const { jobId: rawJobId } = await params;
  const jobId = decodeURIComponent(rawJobId);

  let job;
  try {
    job = await loadJob(jobId);
  } catch {
    notFound();
  }

  const [researchMd, script, scenes] = await Promise.all([
    readResearchMarkdown(jobId),
    readScriptJson(jobId),
    readScenesJson(jobId),
  ]);

  return (
    <main style={{ padding: "24px 32px", minHeight: "100vh" }}>
      <Link
        href="/self-motivation"
        style={{ fontSize: 13, color: "var(--muted)", textDecoration: "none" }}
      >
        ← ジョブ一覧
      </Link>
      <h1 style={{ fontSize: 22, fontWeight: 800, margin: "8px 0 4px" }}>
        {job.topic.title}
      </h1>
      <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 16 }}>
        {job.id} · 作成 {new Date(job.createdAt).toLocaleString("ja-JP")}
      </div>

      <Editor
        initialJob={job}
        initialResearchMd={researchMd}
        initialScript={script}
        initialScenes={scenes ?? []}
      />
    </main>
  );
}
