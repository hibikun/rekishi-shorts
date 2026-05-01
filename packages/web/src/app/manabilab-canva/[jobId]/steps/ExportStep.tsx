"use client";

import { useMemo, useState } from "react";
import type {
  ExportAssetCounts,
  ManabilabCanvaJob,
  ManabilabCanvaScene,
} from "@rekishi/shared";

interface Props {
  job: ManabilabCanvaJob;
  scenes: ManabilabCanvaScene[] | null;
  onJobChange: (job: ManabilabCanvaJob) => void;
}

interface ExportResult {
  ok: boolean;
  job?: ManabilabCanvaJob;
  zipUrl?: string;
  manifestUrl?: string;
  manifest?: {
    warnings?: string[];
    assetCounts?: ExportAssetCounts;
  };
  error?: string;
}

const CANVA_PUBLIC_PREFIX = "/manabilab-canva";

function buildLocalWarnings(
  job: ManabilabCanvaJob,
  scenes: ManabilabCanvaScene[] | null,
): { required: string[]; optional: string[] } {
  const required: string[] = [];
  const optional: string[] = [];
  if (!scenes || scenes.length === 0) {
    required.push("Scenes ステップでシーンを確定してください");
    return { required, optional };
  }

  for (const scene of scenes) {
    if (!scene.imagePath) {
      required.push(`#${scene.index}: 画像候補が未選択です`);
    }
    if (!scene.audioPath) {
      optional.push(`#${scene.index}: 音声は未生成です`);
    }
    if (!scene.videoPath) {
      optional.push(`#${scene.index}: 動画は未生成です`);
    }
  }
  if (!job.steps.tts.concatAudioPath) {
    optional.push("結合音声 full.wav は未生成です");
  }
  return { required, optional };
}

export function ExportStep({ job, scenes, onJobChange }: Props) {
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(job.steps.export.error ?? null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [zipUrl, setZipUrl] = useState<string | null>(
    job.steps.export.zipPath ? `${CANVA_PUBLIC_PREFIX}/${job.steps.export.zipPath}` : null,
  );
  const [manifestUrl, setManifestUrl] = useState<string | null>(
    job.steps.export.manifestPath
      ? `${CANVA_PUBLIC_PREFIX}/${job.steps.export.manifestPath}`
      : null,
  );

  const local = useMemo(() => buildLocalWarnings(job, scenes), [job, scenes]);
  const assetCounts = job.steps.export.assetCounts;
  const canExport = local.required.length === 0;

  const handleExport = async () => {
    setExporting(true);
    setError(null);
    setWarnings([]);
    try {
      const res = await fetch(`/api/manabilab-canva/${job.id}/export`, {
        method: "POST",
      });
      const data = (await res.json()) as ExportResult;
      if (!data.ok || !data.job) {
        setError(data.error ?? "Export に失敗しました");
        if (data.job) onJobChange(data.job);
        return;
      }
      onJobChange(data.job);
      setZipUrl(data.zipUrl ?? null);
      setManifestUrl(data.manifestUrl ?? null);
      setWarnings(data.manifest?.warnings ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <header>
        <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>⑦ Export</h2>
        <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>
          Canva に投入する素材を manifest と ZIP にまとめる。選択済み画像は必須、動画と音声は任意。
        </p>
      </header>

      <section style={sectionStyle}>
        <h3 style={sectionTitleStyle}>素材チェック</h3>
        {local.required.length === 0 ? (
          <p style={{ color: "#2e7d32", fontSize: 13, margin: 0 }}>
            必須素材は揃っています。
          </p>
        ) : (
          <div style={{ display: "grid", gap: 6 }}>
            <p style={{ color: "#d32f2f", fontSize: 13, margin: 0 }}>
              必須素材が不足しています。
            </p>
            <ul style={listStyle}>
              {local.required.map((msg) => (
                <li key={msg}>{msg}</li>
              ))}
            </ul>
          </div>
        )}

        {local.optional.length > 0 ? (
          <details>
            <summary style={summaryStyle}>
              任意素材の未完了 ({local.optional.length})
            </summary>
            <ul style={listStyle}>
              {local.optional.map((msg) => (
                <li key={msg}>{msg}</li>
              ))}
            </ul>
          </details>
        ) : (
          <p style={{ color: "#2e7d32", fontSize: 13, margin: 0 }}>
            動画・音声もすべて揃っています。
          </p>
        )}
      </section>

      <section style={sectionStyle}>
        <h3 style={sectionTitleStyle}>Export生成</h3>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={handleExport}
            disabled={exporting || !canExport}
            style={primaryButtonStyle(exporting || !canExport)}
          >
            {exporting
              ? "Export中..."
              : job.steps.export.zipPath
              ? "ZIPを再生成"
              : "ZIPを生成"}
          </button>
          {job.steps.export.status === "done" ? (
            <span style={{ color: "#2e7d32", fontSize: 12, fontWeight: 600 }}>
              生成済み
            </span>
          ) : null}
          {job.steps.export.generatedAt ? (
            <span style={{ color: "var(--muted)", fontSize: 12 }}>
              {new Date(job.steps.export.generatedAt).toLocaleString("ja-JP")}
            </span>
          ) : null}
        </div>

        {error ? (
          <p style={{ color: "#d32f2f", fontSize: 13, margin: 0 }}>{error}</p>
        ) : null}

        {warnings.length > 0 ? (
          <details open>
            <summary style={summaryStyle}>生成時の警告 ({warnings.length})</summary>
            <ul style={listStyle}>
              {warnings.map((msg) => (
                <li key={msg}>{msg}</li>
              ))}
            </ul>
          </details>
        ) : null}

        {assetCounts ? (
          <div style={{ fontSize: 12, color: "var(--muted)" }}>
            画像 {assetCounts.images} / 動画 {assetCounts.videos} / 個別音声{" "}
            {assetCounts.sceneAudio} / 結合音声 {assetCounts.concatAudio}
          </div>
        ) : null}

        {(zipUrl || manifestUrl) && (
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {zipUrl ? (
              <a href={zipUrl} download style={downloadLinkStyle}>
                ZIPをダウンロード
              </a>
            ) : null}
            {manifestUrl ? (
              <a href={manifestUrl} target="_blank" rel="noreferrer" style={downloadLinkStyle}>
                manifest.jsonを開く
              </a>
            ) : null}
          </div>
        )}
      </section>
    </div>
  );
}

const sectionStyle: React.CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: 14,
  background: "rgba(0,0,0,0.02)",
  display: "grid",
  gap: 10,
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 700,
  margin: 0,
};

const summaryStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  color: "var(--accent)",
};

const listStyle: React.CSSProperties = {
  margin: "6px 0 0",
  paddingLeft: 20,
  color: "var(--muted)",
  fontSize: 12,
};

const downloadLinkStyle: React.CSSProperties = {
  fontSize: 13,
  color: "var(--accent)",
  textDecoration: "none",
  fontWeight: 600,
};

function primaryButtonStyle(disabled: boolean): React.CSSProperties {
  return {
    padding: "10px 20px",
    background: "var(--accent)",
    color: "white",
    border: "none",
    borderRadius: 6,
    fontWeight: 600,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.6 : 1,
  };
}
