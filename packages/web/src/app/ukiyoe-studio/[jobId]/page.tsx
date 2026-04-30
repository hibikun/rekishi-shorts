import Link from "next/link";
import { notFound } from "next/navigation";
import {
  loadJob,
  readResearchMarkdown,
  readScenePlanJson,
  readScriptJson,
} from "@/lib/ukiyoe-studio-job";
import { Wizard } from "./Wizard";

interface PageProps {
  params: Promise<{ jobId: string }>;
}

export const dynamic = "force-dynamic";

export default async function UkiyoeStudioJobPage({ params }: PageProps) {
  const { jobId: rawJobId } = await params;
  const jobId = decodeURIComponent(rawJobId);

  let job;
  try {
    job = await loadJob(jobId);
  } catch {
    notFound();
  }

  const [researchMd, script, scenePlan] = await Promise.all([
    readResearchMarkdown(jobId),
    readScriptJson(jobId),
    readScenePlanJson(jobId),
  ]);

  return (
    <main style={{ maxWidth: 1280, margin: "40px auto", padding: "0 24px" }}>
      <Link
        href="/ukiyoe-studio"
        style={{ fontSize: 13, color: "var(--muted)", textDecoration: "none" }}
      >
        ← 一覧へ戻る
      </Link>
      <h1 style={{ fontSize: 24, fontWeight: 800, margin: "12px 0 4px" }}>
        {job.topic.title}
      </h1>
      <div
        style={{
          fontSize: 12,
          color: "var(--muted)",
          marginBottom: 24,
        }}
      >
        {job.id} ・ mode: <strong>{job.topic.mode}</strong> ・ scenes:{" "}
        {job.topic.sceneCount} ・ {job.topic.sceneCount * 5}秒
      </div>

      <Wizard
        initialJob={job}
        initialResearchMd={researchMd}
        initialScript={script}
        initialScenePlan={scenePlan}
      />
    </main>
  );
}
