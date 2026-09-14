# Third-party notices

SigmaScout's own code is licensed under the MIT License in [LICENSE](LICENSE). This file lists
third-party material the repository includes or is derived from, and the license it comes under.
npm dependencies carry their own license files in their packages and are not repeated here.

## Statbotics

- **Source:** https://github.com/avgupta456/statbotics
- **License:** MIT
- **What SigmaScout uses:**
  - Excerpts of Statbotics' Python source, quoted word for word as reference material, mainly in
    `docs/models/statbotics-breakdown-reference.md`, with shorter quotes in other files under
    `docs/models/`, `.planning/`, and code comments.
  - SigmaScout's EPA algorithm (`packages/core/algorithms/epa.ts` and the files it uses under
    `packages/core/algorithms/`), a TypeScript reimplementation of Statbotics' EPA model.

```
MIT License

Copyright (c) 2020 Abhijit Gupta

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
