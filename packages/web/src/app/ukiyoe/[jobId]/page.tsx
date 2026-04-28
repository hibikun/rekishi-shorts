import { loadUkiyoePlan } from "@/lib/ukiyoe-plan";
import { SceneReview } from "./SceneReview";
import path from "node:path";

interface PageProps {
  params: Promise<{ jobId: string }>;
}

export default async function UkiyoePlanPage({ params }: PageProps) {
  const { jobId } = await params;
  const plan = await loadUkiyoePlan(jobId);

  // 画像 / 動画は /api/ukiyoe/<jobId>/assets/<kind>/<file> 経由で配信。
  // ukiyoe-plan.json は absolute path で imagePath/videoPath を持つので
  // basename だけ使う。
  const scenes = plan.scenes.map((s) => ({
    spec: s,
    imageUrl: `/api/ukiyoe/${jobId}/assets/images/${path.basename(s.imagePath)}`,
    videoUrl: `/api/ukiyoe/${jobId}/assets/videos/${path.basename(s.videoPath)}`,
  }));

  return (
    <SceneReview
      jobId={jobId}
      topic={plan.topic}
      hook={plan.hook}
      totalDurationSec={plan.totalDurationSec}
      sceneCount={plan.scenes.length}
      scenes={scenes}
    />
  );
}

export interface UkiyoeSceneWithUrls {
  spec: import("@rekishi/shared").UkiyoeScene;
  imageUrl: string;
  videoUrl: string;
}
