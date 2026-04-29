import React from "react";
import { AbsoluteFill, Sequence, useVideoConfig } from "remotion";
import type { CaptionSegment, MotionGrammar } from "@rekishi/shared";
import { Caption } from "../components/Caption";
import { SceneMotion } from "../components/SceneMotion";
import { resolveMotionGrammar } from "../motion";

const SCENE_SEC = 1.8;

interface ShowcaseScene {
  title: string;
  detail: string;
  caption: string;
  color: string;
  motion: MotionGrammar;
}

const scenes: ShowcaseScene[] = [
  {
    title: "radial-zoom-blur",
    detail: "素材は変えず、中心へ吸い込むブラーだけを足す",
    caption: "中心へ一気に吸い込む",
    color: "#27313A",
    motion: {
      transitionIn: "radial-zoom-blur",
      transitionOut: "none",
      cameraMove: "locked",
      energy: "high",
      sfxCue: "whoosh",
      emphasisWords: ["中心"],
    },
  },
  {
    title: "snap-zoom + impact-zoom",
    detail: "冒頭フック向け。最初に一瞬押し込む",
    caption: "冒頭で一気に掴む",
    color: "#234E70",
    motion: {
      transitionIn: "snap-zoom",
      transitionOut: "whip",
      cameraMove: "impact-zoom",
      energy: "high",
      sfxCue: "hit",
      emphasisWords: ["冒頭"],
    },
  },
  {
    title: "blur-pop",
    detail: "数字・意外性・結論を出す時のブラー出現",
    caption: "記憶力が40%低下",
    color: "#7C2D35",
    motion: {
      transitionIn: "blur-pop",
      transitionOut: "whip",
      cameraMove: "impact-zoom",
      energy: "high",
      sfxCue: "pop",
      emphasisWords: ["40%低下"],
    },
  },
  {
    title: "focus-in + pull-in",
    detail: "Premiere / CapCut 風。ぼけた状態から中心へ引き込む",
    caption: "重要概念にフォーカス",
    color: "#1F3A5F",
    motion: {
      transitionIn: "focus-in",
      transitionOut: "whip",
      cameraMove: "pull-in",
      energy: "high",
      sfxCue: "pop",
      emphasisWords: ["フォーカス"],
    },
  },
  {
    title: "swipe-left",
    detail: "通常の場面転換。右から左へ差し込む",
    caption: "次の場面へ切り替える",
    color: "#2F5D50",
    motion: {
      transitionIn: "swipe-left",
      transitionOut: "none",
      cameraMove: "slow-push",
      energy: "mid",
      sfxCue: "whoosh",
      emphasisWords: ["切り替える"],
    },
  },
  {
    title: "swipe-right",
    detail: "左右交互に使って単調さを避ける",
    caption: "反対方向から入れる",
    color: "#5B4B8A",
    motion: {
      transitionIn: "swipe-right",
      transitionOut: "push-away",
      cameraMove: "drift",
      energy: "mid",
      sfxCue: "whoosh",
      emphasisWords: ["反対方向"],
    },
  },
  {
    title: "focus-out",
    detail: "締め・余韻。最後にピントが外れて消える",
    caption: "余韻を残して終わる",
    color: "#5F4B32",
    motion: {
      transitionIn: "hard-cut",
      transitionOut: "focus-out",
      cameraMove: "slow-push",
      energy: "low",
      sfxCue: "none",
      emphasisWords: ["余韻"],
    },
  },
  {
    title: "caption pop + keyword pulse",
    detail: "字幕全体がポップし、強調語だけ少し膨らむ",
    caption: "2倍以上 定着する",
    color: "#334155",
    motion: {
      transitionIn: "blur-pop",
      transitionOut: "focus-out",
      cameraMove: "impact-zoom",
      energy: "high",
      sfxCue: "pop",
      emphasisWords: ["2倍以上", "定着"],
    },
  },
];

export const MOTION_SHOWCASE_DURATION_SEC = scenes.length * SCENE_SEC;

export const MotionShowcase: React.FC = () => {
  const { fps } = useVideoConfig();
  const durationFrames = Math.round(SCENE_SEC * fps);
  const captionSegments: CaptionSegment[] = scenes.map((scene, index) => ({
    text: scene.caption,
    startSec: index * SCENE_SEC,
    endSec: (index + 1) * SCENE_SEC,
  }));
  const keyTerms = [...new Set(scenes.flatMap((scene) => scene.motion.emphasisWords ?? []))];

  return (
    <AbsoluteFill style={{ backgroundColor: "#0B0F14" }}>
      {scenes.map((scene, index) => {
        const motion = resolveMotionGrammar(scene.motion, {
          index,
          totalScenes: scenes.length,
          narration: scene.caption,
        });
        return (
          <Sequence
            key={scene.title}
            from={index * durationFrames}
            durationInFrames={durationFrames}
          >
            <SceneMotion durationFrames={durationFrames} motion={motion}>
              <ShowcasePanel scene={scene} index={index} />
            </SceneMotion>
          </Sequence>
        );
      })}
      <Caption captionSegments={captionSegments} keyTerms={keyTerms} />
    </AbsoluteFill>
  );
};

const ShowcasePanel: React.FC<{ scene: ShowcaseScene; index: number }> = ({
  scene,
  index,
}) => {
  return (
    <AbsoluteFill
      style={{
        background: scene.color,
        color: "#FFFFFF",
        fontFamily:
          '"Hiragino Kaku Gothic ProN", "Noto Sans CJK JP", "Noto Sans JP", sans-serif',
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 80,
      }}
    >
      <div style={{ width: "100%", textAlign: "center" }}>
        <div
          style={{
            fontSize: 42,
            letterSpacing: 0,
            opacity: 0.8,
            marginBottom: 28,
          }}
        >
          EFFECT {index + 1}
        </div>
        <div
          style={{
            fontSize: 82,
            lineHeight: 1.05,
            fontWeight: 900,
            letterSpacing: 0,
            textShadow: "0 5px 18px rgba(0,0,0,0.45)",
          }}
        >
          {scene.title}
        </div>
        <div
          style={{
            marginTop: 36,
            fontSize: 38,
            lineHeight: 1.35,
            fontWeight: 700,
            opacity: 0.9,
          }}
        >
          {scene.detail}
        </div>
      </div>
    </AbsoluteFill>
  );
};
