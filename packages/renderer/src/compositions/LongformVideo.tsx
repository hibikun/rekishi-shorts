import React from "react";
import {
  AbsoluteFill,
  Img,
  Sequence,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import type { CaptionSegment } from "@rekishi/shared";
import { NarrationAudio } from "../components/NarrationAudio";
import { BgmAudio } from "../components/BgmAudio";
import { LongformCaption } from "../components/LongformCaption";
import { DesignMotion } from "../design-motion";

export interface LongformScene {
  /** Remotion から参照可能な画像 URL（staticFile or stage 済み相対 URL） */
  src: string;
  /** TTS 実測秒数 */
  durationSec: number;
  /** longform-motion-options の preset id（auto / ken-burns-slow / pop-in 等） */
  motionPresetId: string;
  /** 字幕用（Composition 内では未使用、上位で captionSegments を生成済み前提） */
  narration?: string;
}

export interface LongformVideoProps {
  scenes: LongformScene[];
  /** 結合済み narration wav の URL */
  audioSrc?: string;
  /** 結合 wav の合計秒数。scenes の durationSec 合計とほぼ一致する想定 */
  totalDurationSec: number;
  /** 字幕セグメント（句読点+budoux 単位） */
  captionSegments?: CaptionSegment[];
  /** BGM mp3 の URL。空なら BGM なし */
  bgmSrc?: string;
  /** BGM 音量。default 0.05 */
  bgmVolume?: number;
  /** 動画冒頭のタイトルカード（ない場合は表示しない） */
  openingTitle?: { top: string; bottom: string };
  /** 動画末尾の CTA テキスト（ない場合は表示しない） */
  closingCta?: string;
  /** タイトルカード表示秒数。default 3 */
  openingTitleDurationSec?: number;
  /** CTA 表示秒数。default 4 */
  closingCtaDurationSec?: number;
}

const FONT_FAMILY =
  '"Noto Sans CJK JP", "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif';

/**
 * 16:9 / 1920×1080 / 30fps の長尺動画 Composition。
 *
 * 各 scene は durationSec 分の Sequence で並び、motionPresetId で内部の動きを切り替える。
 * Ken Burns 系は KenBurnsImage コンポーネントを直接使うが、ここでは props 統一のため
 * インライン版 (PanZoomImage) を持つ。DesignMotion 系は既存の design-motion ライブラリを再利用。
 */
export const LongformVideo: React.FC<LongformVideoProps> = ({
  scenes,
  audioSrc,
  totalDurationSec,
  captionSegments,
  bgmSrc,
  bgmVolume = 0.05,
  openingTitle,
  closingCta,
  openingTitleDurationSec = 3,
  closingCtaDurationSec = 4,
}) => {
  const { fps } = useVideoConfig();

  let cursor = 0;
  const sceneSequences = scenes.map((scene, index) => {
    const startFrame = Math.round(cursor * fps);
    const durationFrames = Math.max(1, Math.round(scene.durationSec * fps));
    cursor += scene.durationSec;
    return (
      <Sequence
        key={`scene-${index}`}
        from={startFrame}
        durationInFrames={durationFrames}
      >
        <SceneView
          scene={scene}
          sceneIndex={index}
          durationFrames={durationFrames}
        />
      </Sequence>
    );
  });

  const closingStartFrame =
    cursor > closingCtaDurationSec
      ? Math.round((cursor - closingCtaDurationSec) * fps)
      : 0;
  const closingDurationFrames = Math.max(
    1,
    Math.round(closingCtaDurationSec * fps),
  );

  return (
    <AbsoluteFill style={{ backgroundColor: "#0A0A0A" }}>
      {sceneSequences}

      {openingTitle ? (
        <Sequence
          from={0}
          durationInFrames={Math.max(1, Math.round(openingTitleDurationSec * fps))}
        >
          <OpeningTitle
            top={openingTitle.top}
            bottom={openingTitle.bottom}
            durationFrames={Math.max(
              1,
              Math.round(openingTitleDurationSec * fps),
            )}
          />
        </Sequence>
      ) : null}

      {closingCta ? (
        <Sequence
          from={closingStartFrame}
          durationInFrames={closingDurationFrames}
        >
          <ClosingCta
            text={closingCta}
            durationFrames={closingDurationFrames}
          />
        </Sequence>
      ) : null}

      {audioSrc ? <NarrationAudio src={audioSrc} /> : null}
      {bgmSrc ? (
        <BgmAudio
          src={bgmSrc}
          volume={bgmVolume}
          totalDurationSec={totalDurationSec}
        />
      ) : null}
      {captionSegments && captionSegments.length > 0 ? (
        <LongformCaption captionSegments={captionSegments} />
      ) : null}
    </AbsoluteFill>
  );
};

interface SceneViewProps {
  scene: LongformScene;
  sceneIndex: number;
  durationFrames: number;
}

const SceneView: React.FC<SceneViewProps> = ({
  scene,
  sceneIndex,
  durationFrames,
}) => {
  if (!scene.src) {
    return (
      <AbsoluteFill
        style={{
          background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)",
        }}
      />
    );
  }

  const presetId = scene.motionPresetId || "auto";
  switch (presetId) {
    case "static":
      return <StaticImage src={scene.src} />;
    case "soft-fade":
      return (
        <DesignMotion
          spec={{
            preset: "fade",
            phase: "enter",
            target: "element",
            startFrame: 0,
            durationFrames: Math.min(30, durationFrames),
            staggerFrames: 0,
            intensity: 1,
            easing: "easeOut",
          }}
        >
          <StaticImage src={scene.src} />
        </DesignMotion>
      );
    case "pop-in":
      return (
        <DesignMotion
          spec={{
            preset: "pop",
            phase: "enter",
            target: "element",
            startFrame: 0,
            durationFrames: Math.min(20, durationFrames),
            staggerFrames: 0,
            intensity: 1.15,
            easing: "easeOut",
          }}
        >
          <StaticImage src={scene.src} />
        </DesignMotion>
      );
    case "drift":
      return (
        <DesignMotion
          spec={{
            preset: "drift",
            phase: "loop",
            target: "element",
            startFrame: 0,
            durationFrames,
            staggerFrames: 0,
            intensity: 0.8,
            direction: "up",
          }}
        >
          <StaticImage src={scene.src} />
        </DesignMotion>
      );
    case "ken-burns-fast":
      return (
        <PanZoomImage
          src={scene.src}
          sceneIndex={sceneIndex}
          durationFrames={durationFrames}
          intensity={1.6}
        />
      );
    case "ken-burns-slow":
    case "auto":
    default:
      return (
        <PanZoomImage
          src={scene.src}
          sceneIndex={sceneIndex}
          durationFrames={durationFrames}
          intensity={1.0}
        />
      );
  }
};

const StaticImage: React.FC<{ src: string }> = ({ src }) => (
  <AbsoluteFill style={{ backgroundColor: "#000" }}>
    <Img
      src={src}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        objectFit: "cover",
      }}
    />
    <BottomGradient />
  </AbsoluteFill>
);

interface PanZoomImageProps {
  src: string;
  sceneIndex: number;
  durationFrames: number;
  /** 1.0 で標準。1.5 で動きを 1.5 倍にする */
  intensity?: number;
}

const PanZoomImage: React.FC<PanZoomImageProps> = ({
  src,
  sceneIndex,
  durationFrames,
  intensity = 1,
}) => {
  const frame = useCurrentFrame();
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
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      <Img
        src={src}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
          transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
          transformOrigin: "center center",
        }}
      />
      <BottomGradient />
    </AbsoluteFill>
  );
};

const BottomGradient: React.FC = () => (
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
);

interface OpeningTitleProps {
  top: string;
  bottom: string;
  durationFrames: number;
}

const OpeningTitle: React.FC<OpeningTitleProps> = ({
  top,
  bottom,
  durationFrames,
}) => {
  const frame = useCurrentFrame();
  const fadeIn = interpolate(frame, [0, 12], [0, 1], {
    extrapolateRight: "clamp",
  });
  const fadeOut = interpolate(
    frame,
    [durationFrames - 12, durationFrames],
    [1, 0],
    { extrapolateLeft: "clamp" },
  );
  const opacity = Math.min(fadeIn, fadeOut);

  return (
    <AbsoluteFill
      style={{
        backgroundColor: "rgba(0, 0, 0, 0.45)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        opacity,
        zIndex: 9,
      }}
    >
      {top ? (
        <div
          style={{
            fontFamily: FONT_FAMILY,
            color: "#FFFFFFCC",
            fontSize: 48,
            fontWeight: 500,
            marginBottom: 16,
            textShadow: "0 4px 18px rgba(0,0,0,0.7)",
          }}
        >
          {top}
        </div>
      ) : null}
      <div
        style={{
          fontFamily: FONT_FAMILY,
          color: "#FFFFFF",
          fontSize: 110,
          fontWeight: 800,
          letterSpacing: "0.02em",
          textShadow: "0 8px 30px rgba(0,0,0,0.8)",
        }}
      >
        {bottom}
      </div>
    </AbsoluteFill>
  );
};

interface ClosingCtaProps {
  text: string;
  durationFrames: number;
}

const ClosingCta: React.FC<ClosingCtaProps> = ({ text, durationFrames }) => {
  const frame = useCurrentFrame();
  const fadeIn = interpolate(frame, [0, 18], [0, 1], {
    extrapolateRight: "clamp",
  });
  const fadeOut = interpolate(
    frame,
    [durationFrames - 18, durationFrames],
    [1, 0],
    { extrapolateLeft: "clamp" },
  );
  const opacity = Math.min(fadeIn, fadeOut);

  return (
    <AbsoluteFill
      style={{
        backgroundColor: "rgba(0, 0, 0, 0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        opacity,
        zIndex: 9,
      }}
    >
      <div
        style={{
          fontFamily: FONT_FAMILY,
          color: "#FFFFFF",
          fontSize: 64,
          fontWeight: 700,
          textAlign: "center",
          maxWidth: "75%",
          lineHeight: 1.45,
          textShadow: "0 6px 22px rgba(0,0,0,0.7)",
        }}
      >
        {text}
      </div>
    </AbsoluteFill>
  );
};
