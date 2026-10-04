/** Overlay styles — injected into the shadow root. Everything is prefixed
 *  `hr-` and the host is `all: initial`-boxed so page CSS can't bleed in. */
export const OVERLAY_CSS = `
:host { all: initial; }
* { box-sizing: border-box; font-family: -apple-system, 'SF Pro', Inter, system-ui, sans-serif; }

.hr-canvas {
  position: fixed; inset: 0; width: 100vw; height: 100vh;
  pointer-events: none; z-index: 2147483640;
}

.hr-hit {
  position: fixed; width: 96px; height: 96px; z-index: 2147483642;
  cursor: grab; pointer-events: auto; touch-action: none;
  transform: translate(-50%, -50%);
  border-radius: 50%;
}
.hr-hit:active { cursor: grabbing; }
.hr-hit .hr-name {
  position: absolute; left: 50%; top: 100%; transform: translateX(-50%);
  margin-top: 2px; padding: 2px 8px; border-radius: 10px;
  background: rgba(12,14,20,.85); color: #fff; font-size: 11px;
  font-weight: 600; white-space: nowrap; letter-spacing: .2px;
  opacity: 0; transition: opacity .15s; pointer-events: none;
  backdrop-filter: blur(6px);
}
.hr-hit:hover .hr-name, .hr-hit.dragging .hr-name { opacity: 1; }
.hr-hit.dragging { cursor: grabbing; }
.hr-hit .hr-badge {
  position: absolute; right: 6px; top: 6px; min-width: 18px; height: 18px;
  border-radius: 9px; background: #ff4d6d; color: #fff; font-size: 10px;
  font-weight: 700; display: none; align-items: center; justify-content: center;
  padding: 0 5px; box-shadow: 0 1px 4px rgba(0,0,0,.4);
}
.hr-hit.working .hr-badge { display: flex; }

.hr-panel {
  position: fixed; z-index: 2147483644; width: 300px;
  background: rgba(16,18,26,.96); border: 1px solid rgba(255,255,255,.09);
  border-radius: 14px; color: #e8eaf2; font-size: 13px;
  box-shadow: 0 12px 40px rgba(0,0,0,.5), 0 2px 8px rgba(0,0,0,.3);
  backdrop-filter: blur(14px); overflow: hidden; pointer-events: auto;
  display: flex; flex-direction: column;
}
.hr-panel-head {
  display: flex; align-items: center; gap: 8px; padding: 10px 12px;
  border-bottom: 1px solid rgba(255,255,255,.06);
}
.hr-panel-head .hr-dot { width: 8px; height: 8px; border-radius: 50%; }
.hr-panel-head .hr-title { font-weight: 650; flex: 1; font-size: 13px; }
.hr-panel-head .hr-status { font-size: 11px; opacity: .65; }
.hr-panel-x { background: none; border: 0; color: #9aa; cursor: pointer; font-size: 15px; padding: 2px 6px; border-radius: 6px; }
.hr-panel-x:hover { background: rgba(255,255,255,.08); }

.hr-panel-log {
  flex: 1; min-height: 60px; max-height: 260px; overflow-y: auto;
  padding: 10px 12px; display: flex; flex-direction: column; gap: 8px;
}
.hr-msg { max-width: 88%; padding: 7px 10px; border-radius: 12px; line-height: 1.4; font-size: 12.5px; }
.hr-msg.user { align-self: flex-end; background: #3b5bff; color: #fff; border-bottom-right-radius: 4px; }
.hr-msg.bot { align-self: flex-start; background: rgba(255,255,255,.08); border-bottom-left-radius: 4px; }
.hr-msg .hr-who { font-size: 10px; opacity: .6; margin-bottom: 2px; font-weight: 650; }
.hr-msg.sys { align-self: center; background: none; opacity: .55; font-size: 11px; padding: 2px; }

.hr-composer {
  display: flex; gap: 6px; padding: 10px; border-top: 1px solid rgba(255,255,255,.06);
  align-items: flex-end;
}
.hr-composer textarea {
  flex: 1; resize: none; border: 1px solid rgba(255,255,255,.1); background: rgba(0,0,0,.25);
  color: #e8eaf2; border-radius: 10px; padding: 8px 10px; font-size: 12.5px;
  font-family: inherit; outline: none; min-height: 36px; max-height: 90px;
}
.hr-composer textarea:focus { border-color: #5470ff; }
.hr-btn {
  border: 0; border-radius: 10px; padding: 8px 10px; cursor: pointer;
  background: rgba(255,255,255,.08); color: #e8eaf2; font-size: 14px;
  display: flex; align-items: center; justify-content: center;
}
.hr-btn:hover { background: rgba(255,255,255,.14); }
.hr-btn.send { background: #3b5bff; color: #fff; }
.hr-btn.mic.on { background: #ff4d6d; color: #fff; animation: hr-pulse 1.2s infinite; }
@keyframes hr-pulse { 50% { box-shadow: 0 0 0 6px rgba(255,77,109,.25); } }

.hr-target-chip {
  display: flex; align-items: center; gap: 6px; margin: 0 12px 8px;
  padding: 6px 9px; background: rgba(84,112,255,.15); border: 1px solid rgba(84,112,255,.3);
  border-radius: 8px; font-size: 11px;
}
.hr-target-chip .hr-x { margin-left: auto; cursor: pointer; opacity: .7; }

.hr-launcher {
  position: fixed; right: 14px; bottom: 14px; z-index: 2147483641;
  width: 46px; height: 46px; border-radius: 50%; pointer-events: auto;
  background: rgba(16,18,26,.9); border: 1px solid rgba(255,255,255,.12);
  box-shadow: 0 6px 24px rgba(0,0,0,.45); cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  backdrop-filter: blur(10px); transition: transform .15s;
}
.hr-launcher:hover { transform: scale(1.08); }
.hr-launcher svg { width: 26px; height: 26px; }

.hr-roombar {
  position: fixed; left: 50%; bottom: 14px; transform: translateX(-50%);
  z-index: 2147483641; display: flex; gap: 8px; pointer-events: auto;
}
.hr-room {
  display: flex; align-items: center; gap: 6px; padding: 6px 12px;
  background: rgba(16,18,26,.9); border: 1px solid rgba(255,255,255,.1);
  border-radius: 20px; color: #e8eaf2; font-size: 12px; cursor: pointer;
  backdrop-filter: blur(10px); box-shadow: 0 4px 16px rgba(0,0,0,.4);
  transition: border-color .15s;
}
.hr-room:hover { border-color: rgba(84,112,255,.5); }
.hr-room .hr-faces { display: flex; }
.hr-room .hr-face { width: 20px; height: 20px; border-radius: 50%; margin-left: -6px; border: 1.5px solid rgba(16,18,26,.9); background: #333; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 700; color: #fff; }
.hr-room .hr-face:first-child { margin-left: 0; }

.hr-addroom {
  position: fixed; left: 14px; bottom: 14px; z-index: 2147483641;
  width: 40px; height: 40px; border-radius: 50%; pointer-events: auto;
  background: rgba(16,18,26,.9); border: 1.5px dashed rgba(255,255,255,.25);
  color: #cfd3e0; font-size: 20px; cursor: pointer; backdrop-filter: blur(10px);
}
.hr-addroom:hover { border-color: #5470ff; color: #fff; }

.hr-dropzone {
  position: fixed; inset: 0; z-index: 2147483639; pointer-events: none;
  background: rgba(59,91,255,.06); border: 3px dashed rgba(84,112,255,.5);
  opacity: 0; transition: opacity .15s;
}
.hr-dropzone.on { opacity: 1; }
.hr-dropzone .hr-dz-label {
  position: absolute; left: 50%; top: 18px; transform: translateX(-50%);
  background: rgba(16,18,26,.92); color: #fff; padding: 8px 16px;
  border-radius: 20px; font-size: 12px; font-weight: 600;
}

.hr-eloutline {
  position: fixed; z-index: 2147483643; pointer-events: none;
  border: 2px solid #5470ff; border-radius: 4px;
  background: rgba(84,112,255,.12); transition: all .1s;
}
.hr-ghost {
  position: fixed; z-index: 2147483645; pointer-events: none;
  font-size: 11px; color: #fff; background: rgba(16,18,26,.9);
  padding: 3px 8px; border-radius: 8px; transform: translate(-50%, -120%);
}
`
