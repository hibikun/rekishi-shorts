"use client";

import { useState } from "react";
import type { UkiyoeJob, UkiyoeScenePlan } from "@rekishi/shared";

interface Props {
  job: UkiyoeJob;
  scenePlan: UkiyoeScenePlan | null;
  onJobChange: (job: UkiyoeJob) => void;
  onAdvance: () => void;
}

interface RunResult {
  ok: boolean;
  job?: UkiyoeJob;
  results?: { index: number; imagePath: string; skipped: boolean; retried: boolean }[];
  logs?: string[];
  error?: string;
}

function sceneToken(i: number): string {
  return i.toString().padStart(2, "0");
}

export function ImagesStep({ job, scenePlan, onJobChange, onAdvance }: Props) {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<RunResult["results"]>([]);
  const [busy, setBusy] = useState<number | null>(null);

  const status = job.steps.images.status;
  const generated = job.steps.images.generatedScenes ?? [];
  const allDone =
    !!scenePlan && scenePlan.scenes.every((s) => generated.includes(s.index));

  const runAll = async (force = false) => {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch(`/api/ukiyoe-studio/${job.id}/images/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force }),
      });
      const data = (await res.json()) as RunResult;
      if (!data.ok || !data.job) {
        setError(data.error ?? "画像生成に失敗しました");
        return;
      }
      onJobChange(data.job);
      setResults(data.results ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  };

  const regenOne = async (index: number) => {
    setBusy(index);
    setError(null);
    try {
      const res = await fetch(`/api/ukiyoe-studio/${job.id}/images/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sceneIndices: [index], force: true }),
      });
      const data = (await res.json()) as RunResult;
      if (!data.ok || !data.job) {
        setError(data.error ?? "個別生成に失敗しました");
        return;
      }
      onJobChange(data.job);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <header>
        <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>⑤ Images</h2>
        <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>
          各シーンの imagePrompt を fal.ai で生成。並列度3、既存ファイルは skip。
        </p>
      </header>

      {!scenePlan ? (
        <p style={{ color: "var(--muted)", fontSize: 13 }}>
          Scenes ステップが完了していません。
        </p>
      ) : (
        <>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => runAll(false)}
              disabled={running}
              style={primary(running)}
            >
              {running ? "生成中..." : "全シーン生成（既存 skip）"}
            </button>
            <button
              type="button"
              onClick={() => runAll(true)}
              disabled={running}
              style={secondary(running)}
            >
              全シーン強制再生成
            </button>
            <span style={{ alignSelf: "center", fontSize: 12, color: "var(--muted)" }}>
              status: <strong>{status}</strong> / {generated.length} /{" "}
              {scenePlan.scenes.length} 完了
            </span>
          </div>

          <ul
            style={{
              listStyle: "none",
              padding: 0,
              margin: 0,
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
              gap: 12,
            }}
          >
            {scenePlan.scenes.map((s) => {
              const done = generated.includes(s.index);
              const url = `/api/ukiyoe/${job.id}/assets/images/scene-${sceneToken(s.index)}.png`;
              return (
                <li
                  key={s.index}
                  style={{
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    padding: 8,
                    background: "var(--card)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      fontSize: 12,
                      marginBottom: 6,
                    }}
                  >
                    <strong>scene[{s.index}]</strong>
                    <span style={{ color: done ? "#2e7d32" : "var(--muted)" }}>
                      {done ? "✓" : "未"}
                    </span>
                  </div>
                  {done ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={url}
                      alt={`scene-${s.index}`}
                      style={{
                        width: "100%",
                        aspectRatio: "9/16",
                        objectFit: "cover",
                        borderRadius: 4,
                        background: "#222",
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        width: "100%",
                        aspectRatio: "9/16",
                        borderRadius: 4,
                        background: "var(--bg)",
                        display: "grid",
                        placeItems: "center",
                        color: "var(--muted)",
                        fontSize: 11,
                      }}
                    >
                      未生成
                    </div>
                  )}
                  <div
                    style={{
                      fontSize: 10,
                      color: "var(--muted)",
                      marginTop: 4,
                      lineHeight: 1.3,
                    }}
                  >
                    {s.narration}
                  </div>
                  <button
                    type="button"
                    onClick={() => regenOne(s.index)}
                    disabled={busy !== null}
                    style={{
                      marginTop: 6,
                      width: "100%",
                      padding: "4px 8px",
                      fontSize: 11,
                      border: "1px solid var(--border)",
                      borderRadius: 4,
                      background: "transparent",
                      cursor: busy === s.index ? "not-allowed" : "pointer",
                    }}
                  >
                    {busy === s.index ? "..." : "再生成"}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {error ? (
        <p style={{ color: "#d32f2f", fontSize: 13, margin: 0 }}>{error}</p>
      ) : null}

      {results && results.length > 0 ? (
        <details style={{ fontSize: 12 }}>
          <summary style={{ cursor: "pointer" }}>直近の結果 ({results.length})</summary>
          <pre
            style={{
              background: "var(--card)",
              padding: 8,
              borderRadius: 4,
              overflowX: "auto",
              fontSize: 11,
            }}
          >
            {JSON.stringify(results, null, 2)}
          </pre>
        </details>
      ) : null}

      <div>
        <button
          type="button"
          onClick={onAdvance}
          disabled={!allDone}
          style={primary(false)}
          title={!allDone ? "全シーンの画像が必要です" : undefined}
        >
          TTS へ進む →
        </button>
      </div>
    </div>
  );
}

function primary(loading: boolean): React.CSSProperties {
  return {
    padding: "10px 18px",
    background: "var(--accent)",
    color: "white",
    border: "none",
    borderRadius: 6,
    fontWeight: 600,
    cursor: loading ? "not-allowed" : "pointer",
    opacity: loading ? 0.6 : 1,
  };
}

function secondary(loading: boolean): React.CSSProperties {
  return {
    padding: "10px 18px",
    background: "transparent",
    color: "var(--accent)",
    border: "1px solid var(--accent)",
    borderRadius: 6,
    fontWeight: 600,
    cursor: loading ? "not-allowed" : "pointer",
    opacity: loading ? 0.6 : 1,
  };
}
