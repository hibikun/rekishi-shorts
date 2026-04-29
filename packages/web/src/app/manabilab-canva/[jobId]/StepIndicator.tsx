"use client";

import { STEP_LABELS, STEP_ORDER, type ManabilabCanvaJob, type StepKey } from "@rekishi/shared";

interface Props {
  job: ManabilabCanvaJob;
  currentStep: StepKey;
  onSelect: (step: StepKey) => void;
}

export function StepIndicator({ job, currentStep, onSelect }: Props) {
  return (
    <ol
      style={{
        listStyle: "none",
        padding: 0,
        margin: 0,
        display: "flex",
        gap: 0,
        alignItems: "center",
        overflowX: "auto",
      }}
    >
      {STEP_ORDER.map((key, i) => {
        const k = key as StepKey;
        const status = job.steps[k].status;
        const active = currentStep === k;
        const color = colorForStatus(status, active);
        return (
          <li
            key={k}
            style={{ display: "flex", alignItems: "center", flex: "0 0 auto" }}
          >
            <button
              type="button"
              onClick={() => onSelect(k)}
              title={`${STEP_LABELS[k]} — ${status}`}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                background: active ? color : "transparent",
                color: active ? "white" : color,
                border: `1.5px solid ${color}`,
                borderRadius: 999,
                padding: "6px 14px",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              <span
                style={{
                  display: "inline-flex",
                  width: 18,
                  height: 18,
                  borderRadius: 999,
                  background: active ? "white" : color,
                  color: active ? color : "white",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 11,
                }}
              >
                {markFor(status, i + 1)}
              </span>
              {STEP_LABELS[k]}
            </button>
            {i < STEP_ORDER.length - 1 ? (
              <span
                style={{
                  width: 24,
                  height: 2,
                  background: "var(--border)",
                  margin: "0 4px",
                  flex: "0 0 auto",
                }}
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function colorForStatus(status: string, active: boolean): string {
  if (status === "done") return "#2e7d32"; // green
  if (status === "in-progress") return "#1976d2"; // blue
  if (status === "error") return "#d32f2f"; // red
  return active ? "#616161" : "#9e9e9e"; // gray
}

function markFor(status: string, ordinal: number): string {
  if (status === "done") return "✓";
  if (status === "in-progress") return "…";
  if (status === "error") return "!";
  return String(ordinal);
}
