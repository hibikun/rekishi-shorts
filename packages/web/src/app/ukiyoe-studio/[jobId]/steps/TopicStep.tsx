"use client";

import type { UkiyoeJob } from "@rekishi/shared";

interface Props {
  job: UkiyoeJob;
  onChange: (job: UkiyoeJob) => void;
  onAdvance: () => void;
}

export function TopicStep({ job, onAdvance }: Props) {
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>
        Topic — 設定済み
      </h2>
      <p style={{ color: "var(--muted)", fontSize: 13, margin: 0 }}>
        ジョブ作成時に確定したトピック情報。変更が必要な場合は新しいジョブを作成してください。
      </p>

      <dl
        style={{
          display: "grid",
          gridTemplateColumns: "120px 1fr",
          rowGap: 8,
          columnGap: 16,
          margin: 0,
          fontSize: 14,
        }}
      >
        <dt style={dtStyle}>タイトル</dt>
        <dd style={ddStyle}>{job.topic.title}</dd>
        <dt style={dtStyle}>人物</dt>
        <dd style={ddStyle}>{job.topic.person ?? "（指定なし）"}</dd>
        <dt style={dtStyle}>時代</dt>
        <dd style={ddStyle}>{job.topic.era ?? "（指定なし）"}</dd>
        <dt style={dtStyle}>軸</dt>
        <dd style={ddStyle}>
          {job.topic.mode === "life"
            ? "一生（年齢軸）"
            : "1日（時刻軸）"}
        </dd>
        <dt style={dtStyle}>シーン数</dt>
        <dd style={ddStyle}>
          {job.topic.sceneCount} シーン × 5 秒 = {job.topic.sceneCount * 5} 秒
        </dd>
        <dt style={dtStyle}>jobId</dt>
        <dd style={{ ...ddStyle, fontFamily: "monospace", fontSize: 12 }}>
          {job.id}
        </dd>
      </dl>

      <div>
        <button
          type="button"
          onClick={onAdvance}
          style={{
            padding: "10px 20px",
            background: "var(--accent)",
            color: "white",
            border: "none",
            borderRadius: 6,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Research へ進む →
        </button>
      </div>
    </div>
  );
}

const dtStyle: React.CSSProperties = {
  fontWeight: 600,
  color: "var(--muted)",
};

const ddStyle: React.CSSProperties = {
  margin: 0,
};
