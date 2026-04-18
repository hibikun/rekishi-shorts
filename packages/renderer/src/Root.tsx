import React from "react";
import { Composition } from "remotion";
import { VIDEO_FPS, VIDEO_HEIGHT, VIDEO_WIDTH } from "@rekishi/shared";
import { HistoryShort, type HistoryShortProps } from "./compositions/HistoryShort.js";

const defaultProps: HistoryShortProps = {
  scenes: [],
  images: [],
  audioSrc: "",
  captions: [],
  totalDurationSec: 60,
};

const HistoryShortComponent = HistoryShort as unknown as React.FC<Record<string, unknown>>;

export const Root: React.FC = () => {
  return (
    <>
      <Composition
        id="HistoryShort"
        component={HistoryShortComponent}
        durationInFrames={VIDEO_FPS * 60}
        fps={VIDEO_FPS}
        width={VIDEO_WIDTH}
        height={VIDEO_HEIGHT}
        defaultProps={defaultProps as unknown as Record<string, unknown>}
      />
    </>
  );
};
