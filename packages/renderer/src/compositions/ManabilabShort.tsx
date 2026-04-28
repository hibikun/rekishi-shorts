import React from "react";
import { AbsoluteFill, Img, OffthreadVideo, Sequence, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { CaptionSegment } from "@rekishi/shared";
import { TitleCard, type TitleCardKind } from "../components/TitleCard";
import { TextOverlay, type TextOverlayColor, type TextOverlayPosition } from "../components/TextOverlay";
import { Caption } from "../components/Caption";
import { NarrationAudio } from "../components/NarrationAudio";
import { BgmAudio } from "../components/BgmAudio";

/**
 * 学びラボ ショート動画 Composition (D1: 疎通確認用最小構成)。
 *
 * シーン種別:
 *   - "image"      : character pose や B-roll の静止画。任意で TextOverlay を重ねる
 *   - "title-card" : Remotion 純粋アニメで描画する Bro Pump 風タイトルカード
 *
 * 後で audio (TTS), captions, SFX を足していく。
 */

export type ManabilabSceneKind = "image" | "title-card";

export interface ManabilabImageScene {
  kind: "image";
  /** 元画像のパス (Remotion staticFile)。Seedance に渡した入力。videoSrc 未指定時のフォールバック表示にも使う */
  src: string;
  /** Seedance img2video で生成した動画クリップ。あれば優先表示（wiggle/Ken Burns はオフ） */
  videoSrc?: string;
  durationSec: number;
  /** 任意で画像上にテキストを乗せる */
  overlay?: {
    text: string;
    position?: TextOverlayPosition;
    color?: TextOverlayColor;
    fontSize?: number;
  };
  /** Ken Burns 弱め (default: true)。長尺シーンで効く。短尺の wiggle と併用すると煩い */
  kenBurns?: boolean;
  /**
   * 微小揺らし。Bro Pump の "アイドル呼吸感" を再現する高頻度低振幅の動き。
   * default: false。キャラシーンで有効化を推奨。kenBurns=false と併用すると最もキレイ。
   * カスタム振幅/周波数を渡すと細かく調整可。
   */
  wiggle?:
    | boolean
    | {
        /** ピクセル振幅。default 5。8 を超えると煩く感じる */
        amplitude?: number;
        /** 動きの速さ係数。default 1.0。2.0 にすると2倍速の動き */
        speed?: number;
        /** 微小回転。default true。0.4° 程度の傾き揺れを足す */
        rotate?: boolean;
      };
}

export interface ManabilabTitleCardScene {
  kind: "title-card";
  cardKind: TitleCardKind;
  methodName?: string;
  durationSec: number;
}

export type ManabilabScene = ManabilabImageScene | ManabilabTitleCardScene;

export interface ManabilabShortProps {
  scenes: ManabilabScene[];
  totalDurationSec: number;
  /** 共通背景色 (light gray でキャラ画像と馴染ませる) */
  backgroundColor?: string;
  /** Remotion staticFile() で参照可能なナレーション音声 (wav/mp3)。省略時は無音 */
  audioSrc?: string;
  /** 字幕用 segments (text + startSec + endSec)。省略時は字幕なし */
  captionSegments?: CaptionSegment[];
  /** BGM 音声 (mp3 等)。省略時は BGM なし。フェード IN/OUT 付きで再生 */
  bgmSrc?: string;
  /** BGM のベース音量 (0-1)。default 0.18 */
  bgmVolume?: number;
}

const KEN_BURNS_PATTERNS = [
  { scaleFrom: 1.0, scaleTo: 1.05, xFrom: 0, xTo: -8 },
  { scaleFrom: 1.05, scaleTo: 1.0, xFrom: 6, xTo: 0 },
  { scaleFrom: 1.02, scaleTo: 1.06, xFrom: -6, xTo: 4 },
  { scaleFrom: 1.04, scaleTo: 1.0, xFrom: 0, xTo: 8 },
];

interface ImageSceneViewProps {
  src: string;
  durationFrames: number;
  patternIndex: number;
  kenBurns: boolean;
  wiggle: ManabilabImageScene["wiggle"];
}

const VideoSceneView: React.FC<{ src: string }> = ({ src }) => {
  return (
    <AbsoluteFill style={{ backgroundColor: "#F0F0F0" }}>
      <OffthreadVideo
        src={src}
        muted
        volume={0}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "contain",
        }}
      />
    </AbsoluteFill>
  );
};

const ImageSceneView: React.FC<ImageSceneViewProps> = ({
  src,
  durationFrames,
  patternIndex,
  kenBurns,
  wiggle,
}) => {
  const frame = useCurrentFrame();
  const pattern = KEN_BURNS_PATTERNS[patternIndex % KEN_BURNS_PATTERNS.length]!;

  const scale = kenBurns
    ? interpolate(frame, [0, durationFrames], [pattern.scaleFrom, pattern.scaleTo])
    : 1;
  const kenBurnsX = kenBurns
    ? interpolate(frame, [0, durationFrames], [pattern.xFrom, pattern.xTo])
    : 0;

  // Wiggle: 2 周波数を重ねて perfect circle にならない有機的な揺れを作る
  const wiggleEnabled = wiggle === true || (typeof wiggle === "object" && wiggle !== null);
  const wiggleConfig = typeof wiggle === "object" && wiggle !== null ? wiggle : {};
  const amp = wiggleConfig.amplitude ?? 5;
  const speed = wiggleConfig.speed ?? 1;
  const rotateOn = wiggleConfig.rotate ?? true;

  const wiggleX = wiggleEnabled
    ? Math.sin(frame * 0.18 * speed) * amp + Math.sin(frame * 0.07 * speed) * (amp * 0.4)
    : 0;
  const wiggleY = wiggleEnabled
    ? Math.sin(frame * 0.13 * speed + 1.5) * (amp * 0.7) + Math.cos(frame * 0.09 * speed) * (amp * 0.3)
    : 0;
  const wiggleRot = wiggleEnabled && rotateOn ? Math.sin(frame * 0.11 * speed) * 0.4 : 0;

  // 軽くフェードイン (3frames)
  const fadeIn = interpolate(frame, [0, 3], [0, 1], { extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ backgroundColor: "#F0F0F0", opacity: fadeIn }}>
      <Img
        src={src}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "contain",
          transform: `translate(${kenBurnsX + wiggleX}px, ${wiggleY}px) rotate(${wiggleRot}deg) scale(${scale})`,
          transformOrigin: "center center",
        }}
      />
    </AbsoluteFill>
  );
};

export const ManabilabShort: React.FC<ManabilabShortProps> = ({
  scenes,
  totalDurationSec,
  backgroundColor = "#F0F0F0",
  audioSrc,
  captionSegments,
  bgmSrc,
  bgmVolume,
}) => {
  const { fps } = useVideoConfig();

  let cursor = 0;
  const layout = scenes.map((scene, i) => {
    const startFrame = Math.round(cursor * fps);
    const durationFrames = Math.max(1, Math.round(scene.durationSec * fps));
    cursor += scene.durationSec;
    return { scene, startFrame, durationFrames, index: i };
  });

  return (
    <AbsoluteFill style={{ backgroundColor }}>
      {layout.map(({ scene, startFrame, durationFrames, index }) => (
        <Sequence
          key={index}
          from={startFrame}
          durationInFrames={durationFrames}
          name={`scene-${index}-${scene.kind}`}
        >
          {scene.kind === "image" ? (
            <>
              {scene.videoSrc ? (
                <VideoSceneView src={scene.videoSrc} />
              ) : (
                <ImageSceneView
                  src={scene.src}
                  durationFrames={durationFrames}
                  patternIndex={index}
                  kenBurns={scene.kenBurns ?? true}
                  wiggle={scene.wiggle ?? false}
                />
              )}
              {scene.overlay && (
                <TextOverlay
                  text={scene.overlay.text}
                  position={scene.overlay.position}
                  color={scene.overlay.color}
                  fontSize={scene.overlay.fontSize}
                />
              )}
            </>
          ) : (
            <TitleCard kind={scene.cardKind} methodName={scene.methodName} />
          )}
        </Sequence>
      ))}

      {captionSegments && captionSegments.length > 0 && (
        <Caption captionSegments={captionSegments} />
      )}
      {audioSrc && <NarrationAudio src={audioSrc} />}
      {bgmSrc && (
        <BgmAudio src={bgmSrc} volume={bgmVolume} totalDurationSec={totalDurationSec} />
      )}
    </AbsoluteFill>
  );
};
