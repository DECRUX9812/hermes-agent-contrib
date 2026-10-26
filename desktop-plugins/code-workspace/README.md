# VS Code — Hermes Desktop plugin

A **real, full VS Code** embedded as a smooth pane inside the Hermes desktop
app, served by [code-server](https://github.com/coder/code-server) running on
your host VM. Files are the VM's real filesystem; editing, IntelliSense,
themes, integrated terminal, and extensions are genuine VS Code.

## Architecture
```
Laptop (Hermes desktop app)  ──Tailscale──▶  VM 127.0.0.1:8080 (code-server)
        Code pane (iframe)                        │
                                                  └─ /home/user and the whole VM FS
```
The plugin is just an `<iframe>` into code-server, so scrolling, navigation,
and editing are native VS Code — no jank.

## Server setup (one-time, on the VM)
1. Install code-server:
   ```bash
   curl -fsSL https://code-server.dev/install.sh | sh
   ```
2. Config at `~/.config/code-server/config.yaml` binds it to the Tailscale
   interface only (private — not the LAN or public internet):
   ```yaml
   bind-addr: 127.0.0.1:8080
   auth: none
   disable-telemetry: true
   ```
   > `auth: none` is safe *because* it's bound to the Tailscale IP — only
   > devices on your tailnet can reach it. For a password instead, set
   > `auth: password` and add a `password:` field.
3. Default theme + smooth scrolling are pre-set in
   `~/.local/share/code-server/User/settings.json` (Default Dark Modern).
   Pick any other theme inside VS Code with **Ctrl/Cmd+K Ctrl/Cmd+T**.
4. Run it (survives reboots):
   ```bash
   systemctl --user enable --now code-server
   # optional, so it runs without a logged-in session:
   sudo loginctl enable-linger $USER
   ```

## Plugin install (on each desktop)
1. Copy this `code-workspace/` folder into `~/.hermes/desktop-plugins/`.
2. In the Hermes desktop app: Ctrl/Cmd+K → **Reload desktop plugins**.
3. A **Code** pane appears on the right → real VS Code, connected to the VM.

## Notes
- The laptop must be on the Tailscale tailnet to reach `127.0.0.1:8080`.
- To use the LAN IP instead, change `CODE_URL` + `bind-addr` accordingly.
- Extensions: install from the in-app Extensions view (needs VM egress to the
  marketplace), e.g. Catppuccin, One Dark Pro, Prettier, Python.
