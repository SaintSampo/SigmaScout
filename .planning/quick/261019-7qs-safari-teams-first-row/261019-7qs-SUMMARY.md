# 261019-7qs: Safari hid the first Teams table row

**Report:** on Apple devices the first row of the Teams table did not render.

**Cause:** the virtualized rows were `position: absolute` inside a `position: relative` `<tbody>`. WebKit does not honor a positioned `<tbody>` as a containing block (bugs.webkit.org/show_bug.cgi?id=240961), so on Safari every row resolved against the scroll container instead and sat one header height too high. The first row ended up underneath the sticky header.

**Fix:** rows stay in normal table flow at a fixed 44 px height; a top and a bottom spacer row hold the virtualizer's total size. Commit d36b68e8.

**Verified:** 3429 web unit tests pass, web typecheck clean. Not verified on a real Apple device; check sigmascout.org/teams on an iPhone or Safari after deploy.
