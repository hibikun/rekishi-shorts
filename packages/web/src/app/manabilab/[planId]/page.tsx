import { loadPlan, imagePathToUrl, type SceneSpec } from "@/lib/plan";
import { ScenePlanReview } from "./ScenePlanReview";

interface PageProps {
  params: Promise<{ planId: string }>;
}

export default async function ManabilabPlanPage({ params }: PageProps) {
  const { planId } = await params;
  const plan = await loadPlan("manabilab", planId);

  // image scenes の imagePath を public URL に変換した形でクライアントに渡す
  const scenesWithUrls: SceneWithUrl[] = plan.scenes.map((s) => ({
    spec: s,
    imageUrl: s.kind === "image" ? imagePathToUrl("manabilab", s.imagePath) : null,
  }));

  return (
    <ScenePlanReview
      planId={planId}
      title={plan.title}
      totalDurationSec={plan.totalDurationSec}
      audio={plan.audio}
      scenes={scenesWithUrls}
    />
  );
}

export interface SceneWithUrl {
  spec: SceneSpec;
  imageUrl: string | null;
}
