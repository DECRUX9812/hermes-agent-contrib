/**
 * The HUD's own markup, in one place: the PiP window gets it injected, and any
 * fallback window renders the same string, so the two can never drift.
 */
export const hudMarkup = () => `
  <header class="hd">
    <div class="hd-title"><span class="dot-idle"></span><strong>Hermes</strong></div>
    <div id="live" class="live hidden" role="status" aria-live="polite">
      <span class="live-dot"></span><span id="live-label"></span>
    </div>
  </header>

  <section class="card grow">
    <div class="row">
      <button id="share" class="btn btn-primary" type="button">Share screen</button>
      <button id="stop" class="btn btn-danger" type="button" disabled>Stop</button>
    </div>
    <video id="preview" class="preview hidden" autoplay muted playsinline></video>
  </section>

  <section class="card">
    <textarea id="task" class="input" rows="2" placeholder="Ask Hermes…"></textarea>
    <div class="row">
      <button id="ask" class="btn btn-primary" type="button">Ask</button>
      <span id="status" class="status">Not sharing</span>
    </div>
  </section>

  <section id="error" class="error hidden" role="alert">
    <strong id="error-title"></strong>
    <p id="error-body"></p>
    <button id="error-dismiss" class="btn btn-quiet" type="button">Dismiss</button>
  </section>

  <ul id="log" class="log grow"></ul>
`
