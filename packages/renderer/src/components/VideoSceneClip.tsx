import React from "react";
import { AbsoluteFill, OffthreadVideo } from "remotion";

export const VideoSceneClip: React.FC<{ src: string }> = ({ src }) => {
  if (!src) {
    return <AbsoluteFill style={{ backgroundColor: "#050505" }} />;
  }

  return (
    <AbsoluteFill style={{ backgroundColor: "#050505", overflow: "hidden" }}>
      <OffthreadVideo
        src={src}
        muted
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
        }}
      />
    </AbsoluteFill>
  );
};
