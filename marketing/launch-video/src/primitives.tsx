import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { T } from "./theme";

/** Fade+rise entrance, driven by a spring so motion feels expensive. */
export const FadeUp: React.FC<{
  children: React.ReactNode;
  delay?: number;
  dy?: number;
  style?: React.CSSProperties;
}> = ({ children, delay = 0, dy = 28, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame: frame - delay, fps, config: { damping: 18, stiffness: 160 } });
  return (
    <div
      style={{
        opacity: interpolate(p, [0, 1], [0, 1]),
        transform: `translateY(${interpolate(p, [0, 1], [dy, 0])}px)`,
        ...style,
      }}
    >
      {children}
    </div>
  );
};

/** Scale-in from 0.94 — for panels and device frames. */
export const PopIn: React.FC<{
  children: React.ReactNode;
  delay?: number;
  style?: React.CSSProperties;
}> = ({ children, delay = 0, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame: frame - delay, fps, config: { damping: 15, stiffness: 140 } });
  return (
    <div
      style={{
        opacity: interpolate(p, [0, 0.5], [0, 1], { extrapolateRight: "clamp" }),
        transform: `scale(${interpolate(p, [0, 1], [0.94, 1])})`,
        ...style,
      }}
    >
      {children}
    </div>
  );
};

/** Characters materialize left-to-right like a streaming reply. */
export const Typewriter: React.FC<{
  text: string;
  startFrame?: number;
  charsPerFrame?: number;
  style?: React.CSSProperties;
  cursor?: boolean;
}> = ({ text, startFrame = 0, charsPerFrame = 0.9, style, cursor = false }) => {
  const frame = useCurrentFrame();
  const shown = Math.max(0, Math.floor((frame - startFrame) * charsPerFrame));
  const out = text.slice(0, shown);
  const done = shown >= text.length;
  return (
    <span style={style}>
      {out}
      {cursor && !done && frame > startFrame && (
        <span style={{ color: T.primary, opacity: frame % 16 < 9 ? 1 : 0 }}>▍</span>
      )}
    </span>
  );
};

/** A chat bubble matching the app's message rows. */
export const Bubble: React.FC<{
  role: "user" | "assistant";
  children: React.ReactNode;
  delay?: number;
  accent?: string;
  name?: string;
  compact?: boolean;
}> = ({ role, children, delay = 0, accent, name, compact }) => (
  <FadeUp delay={delay} dy={14}>
    <div
      style={{
        margin: compact ? "6px 0" : "10px 0",
        padding: compact ? "9px 14px" : "13px 18px",
        borderRadius: 14,
        maxWidth: role === "user" ? "82%" : "94%",
        marginLeft: role === "user" ? "auto" : 0,
        background: role === "user" ? "#1c2733" : T.card,
        border: role === "assistant" ? `1px solid ${T.strokeSoft}` : "none",
        borderLeft: accent ? `3px solid ${accent}` : undefined,
        color: T.text,
        fontSize: compact ? 15 : 17,
        lineHeight: 1.5,
      }}
    >
      {name && (
        <div style={{ fontSize: 12, color: accent || T.textDim, fontWeight: 700, marginBottom: 3, letterSpacing: 0.3 }}>
          {name}
        </div>
      )}
      {children}
    </div>
  </FadeUp>
);

/** Rounded device/panel shell with a title bar. */
export const Frame: React.FC<{
  children: React.ReactNode;
  kind: "desktop" | "phone";
  title?: string;
  style?: React.CSSProperties;
}> = ({ children, kind, title, style }) => (
  <div
    style={{
      background: T.chrome,
      border: `1px solid ${T.stroke}`,
      borderRadius: kind === "phone" ? 44 : 18,
      overflow: "hidden",
      boxShadow: "0 30px 80px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.04) inset",
      display: "flex",
      flexDirection: "column",
      ...style,
    }}
  >
    {kind === "desktop" ? (
      <div
        style={{
          height: 34,
          background: T.sidebar,
          borderBottom: `1px solid ${T.strokeSoft}`,
          display: "flex",
          alignItems: "center",
          padding: "0 14px",
          gap: 7,
          flexShrink: 0,
        }}
      >
        {["#e75e78", "#c08532", "#55a583"].map((c) => (
          <div key={c} style={{ width: 9, height: 9, borderRadius: 9, background: c, opacity: 0.85 }} />
        ))}
        {title && (
          <div style={{ margin: "0 auto", fontSize: 11, color: T.textFaint, fontFamily: T.font }}>{title}</div>
        )}
      </div>
    ) : (
      <div style={{ height: 30, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <div style={{ width: 90, height: 7, borderRadius: 7, background: T.stroke }} />
      </div>
    )}
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>{children}</div>
  </div>
);

/** Composer bar pinned at the bottom of a frame. */
export const Composer: React.FC<{ hint?: string }> = ({ hint = "Message…" }) => (
  <div
    style={{
      margin: 10,
      padding: "12px 16px",
      borderRadius: 12,
      background: T.elevated,
      border: `1px solid ${T.stroke}`,
      color: T.textFaint,
      fontSize: 14,
      display: "flex",
      alignItems: "center",
      flexShrink: 0,
    }}
  >
    {hint}
    <div
      style={{
        marginLeft: "auto",
        width: 26,
        height: 26,
        borderRadius: 8,
        background: T.primary,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#fff",
        fontSize: 13,
      }}
    >
      ↑
    </div>
  </div>
);

/** Beat-synced flash word. */
export const FlashWord: React.FC<{ word: string; color?: string }> = ({ word, color }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame, fps, config: { damping: 14, stiffness: 200 } });
  return (
    <div
      style={{
        fontFamily: T.font,
        fontWeight: 800,
        fontSize: 96,
        color: color || T.text,
        transform: `scale(${interpolate(p, [0, 1], [0.7, 1])})`,
        opacity: p,
        letterSpacing: -2,
      }}
    >
      {word}
    </div>
  );
};

/** Caption pill — the big readable text over a scene. */
export const Caption: React.FC<{
  children: React.ReactNode;
  delay?: number;
  size?: number;
  color?: string;
  dim?: boolean;
  align?: "center" | "left";
}> = ({ children, delay = 0, size = 44, color, dim, align = "center" }) => (
  <FadeUp delay={delay} dy={20}>
    <div
      style={{
        fontFamily: T.font,
        fontWeight: 700,
        fontSize: size,
        lineHeight: 1.15,
        color: color || (dim ? T.textDim : T.text),
        textAlign: align,
        letterSpacing: -0.8,
        padding: "0 30px",
        // Narrower than the canvas so the Backdrop's portrait scale-up can
        // never push glyphs past the frame edge.
        maxWidth: 820,
      }}
    >
      {children}
    </div>
  </FadeUp>
);

/** A subtle dot-grid + vignette backdrop every scene sits on. Scales its
 *  contents up on the portrait canvas so mock UI fills the phone frame. */
export const Backdrop: React.FC<{ children: React.ReactNode; glow?: string }> = ({ children, glow }) => {
  const { width } = useVideoConfig();
  const scale = Math.min(1.12, Math.max(1, width / 960));
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: T.sidebar,
        backgroundImage: `radial-gradient(circle at 50% ${glow ? "30%" : "50%"}, ${glow || "rgba(0,83,253,0.08)"} 0%, transparent 55%), radial-gradient(${T.strokeSoft} 1px, transparent 1px)`,
        backgroundSize: "100% 100%, 26px 26px",
        fontFamily: T.font,
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "space-evenly",
          padding: "6% 0",
          transform: `scale(${scale})`,
          transformOrigin: "center",
        }}
      >
        {children}
      </div>
    </div>
  );
};
