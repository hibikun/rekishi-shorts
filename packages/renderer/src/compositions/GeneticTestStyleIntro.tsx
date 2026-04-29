import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

export const GENETIC_TEST_STYLE_INTRO_DURATION_SEC = 6;

const clamp = {
  extrapolateLeft: "clamp" as const,
  extrapolateRight: "clamp" as const,
};

const captions = [
  { text: "シャツを", red: "上げて", start: 24, end: 39 },
  { text: "今すぐ", red: "確認", start: 39, end: 54 },
  { text: "あなたは", red: "本物の", start: 54, end: 72 },
  { text: "腹筋遺伝子を", red: "持ってる?", start: 72, end: 98 },
  { text: "それとも", red: "平均?", start: 118, end: 146 },
];

export const GeneticTestStyleIntro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const teaserOpacity = interpolate(frame, [0, 8, 12], [1, 1, 0], clamp);
  const blurBurst = interpolate(frame, [8, 14, 22], [0, 1, 0], clamp);
  const mainOpacity = interpolate(frame, [12, 18], [0, 1], clamp);
  const mainSpring = spring({
    frame: frame - 14,
    fps,
    config: { damping: 13, stiffness: 170, mass: 0.75 },
  });
  const mainScale = interpolate(mainSpring, [0, 1], [1.18, 1], clamp);
  const cameraScale = interpolate(frame, [22, 180], [1, 1.075], clamp);
  const titleOpacity = interpolate(frame, [76, 86, 108, 118], [0, 1, 1, 0], clamp);
  const silhouetteOpacity = interpolate(frame, [112, 126], [0, 1], clamp);

  return (
    <AbsoluteFill
      style={{
        background: "#D9D9D7",
        overflow: "hidden",
        fontFamily:
          '"Hiragino Kaku Gothic ProN", "Noto Sans CJK JP", "Noto Sans JP", sans-serif',
      }}
    >
      <AbsoluteFill style={{ opacity: mainOpacity }}>
        <div
          style={{
            width: "100%",
            height: "100%",
            transform: `scale(${cameraScale})`,
            transformOrigin: "center center",
          }}
        >
          <HeroFigure frame={frame} />
        </div>
      </AbsoluteFill>

      <AbsoluteFill style={{ opacity: blurBurst, pointerEvents: "none" }}>
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            style={{
              position: "absolute",
              inset: 0,
              transform: `scale(${1.1 + i * 0.12})`,
              opacity: 0.28 - i * 0.035,
              filter: `blur(${8 + i * 8}px)`,
            }}
          >
            <HeroFigure frame={frame} compact />
          </div>
        ))}
      </AbsoluteFill>

      <AbsoluteFill style={{ opacity: teaserOpacity }}>
        <TeaserCard frame={frame} />
      </AbsoluteFill>

      <AbsoluteFill
        style={{
          opacity: mainOpacity,
          transform: `scale(${mainScale})`,
          transformOrigin: "center center",
        }}
      >
        <CaptionTrack frame={frame} />
      </AbsoluteFill>

      <div
        style={{
          position: "absolute",
          top: 180,
          left: 380,
          width: 580,
          color: "#111",
          fontSize: 54,
          lineHeight: 1.1,
          fontWeight: 900,
          letterSpacing: 0,
          opacity: titleOpacity,
          textShadow: "0 2px 0 #fff",
        }}
      >
        あなたの腹筋遺伝子は?
      </div>

      <div
        style={{
          position: "absolute",
          left: 150,
          bottom: 176,
          opacity: silhouetteOpacity,
          transform: `translateX(${interpolate(frame, [112, 132], [-80, 0], clamp)}px)`,
        }}
      >
        <AverageSilhouette />
      </div>
    </AbsoluteFill>
  );
};

const TeaserCard: React.FC<{ frame: number }> = ({ frame }) => {
  const scale = interpolate(frame, [0, 8, 13], [1, 1.02, 1.34], clamp);
  const blur = interpolate(frame, [8, 14], [0, 26], clamp);

  return (
    <AbsoluteFill
      style={{
        background: "#24282B",
        transform: `scale(${scale})`,
        filter: `blur(${blur}px)`,
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: "72px 70px",
          border: "8px solid #111",
          background: "#E8E2D6",
          overflow: "hidden",
        }}
      >
        <div style={{ position: "absolute", left: 80, top: 30, transform: "scale(0.78)" }}>
          <Torso />
        </div>
        <div style={{ position: "absolute", left: 86, bottom: 20, transform: "scale(0.9)" }}>
          <AbsGlow />
        </div>
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: 418,
            padding: "18px 24px",
            background: "#111",
            color: "#fff",
            fontSize: 48,
            fontWeight: 950,
            textAlign: "center",
            letterSpacing: 0,
          }}
        >
          遺伝子テスト
        </div>
        <div
          style={{
            position: "absolute",
            right: 100,
            top: 150,
            color: "#E72936",
            fontSize: 150,
            fontWeight: 950,
            transform: "rotate(-8deg)",
            WebkitTextStroke: "8px #111",
          }}
        >
          X
        </div>
      </div>
    </AbsoluteFill>
  );
};

const CaptionTrack: React.FC<{ frame: number }> = ({ frame }) => {
  const active = captions.find((caption) => frame >= caption.start && frame < caption.end);
  if (!active) return null;
  const local = frame - active.start;
  const scale = interpolate(local, [0, 4, active.end - active.start], [0.9, 1.08, 1], clamp);

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 240,
        display: "flex",
        justifyContent: "center",
        transform: `scale(${scale})`,
      }}
    >
      <div
        style={{
          color: "#fff",
          fontSize: 43,
          lineHeight: 1,
          fontWeight: 950,
          letterSpacing: 0,
          WebkitTextStroke: "8px #151515",
          paintOrder: "stroke fill",
          textShadow: "0 5px 0 rgba(0,0,0,0.25)",
        }}
      >
        {active.text}
        <span style={{ color: "#B40F1D" }}>{active.red}</span>
      </div>
    </div>
  );
};

const HeroFigure: React.FC<{ frame: number; compact?: boolean }> = ({
  frame,
  compact = false,
}) => {
  const bob = Math.sin(frame * 0.12) * 5;
  const shirtLift = interpolate(frame, [18, 34], [0, -42], clamp);
  const shrug = interpolate(frame, [106, 126], [0, 1], clamp);

  return (
    <div
      style={{
        position: "absolute",
        left: compact ? 308 : 292,
        top: compact ? 250 : 235,
        width: 510,
        height: 1180,
        transform: `translateY(${bob}px)`,
      }}
    >
      <div
        style={{
          transform: `translateY(${interpolate(shrug, [0, 1], [0, -44])}px)`,
          transformOrigin: "center 300px",
        }}
      >
        <Head />
        <Torso shirtLift={shirtLift} shrug={shrug} />
        <Legs />
      </div>
    </div>
  );
};

const Head = () => (
  <div
    style={{
      position: "absolute",
      left: 190,
      top: 0,
      width: 118,
      height: 154,
      borderRadius: "52% 48% 45% 45%",
      background: "#B96B3D",
      transform: "rotate(11deg)",
      border: "4px solid rgba(90,45,26,0.55)",
    }}
  >
    <div style={{ position: "absolute", left: 30, top: 54, width: 20, height: 32, borderRadius: "50%", background: "#F0E7DC" }} />
    <div style={{ position: "absolute", left: 76, top: 58, width: 20, height: 32, borderRadius: "50%", background: "#F0E7DC" }} />
    <div style={{ position: "absolute", right: 8, top: 18, color: "#eee", fontSize: 32, fontWeight: 900 }}>H</div>
  </div>
);

const Torso: React.FC<{ shirtLift?: number; shrug?: number }> = ({
  shirtLift = 0,
  shrug = 0,
}) => (
  <>
    <div
      style={{
        position: "absolute",
        left: 118,
        top: 128,
        width: 280,
        height: 395,
        borderRadius: "44% 44% 32% 32%",
        background: "linear-gradient(90deg, #8E4829, #C87945 28%, #E0A06A 50%, #9B512E 76%, #6F351F)",
        clipPath: "polygon(16% 0, 84% 0, 100% 32%, 80% 100%, 20% 100%, 0 32%)",
        border: "4px solid rgba(92,44,25,0.5)",
      }}
    >
      <AbsGrid />
    </div>
    <Arm side="left" shrug={shrug} />
    <Arm side="right" shrug={shrug} />
    <div
      style={{
        position: "absolute",
        left: 92,
        top: 110 + shirtLift,
        width: 330,
        height: 168,
        borderRadius: "48% 48% 28% 28%",
        background: "linear-gradient(#9CA0A1, #686F70)",
        border: "4px solid rgba(47,55,57,0.5)",
      }}
    />
  </>
);

const AbsGrid = () => (
  <>
    {[0, 1, 2, 3].map((row) =>
      [0, 1].map((col) => (
        <div
          key={`${row}-${col}`}
          style={{
            position: "absolute",
            left: 98 + col * 56,
            top: 74 + row * 62,
            width: 48,
            height: 58,
            borderRadius: "50%",
            background: "radial-gradient(circle at 35% 30%, #F1BD82, #A75A32 68%)",
            boxShadow: "inset 0 -7px 12px rgba(60,25,15,0.42)",
          }}
        />
      )),
    )}
    <div style={{ position: "absolute", left: 137, top: 64, width: 6, height: 286, background: "rgba(65,28,17,0.48)" }} />
  </>
);

const Arm: React.FC<{ side: "left" | "right"; shrug: number }> = ({ side, shrug }) => {
  const isLeft = side === "left";
  return (
    <div
      style={{
        position: "absolute",
        left: isLeft ? 0 : 360,
        top: 150,
        width: 150,
        height: 410,
        transform: `rotate(${isLeft ? -18 - shrug * 18 : 18 + shrug * 18}deg)`,
        transformOrigin: isLeft ? "100px 30px" : "50px 30px",
      }}
    >
      <div style={{ position: "absolute", left: 28, top: 0, width: 82, height: 210, borderRadius: 48, background: "#AF6238", boxShadow: "inset -12px -8px 0 rgba(91,40,24,0.28)" }} />
      <div style={{ position: "absolute", left: isLeft ? 54 : 16, top: 172, width: 78, height: 205, borderRadius: 42, background: "#C77A48", transform: `rotate(${isLeft ? 32 : -32}deg)`, boxShadow: "inset -10px -10px 0 rgba(91,40,24,0.25)" }} />
    </div>
  );
};

const Legs = () => (
  <>
    <div
      style={{
        position: "absolute",
        left: 146,
        top: 492,
        width: 228,
        height: 130,
        background: "#171A1E",
        clipPath: "polygon(8% 0, 92% 0, 82% 100%, 18% 100%)",
        borderRadius: 20,
      }}
    />
    <Leg left={134} rotate={4} />
    <Leg left={264} rotate={-5} />
  </>
);

const Leg: React.FC<{ left: number; rotate: number }> = ({ left, rotate }) => (
  <div
    style={{
      position: "absolute",
      left,
      top: 600,
      width: 105,
      height: 500,
      transform: `rotate(${rotate}deg)`,
      transformOrigin: "50% 0",
    }}
  >
    <div style={{ position: "absolute", top: 0, width: 94, height: 250, borderRadius: 54, background: "#B7653A", boxShadow: "inset -14px -12px 0 rgba(86,37,22,0.27)" }} />
    <div style={{ position: "absolute", top: 226, left: 18, width: 70, height: 250, borderRadius: 38, background: "#C77A48", boxShadow: "inset -12px -12px 0 rgba(86,37,22,0.22)" }} />
    <div style={{ position: "absolute", top: 458, left: 2, width: 112, height: 34, borderRadius: "60% 20% 35% 35%", background: "#B7653A" }} />
  </div>
);

const AbsGlow = () => (
  <div
    style={{
      width: 250,
      height: 270,
      clipPath: "polygon(18% 0, 82% 0, 100% 100%, 0 100%)",
      background: "linear-gradient(180deg, #22F5B2, #42D9FF)",
      filter: "drop-shadow(0 0 18px rgba(56,232,255,0.9))",
    }}
  />
);

const AverageSilhouette = () => (
  <div style={{ width: 170, height: 470, position: "relative", filter: "drop-shadow(0 6px 4px rgba(0,0,0,0.22))" }}>
    <div style={{ position: "absolute", left: 54, top: 0, width: 62, height: 70, borderRadius: "50%", background: "#080A0B" }} />
    <div style={{ position: "absolute", left: 44, top: 64, width: 86, height: 175, borderRadius: "42% 42% 36% 36%", background: "#080A0B" }} />
    <div style={{ position: "absolute", left: 14, top: 84, width: 42, height: 210, borderRadius: 30, background: "#080A0B", transform: "rotate(11deg)" }} />
    <div style={{ position: "absolute", right: 14, top: 84, width: 42, height: 210, borderRadius: 30, background: "#080A0B", transform: "rotate(-11deg)" }} />
    <div style={{ position: "absolute", left: 48, top: 224, width: 42, height: 245, borderRadius: 28, background: "#080A0B", transform: "rotate(5deg)" }} />
    <div style={{ position: "absolute", right: 48, top: 224, width: 42, height: 245, borderRadius: 28, background: "#080A0B", transform: "rotate(-5deg)" }} />
  </div>
);
