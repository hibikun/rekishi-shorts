"use client";

import React from "react";
import {
  AbsoluteFill,
  Audio,
  Img,
  Loop,
  Sequence,
  Video,
  interpolate,
  useCurrentFrame,
} from "remotion";

/**
 * Web エディタの Remotion Player でだけ使う簡易プレビュー Composition。
 *
 * 本番レンダリング (mp4) は renderer 側の LongformVideo を使う。
 * プレビューは UI 軽量化のため：
 *  - DesignMotion / 一部モーションは簡略化
 *  - BGM 省略
 *  - budoux による字幕折返しは省略（テキストそのまま）
 *  - opening title / closing CTA も省略
 */

export interface LongformPreviewScene {
  /** /self-motivation/jobs/{id}/images/{sceneId}.png のような相対 URL */
  src: string;
  durationSec: number;
  motionPresetId: string;
  /** /self-motivation/jobs/{id}/videos/{sceneId}.mp4 のような相対 URL */
  videoSrc?: string;
  videoDurationSec?: number;
}

export interface LongformPreviewCaption {
  text: string;
  startSec: number;
  endSec: number;
}

export interface LongformPreviewProps {
  scenes: LongformPreviewScene[];
  audioSrc?: string;
  captions?: LongformPreviewCaption[];
  totalDurationSec: number;
}

const FPS = 30;
const FONT_FAMILY =
  '"Noto Sans CJK JP", "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif';

export const LongformPreview: React.FC<LongformPreviewProps> = ({
  scenes,
  audioSrc,
  captions,
}) => {
  let cursor = 0;
  return (
    <AbsoluteFill style={{ backgroundColor: "#0A0A0A" }}>
      {scenes.map((scene, index) => {
        const startFrame = Math.round(cursor * FPS);
        const durationFrames = Math.max(1, Math.round(scene.durationSec * FPS));
        cursor += scene.durationSec;
        return (
          <Sequence
            key={`scene-${index}`}
            from={startFrame}
            durationInFrames={durationFrames}
          >
            <PreviewScene
              src={scene.src}
              motionPresetId={scene.motionPresetId}
              sceneIndex={index}
              durationFrames={durationFrames}
              videoSrc={scene.videoSrc}
              videoDurationSec={scene.videoDurationSec}
            />
          </Sequence>
        );
      })}
      {captions && captions.length > 0 ? (
        <PreviewCaptionLayer captions={captions} />
      ) : null}
      {audioSrc ? <Audio src={audioSrc} /> : null}
    </AbsoluteFill>
  );
};

interface PreviewSceneProps {
  src: string;
  motionPresetId: string;
  sceneIndex: number;
  durationFrames: number;
  videoSrc?: string;
  videoDurationSec?: number;
}

const PreviewScene: React.FC<PreviewSceneProps> = ({
  src,
  motionPresetId,
  sceneIndex,
  durationFrames,
  videoSrc,
  videoDurationSec,
}) => {
  const frame = useCurrentFrame();

  if (videoSrc) {
    const loopFrames = Math.max(
      1,
      Math.round((videoDurationSec ?? 5) * FPS),
    );
    return (
      <AbsoluteFill style={{ backgroundColor: "#000" }}>
        <Loop durationInFrames={loopFrames}>
          <Video
            src={videoSrc}
            muted
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
            }}
          />
        </Loop>
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            height: "40%",
            background:
              "linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0.6) 90%)",
            pointerEvents: "none",
          }}
        />
      </AbsoluteFill>
    );
  }

  if (!src) {
    return (
      <AbsoluteFill
        style={{
          background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)",
        }}
      />
    );
  }

  if (motionPresetId === "static") {
    return <StillImage src={src} />;
  }

  if (motionPresetId === "soft-fade") {
    const opacity = interpolate(
      frame,
      [0, Math.min(30, durationFrames)],
      [0, 1],
      { extrapolateRight: "clamp" },
    );
    return <StillImage src={src} style={{ opacity }} />;
  }

  if (motionPresetId === "pop-in") {
    const scale = interpolate(
      frame,
      [0, Math.min(20, durationFrames)],
      [0.85, 1],
      { extrapolateRight: "clamp" },
    );
    const opacity = interpolate(frame, [0, 8], [0, 1], {
      extrapolateRight: "clamp",
    });
    return (
      <StillImage
        src={src}
        style={{
          opacity,
          transform: `scale(${scale})`,
          transformOrigin: "center center",
        }}
      />
    );
  }

  if (motionPresetId === "drift") {
    const x = Math.sin(frame * 0.04) * 8;
    const y = Math.cos(frame * 0.03) * 6;
    return (
      <StillImage
        src={src}
        style={{ transform: `translate(${x}px, ${y}px)` }}
      />
    );
  }

  // Ken Burns 系 (auto / ken-burns-slow / ken-burns-fast)
  const intensity = motionPresetId === "ken-burns-fast" ? 1.6 : 1;
  const patterns = [
    { sFrom: 1.0, sTo: 1.08, xFrom: 0, xTo: -24, yFrom: 0, yTo: -10 },
    { sFrom: 1.08, sTo: 1.0, xFrom: 18, xTo: 0, yFrom: 8, yTo: 0 },
    { sFrom: 1.04, sTo: 1.1, xFrom: -16, xTo: 12, yFrom: 0, yTo: 8 },
    { sFrom: 1.1, sTo: 1.02, xFrom: 0, xTo: 20, yFrom: -8, yTo: 4 },
  ];
  const p = patterns[sceneIndex % patterns.length]!;
  const lerp = (a: number, b: number) =>
    interpolate(frame, [0, durationFrames], [a, b]);
  const scale = lerp(p.sFrom, p.sFrom + (p.sTo - p.sFrom) * intensity);
  const tx = lerp(p.xFrom, p.xFrom + (p.xTo - p.xFrom) * intensity);
  const ty = lerp(p.yFrom, p.yFrom + (p.yTo - p.yFrom) * intensity);
  return (
    <StillImage
      src={src}
      style={{
        transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
        transformOrigin: "center center",
      }}
    />
  );
};

const StillImage: React.FC<{
  src: string;
  style?: React.CSSProperties;
}> = ({ src, style }) => (
  <AbsoluteFill style={{ backgroundColor: "#000" }}>
    <Img
      src={src}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        objectFit: "cover",
        ...style,
      }}
    />
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        height: "40%",
        background:
          "linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0.6) 90%)",
        pointerEvents: "none",
      }}
    />
  </AbsoluteFill>
);

const PreviewCaptionLayer: React.FC<{
  captions: LongformPreviewCaption[];
}> = ({ captions }) => {
  const frame = useCurrentFrame();
  const sec = frame / FPS;
  const active = captions.find((c) => sec >= c.startSec && sec < c.endSec);
  if (!active) return null;
  return (
    <div
      style={{
        position: "absolute",
        bottom: "8%",
        left: 0,
        right: 0,
        display: "flex",
        justifyContent: "center",
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          maxWidth: "82%",
          textAlign: "center",
          fontFamily: FONT_FAMILY,
          fontWeight: 700,
          fontSize: 56,
          color: "#FFFFFF",
          background: "rgba(0,0,0,0.55)",
          padding: "16px 32px",
          borderRadius: 8,
          textShadow: "0 0 8px #000, 0 0 4px #000",
          lineHeight: 1.35,
          wordBreak: "keep-all",
          overflowWrap: "anywhere",
        }}
      >
        {active.text}
      </div>
    </div>
  );
};
