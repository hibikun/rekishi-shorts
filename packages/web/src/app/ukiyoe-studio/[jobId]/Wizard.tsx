"use client";

import { useState } from "react";
import {
  UKIYOE_STEP_ORDER,
  type UkiyoeJob,
  type UkiyoeScenePlan,
  type UkiyoeScript,
  type UkiyoeStepKey,
} from "@rekishi/shared";
import { StepIndicator } from "./StepIndicator";
import { TopicStep } from "./steps/TopicStep";
import { ResearchStep } from "./steps/ResearchStep";
import { ScriptStep } from "./steps/ScriptStep";
import { ScenesStep } from "./steps/ScenesStep";
import { ImagesStep } from "./steps/ImagesStep";
import { TTSStep } from "./steps/TTSStep";
import { VideosStep } from "./steps/VideosStep";
import { RenderStep } from "./steps/RenderStep";
import { ShipStep } from "./steps/ShipStep";

interface Props {
  initialJob: UkiyoeJob;
  initialResearchMd: string;
  initialScript: UkiyoeScript | null;
  initialScenePlan: UkiyoeScenePlan | null;
}

function firstIncomplete(job: UkiyoeJob): UkiyoeStepKey {
  for (const key of UKIYOE_STEP_ORDER) {
    if (job.steps[key as UkiyoeStepKey].status !== "done")
      return key as UkiyoeStepKey;
  }
  return "ship";
}

export function Wizard({
  initialJob,
  initialResearchMd,
  initialScript,
  initialScenePlan,
}: Props) {
  const [job, setJob] = useState(initialJob);
  const [currentStep, setCurrentStep] = useState<UkiyoeStepKey>(
    firstIncomplete(initialJob),
  );
  const [researchMd, setResearchMd] = useState(initialResearchMd);
  const [script, setScript] = useState<UkiyoeScript | null>(initialScript);
  const [scenePlan, setScenePlan] = useState<UkiyoeScenePlan | null>(
    initialScenePlan,
  );

  const advance = (next: UkiyoeStepKey) => setCurrentStep(next);

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
        {currentStep === "scenes" && (
          <ScenesStep
            job={job}
            scenePlan={scenePlan}
            onJobChange={setJob}
            onScenePlanChange={setScenePlan}
            onAdvance={() => advance("images")}
          />
        )}
        {currentStep === "images" && (
          <ImagesStep
            job={job}
            scenePlan={scenePlan}
            onJobChange={setJob}
            onAdvance={() => advance("tts")}
          />
        )}
        {currentStep === "tts" && (
          <TTSStep
            job={job}
            onJobChange={setJob}
            onAdvance={() => advance("videos")}
          />
        )}
        {currentStep === "videos" && (
          <VideosStep
            job={job}
            scenePlan={scenePlan}
            onJobChange={setJob}
            onAdvance={() => advance("render")}
          />
        )}
        {currentStep === "render" && (
          <RenderStep
            job={job}
            onJobChange={setJob}
            onAdvance={() => advance("ship")}
          />
        )}
        {currentStep === "ship" && <ShipStep job={job} onJobChange={setJob} />}
      </section>
    </div>
  );
}
