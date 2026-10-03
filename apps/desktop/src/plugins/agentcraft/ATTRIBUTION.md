# Attribution

The AgentCraft Studio plugin ports the voxel "Warm Studio" world, agent protocol,
and generated asset set from **AgentCraft**:

- Upstream: https://github.com/blendi-remade/agentcraft
- License: MIT (Copyright (c) blendi-remade and contributors)

What was ported:

- `engine/` — the HQ builder (`StudioHqBuilder` + `HqLandscape`), block-state
  packing, mesher, and light propagation, re-implemented in TypeScript.
- `assets/` — the generated kit/sprite/entity/palette set (`assets/kit`,
  `assets/entity`, `assets/fonts`) produced by AgentCraft's painter pipeline.
- `sim/` — the AgentCraft goal/plan/task/decision/feed protocol, re-implemented
  as a local deterministic driver.

All Minecraft block textures are painted procedurally at runtime from the
project's own `palette.json` ramps — no Mojang assets are bundled.
