import React from "react";
import { Composition, Sequence } from "remotion";
import {
  AnywhereScene,
  BotModeScene,
  CTAScene,
  FeatureFlashScene,
  HookScene,
  ProblemScene,
  RealWorkScene,
  RevealScene,
} from "./scenes";

// 30fps · storyboard from the launch plan: hook → problem → reveal →
// bot mode → real work → anywhere → flash → CTA ≈ 49s.
const CUTS: Array<[React.FC, number]> = [
  [HookScene, 120], // 0–4s
  [ProblemScene, 120], // 4–8s
  [RevealScene, 150], // 8–13s
  [BotModeScene, 270], // 13–22s
  [RealWorkScene, 240], // 22–30s
  [AnywhereScene, 240], // 30–38s
  [FeatureFlashScene, 190], // 38–44.3s
  [CTAScene, 150], // –49.3s
];

const Timeline: React.FC = () => {
  let at = 0;
  return (
    <>
      {CUTS.map(([Scene, dur], i) => {
        const from = at;
        at += dur;
        return (
          <Sequence key={i} from={from} durationInFrames={dur}>
            <Scene />
          </Sequence>
        );
      })}
    </>
  );
};

const DURATION = CUTS.reduce((a, [, d]) => a + d, 0); // 1480

export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="HermesLaunch-9x16"
      component={Timeline}
      durationInFrames={DURATION}
      fps={30}
      width={1080}
      height={1920}
    />
    <Composition
      id="HermesLaunch-16x9"
      component={Timeline}
      durationInFrames={DURATION}
      fps={30}
      width={1920}
      height={1080}
    />
  </>
);
