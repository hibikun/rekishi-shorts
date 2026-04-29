import React from "react";
import { useCurrentFrame } from "remotion";
import type { DesignMotionSpec } from "@rekishi/shared";
import { resolveDesignMotionStyle } from "./presets";

export interface DesignMotionProps {
  spec: DesignMotionSpec;
  itemIndex?: number;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

export const DesignMotion: React.FC<DesignMotionProps> = ({
  spec,
  itemIndex = 0,
  children,
  className,
  style,
}) => {
  const frame = useCurrentFrame();
  const motionStyle = resolveDesignMotionStyle({ frame, spec, itemIndex });

  return (
    <div
      className={className}
      style={{
        display: "inline-block",
        ...style,
        ...motionStyle,
      }}
    >
      {children}
    </div>
  );
};
