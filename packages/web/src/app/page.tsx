import Link from "next/link";

export default function HomePage() {
  return (
    <main style={{ maxWidth: 720, margin: "60px auto", padding: "0 24px" }}>
      <h1 style={{ fontSize: 28, fontWeight: 800, marginBottom: 24 }}>
        rekishi-shorts レビュー UI
      </h1>
      <p style={{ color: "var(--muted)", marginBottom: 32 }}>
        scene plan の中身を確認して、動画生成を起動するための内部ツール。
      </p>

      <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 12 }}>
        学びラボ (manabilab)
      </h2>
      <ul style={{ listStyle: "none", padding: 0 }}>
        <li
          style={{
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: "12px 16px",
            background: "var(--card)",
          }}
        >
          <Link
            href="/manabilab/001-note-matome"
            style={{
              fontWeight: 600,
              textDecoration: "none",
              color: "var(--accent)",
            }}
          >
            001 ノートまとめは時間の無駄 →
          </Link>
          <div
            style={{
              fontSize: 12,
              color: "var(--muted)",
              marginTop: 4,
            }}
          >
            10 シーン / 35.06 秒 / VOICEVOX 青山龍星
          </div>
        </li>
      </ul>
    </main>
  );
}
