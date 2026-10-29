# Local feature vault: deploy/fork-main

The `deploy/fork-main` branch is a reference, not a deploy target. Do not merge
it directly into the live branch: it carries a different history and overlapping
implementations. These are selected source commits, not exhaustive ranges or
proof that a feature is absent from the current tree.

| Feature group | Reference commits |
| --- | --- |
| Command Room | `13dd48e1c2`, `09b48590ff`, `cf6c12a0cc`, `fd16d50fee` |
| Room 2.0 | `097f275d28`, `ccf2c4b5a2` |
| Group-room polish | `f1b20dc92b`, `cbad4f6655`, `1c512100f1`, `437e3a8378` |
| Composer predictions | `13717d1170`, `5c38724814` |
| Warm Paper | `a10b5da430` |
| Home screen upgrades | `be58c17f1b`, `dd5a7dfd2c` |
| Calm/Hark | `f7ed2af83b` |

Inspect the current implementation and follow-up history before porting. For
example, Warm Paper moved to the `hermes-design` plugin in `c92f779e37`; the
`paper` ID was subsequently retired in `fc94068435` to prevent stale clients
forcing that theme on other sessions.

Local site work branches from `overlay/core-patches`, not raw upstream main.
The live checkout is `/home/decrux/Code/hermes-overlay-core`, with
`hermes-gateway-6e0ae5f8.service` listening on port 9120. Do not run
`hermes update` there. The existing `scripts/sync-deploy.sh` must be repaired
and independently verified before use: its staging gate can ignore a failed
typecheck, and restarting the gateway may interrupt active sessions.
