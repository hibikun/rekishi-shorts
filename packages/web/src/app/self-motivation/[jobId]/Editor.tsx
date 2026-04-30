"use client";

import { useCallback, useState } from "react";
import type {
  SelfMotivationJob,
  SelfMotivationScene,
  SelfMotivationScript,
} from "@rekishi/shared";
import { PipelineStrip } from "./components/PipelineStrip";
import { SceneList } from "./components/SceneList";
import { PreviewPane } from "./components/PreviewPane";
import { RenderPanel } from "./components/RenderPanel";
import { ResearchEditor } from "./components/ResearchEditor";
import { ScriptViewer } from "./components/ScriptViewer";
import { CharacterPanel } from "./components/CharacterPanel";

interface Props {
  initialJob: SelfMotivationJob;
  initialResearchMd: string;
  initialScript: SelfMotivationScript | null;
  initialScenes: SelfMotivationScene[];
}

export function Editor({
  initialJob,
  initialResearchMd,
  initialScript,
  initialScenes,
}: Props) {
  const [job, setJob] = useState<SelfMotivationJob>(initialJob);
  const [researchMd, setResearchMd] = useState<string>(initialResearchMd);
  const [script, setScript] = useState<SelfMotivationScript | null>(
    initialScript,
  );
  const [scenes, setScenes] = useState<SelfMotivationScene[]>(initialScenes);
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(
    initialScenes[0]?.sceneId ?? null,
  );

  const updateScene = useCallback(
    async (next: SelfMotivationScene[]) => {
      setScenes(next);
      const res = await fetch(`/api/self-motivation/${job.id}/scenes`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenes: next }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? "シーンの保存に失敗しました");
      }
    },
    [job.id],
  );

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <PipelineStrip
        job={job}
        onJobChange={setJob}
        onResearchMdChange={setResearchMd}
        onScriptChange={setScript}
        onScenesChange={setScenes}
      />

      {/* Research / Script は折りたたみセクション */}
      <details style={sectionDetailsStyle}>
        <summary style={summaryStyle}>📚 リサーチ</summary>
        <ResearchEditor
          jobId={job.id}
          markdown={researchMd}
          onChange={setResearchMd}
          youtubeRefs={job.steps.research.youtubeRefs ?? []}
          onJobChange={setJob}
        />
      </details>

      <details style={sectionDetailsStyle}>
        <summary style={summaryStyle}>📝 台本</summary>
        <ScriptViewer
          jobId={job.id}
          script={script}
          onScriptChange={setScript}
          onJobChange={setJob}
        />
      </details>

      <details style={sectionDetailsStyle}>
        <summary style={summaryStyle}>🧍 キャラクター参照</summary>
        <div style={{ marginTop: 12 }}>
          <CharacterPanel jobId={job.id} />
        </div>
      </details>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(420px, 1fr) minmax(640px, 1.2fr)",
          gap: 16,
          minHeight: 540,
        }}
      >
        <SceneList
          jobId={job.id}
          scenes={scenes}
          selectedSceneId={selectedSceneId}
          onSelectScene={setSelectedSceneId}
          onScenesChange={updateScene}
        />
        <PreviewPane
          jobId={job.id}
          scenes={scenes}
          selectedSceneId={selectedSceneId}
          script={script}
        />
      </div>

      <RenderPanel job={job} onJobChange={setJob} />
    </div>
  );
}

const sectionDetailsStyle: React.CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: "12px 16px",
  background: "var(--card)",
};

const summaryStyle: React.CSSProperties = {
  cursor: "pointer",
  fontWeight: 600,
  fontSize: 14,
  userSelect: "none",
};
