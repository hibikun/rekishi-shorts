import React from "react";
import { useCurrentFrame } from "remotion";
import type { DesignMotionSpec, DesignMotionTarget } from "@rekishi/shared";
import { resolveDesignMotionStyle } from "./presets";

export interface TextMotionProps {
  spec: DesignMotionSpec;
  text: string;
  className?: string;
  style?: React.CSSProperties;
  unitStyle?: React.CSSProperties;
}

interface TextUnit {
  text: string;
  animated: boolean;
  breakAfter?: boolean;
}

export const TextMotion: React.FC<TextMotionProps> = ({
  spec,
  text,
  className,
  style,
  unitStyle,
}) => {
  const frame = useCurrentFrame();
  const target = normalizeTextTarget(spec);
  const units = React.useMemo(() => splitText(text, target), [text, target]);

  if (target === "element") {
    const motionStyle = resolveDesignMotionStyle({ frame, spec });
    return (
      <span className={className} style={{ display: "inline-block", ...style, ...motionStyle }}>
        {text}
      </span>
    );
  }

  return (
    <span className={className} style={style}>
      {units.map((unit, index) => {
        if (!unit.animated) {
          return <React.Fragment key={`space-${index}`}>{unit.text}</React.Fragment>;
        }

        const motionStyle = resolveDesignMotionStyle({
          frame,
          spec: target === "character" && spec.preset === "typewriter"
            ? { ...spec, preset: "fade", target }
            : { ...spec, target },
          itemIndex: animatedIndex(units, index),
        });

        return (
          <React.Fragment key={`${unit.text}-${index}`}>
            <span
              style={{
                display: "inline-block",
                whiteSpace: "pre",
                ...unitStyle,
                ...motionStyle,
              }}
            >
              {unit.text}
            </span>
            {unit.breakAfter && <br />}
          </React.Fragment>
        );
      })}
    </span>
  );
};

function normalizeTextTarget(spec: DesignMotionSpec): DesignMotionTarget {
  if (spec.preset === "typewriter" && spec.target === "element") return "character";
  return spec.target;
}

function splitText(text: string, target: DesignMotionTarget): TextUnit[] {
  if (target === "line") {
    return text.split("\n").flatMap((line, index, lines) => [
      { text: line, animated: line.length > 0, breakAfter: index < lines.length - 1 },
    ]);
  }

  if (target === "word") {
    return splitWords(text);
  }

  if (target === "character") {
    return Array.from(text).map((char) => ({
      text: char,
      animated: char.trim().length > 0,
    }));
  }

  return [{ text, animated: true }];
}

function splitWords(text: string): TextUnit[] {
  const Segmenter = Intl.Segmenter;
  if (Segmenter) {
    const segmenter = new Segmenter("ja", { granularity: "word" });
    return Array.from(segmenter.segment(text)).map((part) => ({
      text: part.segment,
      animated: part.isWordLike ?? part.segment.trim().length > 0,
    }));
  }

  return text.split(/(\s+)/).map((part) => ({
    text: part,
    animated: part.trim().length > 0,
  }));
}

function animatedIndex(units: TextUnit[], index: number): number {
  let count = 0;
  for (let i = 0; i < index; i++) {
    if (units[i]?.animated) count += 1;
  }
  return count;
}
