"use client";

import { useEffect, useState } from "react";
import type { UkiyoeJob } from "@rekishi/shared";

interface Props {
  job: UkiyoeJob;
  onJobChange: (job: UkiyoeJob) => void;
}

interface MetaResult {
  ok: boolean;
  job?: UkiyoeJob;
  draftMd?: string;
  error?: string;
}

interface ShipResult {
  ok: boolean;
  job?: UkiyoeJob;
  result?: { videoId: string; url: string; privacy: string; title: string; uploadedAt: string };
  error?: string;
}

type Privacy = "public" | "unlisted" | "private";

export function ShipStep({ job, onJobChange }: Props) {
  const [draftMd, setDraftMd] = useState<string>("");
  const [metaLoading, setMetaLoading] = useState(false);
  const [savingMeta, setSavingMeta] = useState(false);
  const [shipping, setShipping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [privacy, setPrivacy] = useState<Privacy>("unlisted");
  const [publishAt, setPublishAt] = useState<string>("");
  const [result, setResult] = useState<ShipResult["result"] | null>(null);

  // 初期ロードで meta-draft.md を取得
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/ukiyoe-studio/${job.id}/meta`);
        const data = (await res.json()) as { ok: boolean; draftMd?: string };
        if (!cancelled && data.ok && typeof data.draftMd === "string") {
          setDraftMd(data.draftMd);
        }
      } catch {
        // noop
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [job.id]);

  const status = job.steps.ship.status;
  const renderDone = job.steps.render.status === "done";
  const metaReady = !!job.steps.ship.metaGenerated && draftMd.trim().length > 0;
  const youtubeUrl = job.steps.ship.youtubeUrl;

  const generateMeta = async (regenerate: boolean) => {
    setMetaLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/ukiyoe-studio/${job.id}/meta/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ regenerate }),
      });
      const data = (await res.json()) as MetaResult;
      if (!data.ok || !data.job) {
        setError(data.error ?? "meta 生成に失敗しました");
        return;
      }
      onJobChange(data.job);
      if (data.draftMd !== undefined) setDraftMd(data.draftMd);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setMetaLoading(false);
    }
  };

  const saveMeta = async () => {
    setSavingMeta(true);
    setError(null);
    try {
      const res = await fetch(`/api/ukiyoe-studio/${job.id}/meta`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftMd }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!data.ok) setError(data.error ?? "保存に失敗しました");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingMeta(false);
    }
  };

  const ship = async () => {
    if (
      !window.confirm(
        `本当に YouTube に投稿しますか?\n  privacy: ${privacy}${publishAt ? `\n  publishAt: ${publishAt}` : ""}`,
      )
    ) {
      return;
    }
    // 先にエディタの内容を保存
    await saveMeta();
    setShipping(true);
    setError(null);
    try {
      const res = await fetch(`/api/ukiyoe-studio/${job.id}/ship/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          privacy,
          publishAt: publishAt
            ? new Date(publishAt).toISOString()
            : undefined,
        }),
      });
      const data = (await res.json()) as ShipResult;
      if (!data.ok || !data.job) {
        setError(data.error ?? "投稿に失敗しました");
        return;
      }
      onJobChange(data.job);
      setResult(data.result ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setShipping(false);
    }
  };

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <header>
        <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>⑨ Ship</h2>
        <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>
          メタ情報を生成・編集して、YouTube Shorts に投稿する。privacy=unlisted で先にテストするのを推奨。
        </p>
      </header>

      {!renderDone ? (
        <p style={{ color: "var(--muted)", fontSize: 13 }}>
          Render ステップが完了していません。
        </p>
      ) : (
        <>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => generateMeta(false)}
              disabled={metaLoading || shipping}
              style={primary(metaLoading)}
            >
              {metaLoading
                ? "生成中..."
                : metaReady
                  ? "meta を読み込み"
                  : "meta を生成"}
            </button>
            <button
              type="button"
              onClick={() => generateMeta(true)}
              disabled={metaLoading || shipping}
              style={secondary(metaLoading)}
            >
              meta を再生成
            </button>
          </div>

          <textarea
            value={draftMd}
            onChange={(e) => setDraftMd(e.target.value)}
            rows={20}
            spellCheck={false}
            placeholder="meta を生成すると Markdown が入ります（タイトル / 説明 / タグ）"
            style={{
              width: "100%",
              padding: 12,
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              fontSize: 13,
              lineHeight: 1.6,
              border: "1px solid var(--border)",
              borderRadius: 6,
              background: "var(--card)",
              color: "inherit",
              resize: "vertical",
            }}
          />
          <div style={{ fontSize: 12, color: "var(--muted)" }}>
            {draftMd.length} 字
          </div>

          <button
            type="button"
            onClick={saveMeta}
            disabled={savingMeta || shipping || !draftMd.trim()}
            style={secondary(savingMeta)}
          >
            meta を保存
          </button>

          <fieldset
            style={{
              border: "1px solid var(--border)",
              borderRadius: 6,
              padding: 12,
              fontSize: 13,
              display: "grid",
              gap: 8,
            }}
          >
            <legend style={{ fontWeight: 600, padding: "0 4px" }}>投稿設定</legend>
            <label style={{ display: "grid", gap: 4 }}>
              <span>privacy</span>
              <select
                value={privacy}
                onChange={(e) => setPrivacy(e.target.value as Privacy)}
                disabled={shipping}
                style={inputStyle}
              >
                <option value="unlisted">unlisted（テスト推奨）</option>
                <option value="private">private</option>
                <option value="public">public</option>
              </select>
            </label>
            <label style={{ display: "grid", gap: 4 }}>
              <span>予約投稿（任意）</span>
              <input
                type="datetime-local"
                value={publishAt}
                onChange={(e) => setPublishAt(e.target.value)}
                disabled={shipping}
                style={inputStyle}
              />
              <span style={{ fontSize: 11, color: "var(--muted)" }}>
                指定すると privacy は強制 private 扱いで予約され、その時刻に公開される。
              </span>
            </label>
          </fieldset>

          <button
            type="button"
            onClick={ship}
            disabled={shipping || !metaReady}
            style={dangerButton(shipping)}
          >
            {shipping ? "投稿中..." : "🚀 YouTube に投稿"}
          </button>
        </>
      )}

      {error ? (
        <p style={{ color: "#d32f2f", fontSize: 13, margin: 0 }}>{error}</p>
      ) : null}

      {(youtubeUrl || result) ? (
        <div
          style={{
            border: "1px solid #2e7d32",
            borderRadius: 6,
            padding: 12,
            background: "rgba(46,125,50,0.06)",
            fontSize: 13,
          }}
        >
          ✅ 投稿完了:{" "}
          <a
            href={youtubeUrl ?? result?.url}
            target="_blank"
            rel="noreferrer"
            style={{ color: "var(--accent)" }}
          >
            {youtubeUrl ?? result?.url}
          </a>
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
            status: <strong>{status}</strong>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: "6px 10px",
  border: "1px solid var(--border)",
  borderRadius: 4,
  fontSize: 13,
  background: "var(--card)",
  color: "inherit",
};

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

function dangerButton(loading: boolean): React.CSSProperties {
  return {
    padding: "12px 22px",
    background: "#d32f2f",
    color: "white",
    border: "none",
    borderRadius: 6,
    fontWeight: 700,
    cursor: loading ? "not-allowed" : "pointer",
    opacity: loading ? 0.6 : 1,
  };
}
