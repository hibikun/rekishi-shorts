"use client";

import dynamic from "next/dynamic";
import React, { useMemo } from "react";
import type {
  SelfMotivationScene,
  SelfMotivationScript,
} from "@rekishi/shared";
import {
  LongformPreview,
  type LongformPreviewProps,
  type LongformPreviewCaption,
} from "@/lib/longform-preview-composition";

// SSR 無効化（Remotion Player は browser-only）
const Player = dynamic(
  () => import("@remotion/player").then((m) => m.Player),
  { ssr: false },
);

interface Props {
  jobId: string;
  scenes: SelfMotivationScene[];
  selectedSceneId: string | null;
  script: SelfMotivationScript | null;
}

const FPS = 30;
const VIDEO_WIDTH = 1920;
const VIDEO_HEIGHT = 1080;

export function PreviewPane({
  jobId,
  scenes,
  selectedSceneId,
}: Props) {
  const previewProps = useMemo<LongformPreviewProps>(() => {
    const previewScenes = scenes
      .filter((s) => s.imagePath && s.audioDurationSec)
      .map((s) => ({
        src: `/self-motivation/${s.imagePath}?t=${s.imageGeneratedAt ?? ""}`,
        durationSec: s.audioDurationSec ?? 0,
        motionPresetId: s.motionPresetId,
      }));

    const totalDurationSec = previewScenes.reduce(
      (sum, s) => sum + s.durationSec,
      0,
    );

    // 字幕は scene 単位（まずは narration をそのまま 1 フレーズで出す）
    const captions: LongformPreviewCaption[] = [];
    let cursor = 0;
    for (const scene of scenes) {
      if (!scene.audioDurationSec || !scene.imagePath) continue;
      const dur = scene.audioDurationSec;
      captions.push({
        text: scene.narration,
        startSec: cursor,
        endSec: cursor + dur,
      });
      cursor += dur;
    }

    return {
      scenes: previewScenes,
      audioSrc: undefined, // 結合 wav は scene 単位の URL で再生できないため、まずは無音プレビュー
      captions,
      totalDurationSec,
    };
  }, [scenes]);

  // 選択中シーンの開始秒を求める（Player の seek 制御に使う）
  const selectedStartFrame = useMemo(() => {
    if (!selectedSceneId) return 0;
    let cursor = 0;
    for (const s of scenes) {
      if (s.sceneId === selectedSceneId) return Math.round(cursor * FPS);
      if (s.audioDurationSec) cursor += s.audioDurationSec;
    }
    return 0;
  }, [scenes, selectedSceneId]);

  if (previewProps.scenes.length === 0) {
    return (
      <div
        style={{
          border: "1px solid var(--border)",
          borderRadius: 8,
          background: "var(--card)",
          padding: 16,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--muted)",
          fontSize: 13,
          minHeight: 360,
        }}
      >
        画像と TTS を生成すると、ここでプレビューできるよ
      </div>
    );
  }

  const durationInFrames = Math.max(
    1,
    Math.ceil(previewProps.totalDurationSec * FPS),
  );

  // 結合 wav が job.json に登録されている場合のみ Audio を再生する。
  // 個別 scene wav は Player 側で逐次切替が難しいので、まずは concat 済みの 1 本を再生する。
  // PreviewPane の props にはまだ concat URL を渡していないので、最初のリリースは「無音プレビュー」になる。
  const concatAudioUrl: string | undefined = (() => {
    // job.steps.tts.concatAudioPath があれば URL に変換する
    // jobId / scenes だけだと取れないので、ここでは URL 推測ベースで参照する
    return `/self-motivation/jobs/${jobId}/audio/full.wav`;
  })();

  // 概念上は concatAudioUrl が存在すれば渡す（404 のときは Player は単に無音再生）
  const playerProps: LongformPreviewProps = {
    ...previewProps,
    audioSrc: concatAudioUrl,
  };

  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 8,
        background: "var(--card)",
        padding: 12,
        display: "grid",
        gap: 8,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <strong style={{ fontSize: 14 }}>プレビュー</strong>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>
          {previewProps.totalDurationSec.toFixed(1)}s · {previewProps.scenes.length}{" "}
          シーン
        </span>
      </div>
      <div
        style={{
          width: "100%",
          aspectRatio: "16 / 9",
          background: "#000",
          borderRadius: 6,
          overflow: "hidden",
        }}
      >
        <Player
          component={
            LongformPreview as unknown as React.FC<Record<string, unknown>>
          }
          inputProps={playerProps as unknown as Record<string, unknown>}
          durationInFrames={durationInFrames}
          fps={FPS}
          compositionWidth={VIDEO_WIDTH}
          compositionHeight={VIDEO_HEIGHT}
          controls
          style={{ width: "100%", height: "100%" }}
          initialFrame={selectedStartFrame}
        />
      </div>
      <div style={{ fontSize: 11, color: "var(--muted)" }}>
        プレビューは簡易版です。最終 mp4 は「Render」で生成されます。
      </div>
    </div>
  );
}
