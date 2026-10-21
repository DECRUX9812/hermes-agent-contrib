import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { Backdrop, Bubble, Caption, Composer, FadeUp, FlashWord, Frame, PopIn, Typewriter } from "./primitives";
import { T } from "./theme";

/* 1 · HOOK — a reply that survives a page reload (0–4s) */
export const HookScene: React.FC = () => {
  const frame = useCurrentFrame();
  // Reload flash sweeps the phone at ~frame 55; the stream keeps going through it.
  const flash = interpolate(frame, [52, 58, 72, 80], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <Backdrop glow="rgba(0,83,253,0.10)">
      <PopIn delay={4}>
        <Frame kind="phone" style={{ width: 340, height: 600 }}>
          <div style={{ flex: 1, padding: "14px 14px 0", overflow: "hidden" }}>
            <Bubble role="user" compact delay={8}>
              refactor the auth module
            </Bubble>
            <Bubble role="assistant" compact delay={20}>
              <Typewriter
                startFrame={26}
                charsPerFrame={1.4}
                cursor
                text="Splitting auth.ts into session, tokens and providers — running the suite after each move."
              />
            </Bubble>
          </div>
          <Composer />
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "rgba(10,10,11,0.94)",
              opacity: flash,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 10,
            }}
          >
            <div style={{ fontSize: 42, color: T.textDim }}>⟳</div>
            <div style={{ fontSize: 13, color: T.textFaint, fontFamily: T.font }}>reconnecting…</div>
          </div>
        </Frame>
      </PopIn>
      <div style={{ height: 36 }} />
      <Caption delay={66} size={40}>
        this reply survives a <span style={{ color: T.primary }}>page reload</span>
      </Caption>
    </Backdrop>
  );
};

/* 2 · PROBLEM — every other tool is one chat box (4–8s) */
export const ProblemScene: React.FC = () => {
  const boxes = ["one agent", "one window", "one hope"];
  return (
    <Backdrop glow="rgba(0,0,0,0)">
      <div style={{ display: "flex", flexDirection: "column", gap: 22, width: 560 }}>
        {boxes.map((b, i) => (
          <FadeUp key={b} delay={i * 18}>
            <div
              style={{
                padding: "22px 26px",
                borderRadius: 14,
                background: "#101013",
                border: `1px solid ${T.strokeSoft}`,
                display: "flex",
                alignItems: "center",
                gap: 16,
                opacity: 0.55,
              }}
            >
              <div style={{ width: 34, height: 34, borderRadius: 9, background: T.stroke }} />
              <div style={{ fontSize: 21, color: T.textDim, fontWeight: 600 }}>{b}.</div>
              <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                {[0, 1, 2].map((d) => (
                  <div key={d} style={{ width: 44, height: 7, borderRadius: 7, background: T.strokeSoft }} />
                ))}
              </div>
            </div>
          </FadeUp>
        ))}
      </div>
      <div style={{ height: 40 }} />
      <Caption delay={58} size={42} dim>
        every AI app gives you a chat box.
      </Caption>
    </Backdrop>
  );
};

/* 3 · REVEAL — HERMES (8–13s) */
export const RevealScene: React.FC = () => {
  const frame = useCurrentFrame();
  const glow = interpolate(frame, [0, 40], [0.05, 0.22], { extrapolateRight: "clamp" });
  return (
    <Backdrop glow={`rgba(0,83,253,${glow})`}>
      <FadeUp delay={6} dy={34}>
        <div
          style={{
            fontSize: 148,
            fontWeight: 900,
            letterSpacing: -4,
            background: `linear-gradient(180deg, ${T.text} 30%, ${T.primary} 130%)`,
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}
        >
          HERMES
        </div>
      </FadeUp>
      <Caption delay={34} size={40} dim>
        a team of agents, not a chat.
      </Caption>
    </Backdrop>
  );
};

/* 4 · BOT MODE — bots that @mention each other (13–22s) */
export const BotModeScene: React.FC = () => (
  <Backdrop>
    <PopIn delay={4}>
      <Frame kind="desktop" title="Hermes — Team Room" style={{ width: 720, height: 560 }}>
        <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
          {/* roster */}
          <div
            style={{
              width: 150,
              background: T.sidebar,
              borderRight: `1px solid ${T.strokeSoft}`,
              padding: "14px 10px",
            }}
          >
            {[
              ["lead", T.primary],
              ["scout", T.cyan],
              ["builder", T.green],
              ["reviewer", T.purple],
            ].map(([n, c], i) => (
              <FadeUp key={n} delay={10 + i * 6}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 8px", borderRadius: 8 }}>
                  <div
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: 7,
                      background: c,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 11,
                      fontWeight: 800,
                      color: "#0a0a0b",
                    }}
                  >
                    {n[0].toUpperCase()}
                  </div>
                  <div style={{ fontSize: 13, color: T.textDim, fontWeight: 600 }}>{n}</div>
                </div>
              </FadeUp>
            ))}
            <FadeUp delay={40}>
              <div
                style={{
                  marginTop: 12,
                  fontSize: 10,
                  color: T.textFaint,
                  textTransform: "uppercase",
                  letterSpacing: 1,
                  padding: "0 8px",
                }}
              >
                bot mode
              </div>
            </FadeUp>
          </div>
          {/* team room */}
          <div style={{ flex: 1, padding: "16px 16px 0", overflow: "hidden" }}>
            <Bubble role="assistant" compact name="lead" accent={T.primary} delay={16}>
              <span style={{ color: T.cyan }}>@scout</span> map the payment flow,{" "}
              <span style={{ color: T.green }}>@builder</span> prep the branch
            </Bubble>
            <Bubble role="assistant" compact name="scout" accent={T.cyan} delay={52}>
              4 call sites found — posting the map to the room
            </Bubble>
            <Bubble role="assistant" compact name="builder" accent={T.green} delay={88}>
              branch ready, tests green · handing to{" "}
              <span style={{ color: T.purple }}>@reviewer</span>
            </Bubble>
            <Bubble role="assistant" compact name="reviewer" accent={T.purple} delay={124}>
              approved — diff is clean, shipping it
            </Bubble>
          </div>
        </div>
      </Frame>
    </PopIn>
    <div style={{ height: 34 }} />
    <Caption delay={60} size={38}>
      bots that <span style={{ color: T.primary }}>@mention each other</span> and split the work
    </Caption>
  </Backdrop>
);

/* 5 · REAL WORK — editor + terminal + PR in one place (22–30s) */
export const RealWorkScene: React.FC = () => (
  <Backdrop>
    <PopIn delay={4}>
      <Frame kind="desktop" title="Hermes" style={{ width: 760, height: 560 }}>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
          {/* diff pane */}
          <div
            style={{
              flex: 1.25,
              padding: "16px 20px",
              fontFamily: T.mono,
              fontSize: 14.5,
              lineHeight: 1.75,
              borderBottom: `1px solid ${T.strokeSoft}`,
            }}
          >
            <FadeUp delay={10}>
              <div style={{ color: T.textFaint }}>src/auth/session.ts</div>
            </FadeUp>
            {[
              ["+", "const session = await issue(user, ttl)", T.green],
              ["+", "audit.log('login', session.id)", T.green],
              ["-", "sessions.push(new Session(user))", T.red],
            ].map(([sign, line, c], i) => (
              <FadeUp key={i} delay={16 + i * 9}>
                <div style={{ color: c, whiteSpace: "pre" }}>
                  {sign} {line}
                </div>
              </FadeUp>
            ))}
          </div>
          {/* terminal pane */}
          <div
            style={{
              flex: 1,
              padding: "14px 20px",
              fontFamily: T.mono,
              fontSize: 14,
              background: "#0a0a0c",
            }}
          >
            <FadeUp delay={46}>
              <div>
                <span style={{ color: T.primary }}>$</span>{" "}
                <Typewriter startFrame={50} charsPerFrame={1.3} text="hermes run npm test" />
              </div>
            </FadeUp>
            <FadeUp delay={78}>
              <div style={{ color: T.green }}>✓ 47 passed · 0 failed</div>
            </FadeUp>
            <FadeUp delay={96}>
              <div>
                <span style={{ color: T.primary }}>$</span>{" "}
                <Typewriter startFrame={100} charsPerFrame={1.3} text="git_ship → open_pr" />
              </div>
            </FadeUp>
          </div>
          {/* PR strip */}
          <FadeUp delay={140}>
            <div
              style={{
                margin: "12px 16px",
                padding: "12px 16px",
                borderRadius: 12,
                background: T.primarySoft,
                border: `1px solid ${T.primary}55`,
                display: "flex",
                alignItems: "center",
                gap: 10,
                fontSize: 14.5,
                color: T.text,
                fontWeight: 600,
              }}
            >
              <span style={{ color: T.primary }}>⑂</span> PR #142 opened — feat: session-aware login
              <span style={{ marginLeft: "auto", color: T.green, fontSize: 13 }}>merged-ready</span>
            </div>
          </FadeUp>
        </div>
      </Frame>
    </PopIn>
    <div style={{ height: 34 }} />
    <Caption delay={110} size={38}>
      it edits, tests, and <span style={{ color: T.primary }}>opens the PR</span> — you review
    </Caption>
  </Backdrop>
);

/* 6 · ANYWHERE — same session, every surface (30–38s) */
export const AnywhereScene: React.FC = () => {
  const frame = useCurrentFrame();
  // The session content is IDENTICAL in both frames — that's the point.
  const session = (
    <>
      <Bubble role="user" compact delay={6}>
        keep going on the auth refactor
      </Bubble>
      <Bubble role="assistant" compact delay={24}>
        <Typewriter startFrame={30} charsPerFrame={1.2} text="Picking up exactly where we left off — diff is in review, extending coverage on token refresh." />
      </Bubble>
    </>
  );
  const slide = interpolate(frame, [96, 130], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <Backdrop glow="rgba(0,83,253,0.07)">
      <div style={{ display: "flex", alignItems: "center", gap: 0, position: "relative" }}>
        <PopIn delay={4}>
          <Frame kind="desktop" title="Hermes" style={{ width: 620, height: 460 }}>
            <div style={{ flex: 1, padding: "16px 16px 0" }}>{session}</div>
            <Composer />
          </Frame>
        </PopIn>
        <div
          style={{
            position: "absolute",
            right: -60,
            bottom: -30,
            transform: `translateY(${interpolate(slide, [0, 1], [140, 0])}px)`,
            opacity: slide,
          }}
        >
          <Frame kind="phone" style={{ width: 270, height: 490 }}>
            <div style={{ flex: 1, padding: "10px 10px 0", overflow: "hidden" }}>{session}</div>
            <Composer hint="Same session…" />
          </Frame>
        </div>
      </div>
      <div style={{ height: 50 }} />
      <Caption delay={120} size={38}>
        same app, <span style={{ color: T.primary }}>every surface</span>
      </Caption>
    </Backdrop>
  );
};

/* 7 · FEATURE FLASH — beat words (38–44s) */
export const FeatureFlashScene: React.FC = () => {
  const frame = useCurrentFrame();
  const words: Array<[number, string, string | undefined]> = [
    [0, "bots that learn", T.primary],
    [46, "any model", undefined],
    [92, "open source", T.green],
    [138, "free", T.text],
  ];
  const current = words.filter(([f]) => frame >= f).pop() || words[0];
  const local = frame - current[0];
  const out = interpolate(local, [34, 46], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <Backdrop>
      <div style={{ opacity: out }}>
        <FlashWord word={current[1]} color={current[2]} />
      </div>
    </Backdrop>
  );
};

/* 8 · CTA (44–48s) */
export const CTAScene: React.FC = () => (
  <Backdrop glow="rgba(0,83,253,0.14)">
    <FadeUp delay={4}>
      <div style={{ fontSize: 84, fontWeight: 900, letterSpacing: -3, color: T.text }}>HERMES</div>
    </FadeUp>
    <FadeUp delay={22}>
      <div
        style={{
          marginTop: 26,
          padding: "16px 34px",
          borderRadius: 14,
          background: T.card,
          border: `1px solid ${T.stroke}`,
          fontFamily: T.mono,
          fontSize: 26,
          color: T.text,
        }}
      >
        github.com/<span style={{ color: T.primary }}>NousResearch/hermes-agent</span>
      </div>
    </FadeUp>
    <FadeUp delay={44}>
      <div style={{ marginTop: 26, fontSize: 22, color: T.textDim, fontWeight: 600 }}>
        ⭐ star it · run it · put your agents to work
      </div>
    </FadeUp>
  </Backdrop>
);
