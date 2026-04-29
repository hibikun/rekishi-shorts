import React from "react";
import { AbsoluteFill, Sequence, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { DesignMotionSpec } from "@rekishi/shared";
import { DesignMotion, TextMotion } from "../design-motion";

const SCENE_SEC = 2.2;

interface ShowcasePreset {
  name: string;
  label: string;
  spec: DesignMotionSpec;
  loopSpec?: DesignMotionSpec;
  accent: string;
}

const presets: ShowcasePreset[] = [
  {
    name: "fade",
    label: "静かに入る基準モーション",
    accent: "#3B82F6",
    spec: {
      preset: "fade",
      phase: "enter",
      target: "element",
      startFrame: 6,
      durationFrames: 18,
      staggerFrames: 0,
      intensity: 1,
      easing: "easeOut",
    },
  },
  {
    name: "rise / word",
    label: "単語ごとに少し遅れて立ち上がる",
    accent: "#22C55E",
    spec: {
      preset: "rise",
      phase: "enter",
      target: "word",
      direction: "up",
      startFrame: 6,
      durationFrames: 16,
      staggerFrames: 2,
      intensity: 0.9,
      easing: "easeOut",
    },
  },
  {
    name: "pop / word",
    label: "強調語を弾ませる",
    accent: "#F59E0B",
    spec: {
      preset: "pop",
      phase: "enter",
      target: "word",
      startFrame: 8,
      durationFrames: 14,
      staggerFrames: 3,
      intensity: 1,
      easing: "spring",
    },
  },
  {
    name: "typewriter",
    label: "文字単位で順番に表示",
    accent: "#EC4899",
    spec: {
      preset: "typewriter",
      phase: "enter",
      target: "character",
      startFrame: 5,
      durationFrames: 5,
      staggerFrames: 1,
      intensity: 1,
      easing: "easeOut",
    },
  },
  {
    name: "wipe",
    label: "マスクで見せる図形・画像向け",
    accent: "#06B6D4",
    spec: {
      preset: "wipe",
      phase: "enter",
      target: "element",
      direction: "right",
      startFrame: 6,
      durationFrames: 20,
      staggerFrames: 0,
      intensity: 1,
      easing: "easeInOut",
    },
  },
  {
    name: "stomp",
    label: "重く落として、着地で潰して止める",
    accent: "#8B5CF6",
    spec: {
      preset: "stomp",
      phase: "enter",
      target: "element",
      startFrame: 7,
      durationFrames: 23,
      staggerFrames: 0,
      intensity: 1,
      easing: "easeInOut",
    },
  },
  {
    name: "breathe + drift",
    label: "出た後にわずかに呼吸させる",
    accent: "#A855F7",
    spec: {
      preset: "rise",
      phase: "enter",
      target: "element",
      direction: "up",
      startFrame: 4,
      durationFrames: 14,
      staggerFrames: 0,
      intensity: 0.6,
      easing: "easeOut",
    },
    loopSpec: {
      preset: "breathe",
      phase: "loop",
      target: "element",
      startFrame: 20,
      durationFrames: 44,
      staggerFrames: 0,
      intensity: 0.85,
      easing: "linear",
    },
  },
];

export const CANVA_MOTION_SHOWCASE_DURATION_SEC = presets.length * SCENE_SEC;

export const CanvaMotionShowcase: React.FC = () => {
  const { fps } = useVideoConfig();
  const durationFrames = Math.round(SCENE_SEC * fps);

  return (
    <AbsoluteFill
      style={{
        background: "#101418",
        color: "#F8FAFC",
        fontFamily:
          '"Hiragino Kaku Gothic ProN", "Noto Sans CJK JP", "Noto Sans JP", sans-serif',
      }}
    >
      {presets.map((preset, index) => (
        <Sequence
          key={preset.name}
          from={index * durationFrames}
          durationInFrames={durationFrames}
        >
          <ShowcaseSlide preset={preset} index={index} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};

const ShowcaseSlide: React.FC<{ preset: ShowcasePreset; index: number }> = ({
  preset,
  index,
}) => {
  const title = "記憶は、寝ている間に整理される";
  const content = preset.name === "stomp" ? (
    <StompPreview preset={preset} />
  ) : preset.loopSpec ? (
    <DesignMotion spec={preset.loopSpec}>
      <DesignMotion spec={preset.spec}>
        <SampleCard accent={preset.accent} />
      </DesignMotion>
    </DesignMotion>
  ) : preset.spec.target === "element" ? (
    <DesignMotion spec={preset.spec}>
      <SampleCard accent={preset.accent} />
    </DesignMotion>
  ) : (
    <TextMotion
      spec={preset.spec}
      text={title}
      style={{
        display: "block",
        fontSize: 74,
        lineHeight: 1.18,
        fontWeight: 900,
        letterSpacing: 0,
        textAlign: "center",
      }}
    />
  );

  return (
    <AbsoluteFill
      style={{
        padding: "72px 72px 96px",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        background:
          "linear-gradient(180deg, rgba(248,250,252,0.08) 0%, rgba(16,20,24,0) 42%)",
      }}
    >
      <div>
        <div
          style={{
            color: preset.accent,
            fontSize: 34,
            fontWeight: 800,
            letterSpacing: 0,
            marginBottom: 18,
          }}
        >
          EFFECT {index + 1}
        </div>
        <div
          style={{
            fontSize: 72,
            fontWeight: 900,
            lineHeight: 1.02,
            letterSpacing: 0,
          }}
        >
          {preset.name}
        </div>
        <div
          style={{
            marginTop: 22,
            fontSize: 34,
            lineHeight: 1.32,
            color: "#CBD5E1",
            fontWeight: 700,
            letterSpacing: 0,
          }}
        >
          {preset.label}
        </div>
      </div>

      <div
        style={{
          minHeight: 720,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {content}
      </div>

      <div
        style={{
          height: 10,
          borderRadius: 999,
          background: "rgba(148,163,184,0.22)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${((index + 1) / presets.length) * 100}%`,
            height: "100%",
            background: preset.accent,
          }}
        />
      </div>
    </AbsoluteFill>
  );
};

const StompPreview: React.FC<{ preset: ShowcasePreset }> = ({ preset }) => {
  const frame = useCurrentFrame();
  const local = frame - preset.spec.startFrame;
  const impact = interpolate(local, [9, 12, 19], [0, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const ringScale = interpolate(local, [10, 19], [0.7, 1.35], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const shadowScale = interpolate(local, [0, 11, 20], [0.72, 1.18, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const shake = impact * 5;

  return (
    <div
      style={{
        position: "relative",
        width: 820,
        height: 560,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        transform: `translate(${Math.sin(frame * 2.2) * shake}px, ${Math.cos(frame * 2.7) * shake}px)`,
      }}
    >
      <div
        style={{
          position: "absolute",
          bottom: 42,
          width: 500,
          height: 54,
          borderRadius: "50%",
          background: "rgba(0,0,0,0.28)",
          filter: "blur(20px)",
          transform: `scaleX(${shadowScale})`,
          opacity: 0.42 + impact * 0.24,
        }}
      />
      <div
        style={{
          position: "absolute",
          width: 780,
          height: 480,
          borderRadius: 12,
          border: `8px solid ${preset.accent}`,
          opacity: impact * 0.34,
          transform: `scale(${ringScale})`,
        }}
      />
      <DesignMotion spec={preset.spec}>
        <SampleCard accent={preset.accent} />
      </DesignMotion>
    </div>
  );
};

const SampleCard: React.FC<{ accent: string }> = ({ accent }) => {
  return (
    <div
      style={{
        width: 760,
        minHeight: 440,
        borderRadius: 8,
        background: "#F8FAFC",
        color: "#111827",
        padding: "54px 56px",
        boxShadow: "0 24px 70px rgba(0,0,0,0.36)",
      }}
    >
      <div
        style={{
          width: 86,
          height: 12,
          borderRadius: 999,
          background: accent,
          marginBottom: 34,
        }}
      />
      <div
        style={{
          fontSize: 64,
          lineHeight: 1.1,
          letterSpacing: 0,
          fontWeight: 900,
        }}
      >
        3つの勉強法だけで記憶は変わる
      </div>
      <div
        style={{
          marginTop: 30,
          fontSize: 30,
          lineHeight: 1.35,
          letterSpacing: 0,
          color: "#475569",
          fontWeight: 700,
        }}
      >
        Canva風のレイヤーアニメーションをRemotionで再現するための確認画面。
      </div>
    </div>
  );
};
