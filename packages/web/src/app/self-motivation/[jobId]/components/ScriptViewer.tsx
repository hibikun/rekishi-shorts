"use client";

import type { SelfMotivationScript } from "@rekishi/shared";

interface Props {
  script: SelfMotivationScript | null;
}

export function ScriptViewer({ script }: Props) {
  if (!script) {
    return (
      <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 12 }}>
        台本がまだ生成されていません。「Script」ボタンを押してください。
      </p>
    );
  }
  return (
    <div style={{ display: "grid", gap: 12, marginTop: 12, fontSize: 13 }}>
      <div>
        <div style={{ fontWeight: 700, marginBottom: 4 }}>タイトル</div>
        <div style={{ color: "var(--muted)" }}>
          {script.openingTitle.top
            ? `${script.openingTitle.top} / `
            : ""}
          <strong style={{ color: "inherit" }}>
            {script.openingTitle.bottom}
          </strong>
        </div>
      </div>
      <div>
        <div style={{ fontWeight: 700, marginBottom: 4 }}>冒頭フック</div>
        <div style={{ color: "var(--muted)", whiteSpace: "pre-wrap" }}>
          {script.openingHook}
        </div>
      </div>
      <div>
        <div style={{ fontWeight: 700, marginBottom: 4 }}>
          章 ({script.chapters.length})
        </div>
        <ol style={{ paddingLeft: 20, margin: 0, display: "grid", gap: 6 }}>
          {script.chapters.map((c, i) => (
            <li key={i}>
              <strong>{c.title}</strong>
              <div
                style={{
                  color: "var(--muted)",
                  fontSize: 12,
                  marginTop: 2,
                }}
              >
                {c.narrationParagraphs.length} 段落 ·{" "}
                {c.narrationParagraphs.reduce((s, p) => s + p.length, 0)} 字
              </div>
            </li>
          ))}
        </ol>
      </div>
      <div>
        <div style={{ fontWeight: 700, marginBottom: 4 }}>CTA</div>
        <div style={{ color: "var(--muted)", whiteSpace: "pre-wrap" }}>
          {script.closingCta}
        </div>
      </div>
      <div style={{ fontSize: 12, color: "var(--muted)" }}>
        推定尺: {script.estimatedDurationSec} 秒 (
        {(script.estimatedDurationSec / 60).toFixed(1)} 分)
      </div>
    </div>
  );
}
