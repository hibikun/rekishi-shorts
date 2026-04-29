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
        <div style={{ display: "grid", gap: 6 }}>
          {script.chapters.map((c, i) => {
            const totalChars = c.narrationParagraphs.reduce(
              (s, p) => s + p.length,
              0,
            );
            return (
              <details
                key={i}
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  background: "var(--card)",
                  padding: "8px 10px",
                }}
              >
                <summary
                  style={{
                    cursor: "pointer",
                    listStyle: "none",
                    display: "flex",
                    alignItems: "baseline",
                    gap: 8,
                    userSelect: "none",
                  }}
                >
                  <span
                    style={{
                      fontSize: 11,
                      fontFamily: "ui-monospace, monospace",
                      color: "var(--muted)",
                      minWidth: 24,
                    }}
                  >
                    #{i + 1}
                  </span>
                  <strong style={{ flex: 1 }}>{c.title}</strong>
                  <span
                    style={{
                      fontSize: 11,
                      color: "var(--muted)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {c.narrationParagraphs.length} 段落 · {totalChars} 字
                  </span>
                </summary>
                <ol
                  style={{
                    margin: "8px 0 0",
                    paddingLeft: 20,
                    display: "grid",
                    gap: 6,
                  }}
                >
                  {c.narrationParagraphs.map((p, pi) => (
                    <li
                      key={pi}
                      style={{
                        fontSize: 12,
                        lineHeight: 1.7,
                        color: "var(--muted)",
                        whiteSpace: "pre-wrap",
                      }}
                    >
                      {p}
                      <span
                        style={{
                          marginLeft: 6,
                          fontSize: 10,
                          color: "var(--muted)",
                          opacity: 0.6,
                        }}
                      >
                        ({p.length} 字)
                      </span>
                    </li>
                  ))}
                </ol>
              </details>
            );
          })}
        </div>
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
