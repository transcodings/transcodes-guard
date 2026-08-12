# Third-party notices

This product includes third-party software. The notices below apply only to the
files identified in each section; everything else in this repository is covered
by [LICENSE.md](LICENSE.md).

---

## rulesync

`cli/src/commands/sync/` is a vendored copy of **rulesync**, adapted for this
project. It was copied from upstream **v16.5.0** on 2026-08-02 and is not
tracked as an npm dependency, so the source lives directly in this tree.

- Upstream: https://github.com/dyoshikawa/rulesync
- License: MIT

### Changes from upstream

- The single-source-of-truth directory and its config files were renamed to
  this project's names: `.transcodes/`, `.transcodes/config.jsonc`,
  `config.local.jsonc`, and `.transcodesignore`.
- The set of supported target tools was reduced to the hosts this project
  ships for.
- `features/rules/claudecode-rule.ts`, `features/rules/rules-processor.ts`,
  `features/skills/antigravity-shared-skill.ts`, and `lib/feature-scaffold.ts`
  were modified for Claude Code global rule paths, `AGENTS.md` mirroring, and
  Antigravity global skill paths.

Upstream changes are not merged back in; the version above is the comparison
baseline.

### MIT License

```
MIT License

Copyright (c) 2024 dyoshikawa

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
