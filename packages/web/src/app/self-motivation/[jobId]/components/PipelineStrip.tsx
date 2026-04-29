"use client";

import { useState } from "react";
import {
  SELF_MOTIVATION_STEP_LABELS,
  SELF_MOTIVATION_STEP_ORDER,
  type SelfMotivationJob,
  type SelfMotivationScene,
  type SelfMotivationScript,
  type SelfMotivationStepKey,
} from "@rekishi/shared";

interface Props {
  job: SelfMotivationJob;
  onJobChange: (job: SelfMotivationJob) => void;
  onResearchMdChange: (md: string) => void;
  onScriptChange: (script: SelfMotivationScript | null) => void;
  onScenesChange: (scenes: SelfMotivationScene[]) => void;
}

type ActionStatus = "idle" | "running" | "error";

export function PipelineStrip({
  job,
  onJobChange,
  onResearchMdChange,
  onScriptChange,
  onScenesChange,
}: Props) {
  const [running, setRunning] = useState<SelfMotivationStepKey | null>(null);
  const [error, setError] = useState<string | null>(null);

  const trigger = async (
    step: SelfMotivationStepKey,
    apiPath: string,
    handle?: (data: Record<string, unknown>) => void,
  ) => {
    setRunning(step);
    setError(null);
    try {
      const res = await fetch(`/api/self-motivation/${job.id}${apiPath}`, {
        method: "POST",
      });
      const data = (await res.json()) as Record<string, unknown> & {
        ok: boolean;
        error?: string;
        job?: SelfMotivationJob;
      };
      if (!data.ok) {
        setError(data.error ?? `${step} 実行に失敗しました`);
        return;
      }
      if (data.job) onJobChange(data.job);
      handle?.(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(null);
    }
  };

  const onResearch = () =>
    trigger("research", "/research/run", (d) => {
      const md = (d as { markdown?: string }).markdown;
      if (typeof md === "string") onResearchMdChange(md);
    });

  const onScript = () =>
    trigger("script", "/script/run", (d) => {
      const script = (d as { script?: SelfMotivationScript }).script;
      if (script) onScriptChange(script);
    });

  const onExpand = () =>
    trigger("scenes", "/scenes/expand", (d) => {
      const scenes = (d as { scenes?: SelfMotivationScene[] }).scenes;
      if (scenes) onScenesChange(scenes);
    });

  const onImages = () =>
    trigger("images", "/images/generate-all", (d) => {
      const scenes = (d as { scenes?: SelfMotivationScene[] }).scenes;
      if (scenes) onScenesChange(scenes);
    });

  const onTtsAll = async () => {
    setRunning("tts");
    setError(null);
    try {
      // generate-all → concat
      const res1 = await fetch(
        `/api/self-motivation/${job.id}/tts/generate-all`,
        { method: "POST" },
      );
      const data1 = (await res1.json()) as {
        ok: boolean;
        error?: string;
        job?: SelfMotivationJob;
        scenes?: SelfMotivationScene[];
      };
      if (!data1.ok) {
        setError(data1.error ?? "TTS 生成に失敗しました");
        return;
      }
      if (data1.job) onJobChange(data1.job);
      if (data1.scenes) onScenesChange(data1.scenes);

      const res2 = await fetch(`/api/self-motivation/${job.id}/tts/concat`, {
        method: "POST",
      });
      const data2 = (await res2.json()) as {
        ok: boolean;
        error?: string;
        job?: SelfMotivationJob;
      };
      if (!data2.ok) {
        setError(data2.error ?? "TTS 結合に失敗しました");
        return;
      }
      if (data2.job) onJobChange(data2.job);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(null);
    }
  };

  const handlers: Record<SelfMotivationStepKey, (() => void) | null> = {
    topic: null,
    research: onResearch,
    script: onScript,
    scenes: onExpand,
    images: onImages,
    tts: onTtsAll,
    render: null, // RenderPanel から起動
  };

  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: "12px 16px",
        background: "var(--card)",
        display: "grid",
        gap: 12,
      }}
    >
      <div
        style={{
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        {SELF_MOTIVATION_STEP_ORDER.map((step) => {
          const stepKey = step as SelfMotivationStepKey;
          const status = job.steps[stepKey].status;
          const isRunning = running === stepKey;
          const handler = handlers[stepKey];
          return (
            <button
              key={stepKey}
              type="button"
              disabled={!handler || isRunning || running !== null}
              onClick={() => handler?.()}
              style={{
                ...stepBtnStyle,
                background: bgFor(status, isRunning),
                color: "white",
                borderColor: borderFor(status),
                cursor: handler ? "pointer" : "default",
                opacity: handler && running === null ? 1 : 0.7,
              }}
              title={`${SELF_MOTIVATION_STEP_LABELS[stepKey]} (${status})`}
            >
              <span style={{ marginRight: 6 }}>{iconFor(status, isRunning)}</span>
              {SELF_MOTIVATION_STEP_LABELS[stepKey]}
            </button>
          );
        })}
      </div>
      {error ? (
        <div style={{ fontSize: 12, color: "#d32f2f" }}>⚠ {error}</div>
      ) : null}
    </div>
  );
}

const stepBtnStyle: React.CSSProperties = {
  padding: "8px 14px",
  borderRadius: 6,
  border: "1px solid",
  fontSize: 13,
  fontWeight: 600,
};

function bgFor(status: string, isRunning: boolean): string {
  if (isRunning) return "#1976d2";
  switch (status) {
    case "done":
      return "#2e7d32";
    case "in-progress":
      return "#ed6c02";
    case "error":
      return "#c62828";
    default:
      return "#616161";
  }
}

function borderFor(status: string): string {
  switch (status) {
    case "done":
      return "#1b5e20";
    case "error":
      return "#8b0000";
    default:
      return "transparent";
  }
}

function iconFor(status: string, isRunning: boolean): string {
  if (isRunning) return "⏳";
  switch (status) {
    case "done":
      return "✓";
    case "in-progress":
      return "…";
    case "error":
      return "✕";
    default:
      return "·";
  }
}
