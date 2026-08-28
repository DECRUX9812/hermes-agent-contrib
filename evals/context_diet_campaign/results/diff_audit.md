# Context-diet campaign diff audit

Source: fetched `origin` refs and GitHub PR metadata for issue #95681. Core code diffs were read with `git diff` against each PR merge-base; this file records the relevant scope, not a source snapshot.

| PR | Head | Merge | Diff read / purpose |
| ---: | --- | --- | --- |
| #94599 | `59b0b3893a610ac50d7d9764fa69c57b576924a9` | `76e306c45843607e6dc135d23c13d3654417ebd5` | Removed six expired BFL FLUX 3 core schemas/toolset entries; added config migration v39. |
| #95005 | `6f5a7b4fb54f8c1f1646181e17d849ab4dc16316` | `4032a15ad0d5f55f5c97f3fa59709ca28a992543` | Removed the conditional Nous Subscription system-prompt block and its re-export. |
| #95050 | `10b65d35ae877daf29d35406476489f2b382d2c6` | `62b2d78025c349996e753c6f7c748de035eb8048` | Fixed deferred-tool batch barriers, source indexing, and listing config plumbing. |
| #95119 | `448bab2a95fc28e5c95961d45f2a88fc3c8ca74d` | `a9351543789baabdd2897ee2ed73087d488f9b6c` | Added multi-query/batched describe/stemming and related search tests; not a direct schema diet. |
| #95287 | `a8c7880ef15fd89c4677c1d54b03140ef9ad381d` | `3e5c49643cead9c7504c0926b5c9246adea33360` | Halved cronjob schema prose, merged monitor fields, retained legacy aliases in the handler. |
| #95384 | `7caee9b0a661a12655638d39d5a248f8eb1b5213` | `bd134d0f303c97032f497fb9c66e7404761433ed` | Deleted the duplicated computer-use system block, removed `max_elements` from the model schema, and moved escalation teaching to verdicts. |
| #95570 | `d8a78a4dc0b29c8077290123ead3399dafe12af4` | `f6d3a1ca4952927dc5b98613191ec85c819d6adb` | Reduced session-search schema prose/parameter teaching and added response-time scroll/link/FTS hints. |
| #95571 | `bf35536c7f9648a3a2a6deb4ab842b2943208c8f` | `f4df86fe1a3285d88107c89b0d56f98c674751d0` | Changed compaction default from legacy to lean; preserved explicit legacy mode and fixed model-switch recomputation. |
| #95620 | `b03b3a69342c2da5303f90159d59c5fcf1c5f7ad` | `61cb2c2323361253d0ccba07bbc7c8c42ff174ce` | Added consent-gated real Chromium profile snapshot/copy/launch paths; removed `cua_browser_*` route from computer-use in this branch. |
| #95650 | `74b2fa2577c7e0a46a5e3e46c19e31c862cb01a4` | `b2bd1ac63ff137a6287ce989d65dccee6b9155e2` | Added the reusable session-search six-task A/B harness and stored PR #95570 reference results. |
| #95697 | `a318bf7b107d9d3045cd8494cac9e73d947b5c1e` | `3fd70ad1c9f33b6346638944339ff9bd3c113841` | Deduplicated skill_manage schema, retired advertised `edit`, kept handler compatibility, unadvertised curator-only `absorbed_into`. |
| #95907 | `6a7b7cd49cb9945a040846bf75eafb9068be5097` | `7d6c6ae4aedfd932533b8638e1d51db07654d792` | Reduced clarify schema and advertised only `questions[]`; kept legacy shapes handler-accepted. |

The full base/head/merge inventory is machine-readable in `results/ref_manifest.json`.
