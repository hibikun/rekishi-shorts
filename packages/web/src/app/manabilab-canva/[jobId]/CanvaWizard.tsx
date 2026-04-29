"use client";

import { useState } from "react";
import {
  STEP_ORDER,
  type ManabilabCanvaJob,
  type ManabilabCanvaScript,
  type StepKey,
} from "@rekishi/shared";
import { StepIndicator } from "./StepIndicator";
import { TopicStep } from "./steps/TopicStep";
import { ResearchStep } from "./steps/ResearchStep";
import { ScriptStep } from "./steps/ScriptStep";

interface Props {
  initialJob: ManabilabCanvaJob;
  initialResearchMd: string;
  initialScript: ManabilabCanvaScript | null;
  researchPromptTemplate: string;
}

function firstIncomplete(job: ManabilabCanvaJob): StepKey {
  for (const key of STEP_ORDER) {
    if (job.steps[key as StepKey].status !== "done") return key as StepKey;
  }
  return "export";
}

export function CanvaWizard({
  initialJob,
  initialResearchMd,
  initialScript,
  researchPromptTemplate,
}: Props) {
  const [job, setJob] = useState(initialJob);
  const [currentStep, setCurrentStep] = useState<StepKey>(firstIncomplete(initialJob));
  const [researchMd, setResearchMd] = useState(initialResearchMd);
  const [script, setScript] = useState<ManabilabCanvaScript | null>(initialScript);

  const advance = (next: StepKey) => setCurrentStep(next);

  return (
    <div style={{ display: "grid", gap: 24 }}>
      <StepIndicator job={job} currentStep={currentStep} onSelect={setCurrentStep} />

      <section
        style={{
          border: "1px solid var(--border)",
          borderRadius: 8,
          padding: 24,
          background: "var(--card)",
        }}
      >
        {currentStep === "topic" && (
          <TopicStep
            job={job}
            onChange={setJob}
            onAdvance={() => advance("research")}
          />
        )}
        {currentStep === "research" && (
          <ResearchStep
            job={job}
            researchMd={researchMd}
            promptTemplate={researchPromptTemplate}
            onJobChange={setJob}
            onResearchChange={setResearchMd}
            onAdvance={() => advance("script")}
          />
        )}
        {currentStep === "script" && (
          <ScriptStep
            job={job}
            script={script}
            onJobChange={setJob}
            onScriptChange={setScript}
            onAdvance={() => advance("scenes")}
          />
        )}
        {currentStep === "scenes" && <UpcomingPlaceholder label="Scenes" />}
        {currentStep === "images" && <UpcomingPlaceholder label="Images" />}
        {currentStep === "tts" && <UpcomingPlaceholder label="TTS" />}
        {currentStep === "export" && <UpcomingPlaceholder label="Export" />}
      </section>
    </div>
  );
}

function UpcomingPlaceholder({ label }: { label: string }) {
  return (
    <div style={{ textAlign: "center", padding: 32, color: "var(--muted)" }}>
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>{label} ステップ</div>
      <p style={{ fontSize: 13 }}>このステップは Phase 2 以降で実装予定です。</p>
    </div>
  );
}
