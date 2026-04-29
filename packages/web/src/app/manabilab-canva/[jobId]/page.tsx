import Link from "next/link";
import { notFound } from "next/navigation";
import { loadJob, readResearchMarkdown, readScriptJson } from "@/lib/canva-job";
import { CanvaWizard } from "./CanvaWizard";

interface PageProps {
  params: Promise<{ jobId: string }>;
}

export const dynamic = "force-dynamic";

export default async function CanvaJobPage({ params }: PageProps) {
  const { jobId: rawJobId } = await params;
  const jobId = decodeURIComponent(rawJobId);

  let job;
  try {
    job = await loadJob(jobId);
  } catch {
    notFound();
  }

  const [researchMd, script] = await Promise.all([
    readResearchMarkdown(jobId),
    readScriptJson(jobId),
  ]);

  return (
    <main style={{ maxWidth: 960, margin: "40px auto", padding: "0 24px" }}>
      <Link
        href="/manabilab-canva"
        style={{ fontSize: 13, color: "var(--muted)", textDecoration: "none" }}
      >
        ← ジョブ一覧
      </Link>
      <h1 style={{ fontSize: 24, fontWeight: 800, margin: "12px 0 4px" }}>
        {job.topic.title}
      </h1>
      <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 24 }}>
        {job.id} · 作成 {new Date(job.createdAt).toLocaleString("ja-JP")}
      </div>

      <CanvaWizard
        initialJob={job}
        initialResearchMd={researchMd}
        initialScript={script}
      />
    </main>
  );
}
