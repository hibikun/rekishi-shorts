"use client";

import { useEffect, useRef, useState } from "react";

interface Props {
  jobId: string;
}

interface CharacterState {
  loading: boolean;
  exists: boolean;
  url?: string;
  ext?: string;
  error?: string;
}

export function CharacterPanel({ jobId }: Props) {
  const [state, setState] = useState<CharacterState>({
    loading: true,
    exists: false,
  });
  const [busy, setBusy] = useState<"upload" | "delete" | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/self-motivation/${jobId}/character`, {
          cache: "no-store",
        });
        const data = (await res.json()) as {
          ok: boolean;
          exists?: boolean;
          url?: string;
          ext?: string;
          error?: string;
        };
        if (cancelled) return;
        if (!data.ok) {
          setState({ loading: false, exists: false, error: data.error });
          return;
        }
        setState({
          loading: false,
          exists: !!data.exists,
          url: data.url,
          ext: data.ext,
        });
      } catch (e) {
        if (cancelled) return;
        setState({
          loading: false,
          exists: false,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  const onUpload = async (file: File) => {
    setBusy("upload");
    setState((s) => ({ ...s, error: undefined }));
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/self-motivation/${jobId}/character`, {
        method: "POST",
        body: fd,
      });
      const data = (await res.json()) as {
        ok: boolean;
        exists?: boolean;
        url?: string;
        ext?: string;
        error?: string;
      };
      if (!data.ok) {
        setState((s) => ({ ...s, error: data.error ?? "アップロード失敗" }));
        return;
      }
      setState({
        loading: false,
        exists: !!data.exists,
        url: data.url,
        ext: data.ext,
      });
    } catch (e) {
      setState((s) => ({
        ...s,
        error: e instanceof Error ? e.message : String(e),
      }));
    } finally {
      setBusy(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const onDelete = async () => {
    if (!confirm("キャラクター参照画像を削除しますか？")) return;
    setBusy("delete");
    setState((s) => ({ ...s, error: undefined }));
    try {
      const res = await fetch(`/api/self-motivation/${jobId}/character`, {
        method: "DELETE",
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!data.ok) {
        setState((s) => ({ ...s, error: data.error ?? "削除失敗" }));
        return;
      }
      setState({ loading: false, exists: false });
    } catch (e) {
      setState((s) => ({
        ...s,
        error: e instanceof Error ? e.message : String(e),
      }));
    } finally {
      setBusy(null);
    }
  };

  if (state.loading) {
    return (
      <p style={{ color: "var(--muted)", fontSize: 13, margin: 0 }}>
        読み込み中…
      </p>
    );
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>
        ジョブ単位で 1 枚のキャラクター画像を登録します。登録すると、以後すべてのシーン画像生成で
        Nano Banana に参照画像として渡されるので、全シーンで同じキャラクターの絵柄になります。
      </p>

      {state.exists && state.url ? (
        <div
          style={{
            display: "flex",
            gap: 16,
            alignItems: "flex-start",
            flexWrap: "wrap",
          }}
        >
          <div
            style={{
              width: 240,
              aspectRatio: "1 / 1",
              background: "#0A0A0A",
              borderRadius: 8,
              overflow: "hidden",
              border: "1px solid var(--border)",
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={state.url}
              alt="character reference"
              style={{
                width: "100%",
                height: "100%",
                objectFit: "contain",
              }}
            />
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>
              形式: <code>{state.ext}</code>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                disabled={busy !== null}
                style={btnStyle}
              >
                {busy === "upload" ? "アップロード中…" : "↻ 別の画像に差し替える"}
              </button>
              <button
                type="button"
                onClick={onDelete}
                disabled={busy !== null}
                style={{ ...btnStyle, color: "#c62828" }}
              >
                {busy === "delete" ? "削除中…" : "🗑 削除"}
              </button>
            </div>
            <p style={{ margin: 0, fontSize: 11, color: "var(--muted)" }}>
              画像を変更したあとは、各シーンの「🎨 画像」ボタンか Pipeline の「画像」ボタンで
              全シーンの画像を再生成してください。
            </p>
          </div>
        </div>
      ) : (
        <div
          style={{
            border: "1px dashed var(--border)",
            borderRadius: 8,
            padding: 24,
            textAlign: "center",
            color: "var(--muted)",
            fontSize: 13,
          }}
        >
          まだキャラクター画像が登録されていません。
          <br />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={busy !== null}
            style={{ ...btnStyle, marginTop: 12 }}
          >
            {busy === "upload" ? "アップロード中…" : "📤 画像をアップロード"}
          </button>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void onUpload(f);
        }}
      />

      {state.error ? (
        <div style={{ fontSize: 12, color: "#d32f2f" }}>⚠ {state.error}</div>
      ) : null}
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  fontSize: 13,
  padding: "8px 14px",
  border: "1px solid var(--border)",
  borderRadius: 6,
  background: "transparent",
  color: "inherit",
  cursor: "pointer",
};
