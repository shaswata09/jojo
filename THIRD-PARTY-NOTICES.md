# Third-party notices

Two kinds of software are named here. The first sections cover programs jojo
TALKS TO and does not ship: each is installed and run by the user on their own
machine, and jojo reaches it over a local address the user supplies. Their
notices are reproduced anyway, because a person running them deserves to see the
terms without going to look. "Packages in the web bundle" covers code that IS
compiled into the web app without jojo importing it by name, with the notices
its licences ask to travel with it.

---

## MarkItDown

- **Project**: MarkItDown — <https://github.com/microsoft/markitdown>
- **Used for**: converting PDF, Word, PowerPoint, Excel and other documents in
  the Vault to Markdown, so the assistant can read what is in them.
- **How it is used**: jojo speaks to `markitdown-mcp`, MarkItDown's own MCP
  server, over HTTP at an address the user configures in Settings. No MarkItDown
  code is included in this repository or in either app bundle, and no document
  leaves the machine the user is running it on.
- **Licence**: MIT

```
MIT License

Copyright (c) Microsoft Corporation.

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

Microsoft, MarkItDown and the MarkItDown logo are the property of Microsoft
Corporation. jojo is not affiliated with, endorsed by, or sponsored by
Microsoft.

---

## Model servers

- **Projects**: vLLM — <https://github.com/vllm-project/vllm>; Ollama —
  <https://github.com/ollama/ollama>; LM Studio — <https://lmstudio.ai>; and any
  other server offering the same interface.
- **Used for**: the assistant, the "Ask the graph" box, scout scoring, and
  reading a job posting into a new application.
- **How it is used**: jojo speaks the OpenAI-compatible `/v1/chat/completions`
  shape over HTTP to an address the user configures in Settings. It requires no
  particular server, ships none of them, vendors no code from any of them, and
  sends nothing anywhere else. With no address configured, every one of those
  features falls back to worked examples or to arithmetic done on the device.
- **Licence**: not reproduced here, and deliberately. jojo neither bundles nor
  depends on any one of these — it speaks a protocol, and which program answers
  is the user's choice. Each is offered under its own terms by its own authors,
  which is where a person running one should read them.

vLLM, Ollama, LM Studio and OpenAI are the property of their respective owners.
jojo is not affiliated with, endorsed by, or sponsored by any of them. "OpenAI-
compatible" describes the shape of the HTTP request and nothing more.

---

## Bundled dependencies

Everything jojo actually ships — every npm package in the browser bundle, in the
phone app, and in the toolchain — is credited in the app itself, on
**Guide → Built with**, with the installed version and the licence each package
states. That page is generated from `web/src/components/guide/credits.ts`, which
records versions read from `node_modules` rather than the ranges in
`package.json`, on the grounds that a range describes a version nobody is
running.

The list covers what the build bundles, not only what `package.json` names:
the production build traces every module it emits back to its package and fails
if one is not credited, or is credited under a licence it does not state
(`jojo:credited-bundle` in `web/vite.config.ts`). The packages that arrive that
way, beneath the ones jojo imports, are listed in the next section.

The icon artwork is credited there too: Lucide (ISC) on the web, Feather (MIT,
Cole Bemis) for the icons Lucide carried over from it and for the whole of the
phone app's set.

**On the phone, Guide → Built with is a short prose list rather than the
generated table.** It names what the app is built from and does not carry
versions or licence names, so this file — not that screen — is the attribution
of record for anyone reading the APK.

## Packages in the web bundle

These are compiled into the web app because a package jojo uses depends on
them. The production build checks this list against what it actually emits.
Versions are the installed ones; where two copies of a package ship, both are
named.

**ISC**: Copyright 2010-2022 Mike Bostock (d3-color); Copyright 2010-2021 Mike
Bostock (d3-dispatch, d3-drag, d3-interpolate, d3-selection, d3-timer,
d3-transition, d3-zoom). All 3.x, brought in by `@xyflow/react`.

```
Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.
```

**BSD-3-Clause**: d3-ease 3.0.1, brought in by `@xyflow/react`.

```
Copyright 2010-2021 Mike Bostock
Copyright 2001 Robert Penner
All rights reserved.

Redistribution and use in source and binary forms, with or without modification,
are permitted provided that the following conditions are met:

* Redistributions of source code must retain the above copyright notice, this
  list of conditions and the following disclaimer.

* Redistributions in binary form must reproduce the above copyright notice,
  this list of conditions and the following disclaimer in the documentation
  and/or other materials provided with the distribution.

* Neither the name of the author nor the names of contributors may be used to
  endorse or promote products derived from this software without specific prior
  written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE LIABLE FOR
ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON
ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

**MIT AND Zlib**: pako 1.0.11, brought in by `pdf-lib`. Its own code is MIT,
Copyright (C) 2014-2017 by Vitaly Puzrin and Andrei Tuputcyn, under the MIT
text below. The parts ported from zlib carry this notice at the top of each
file:

```
(C) 1995-2013 Jean-loup Gailly and Mark Adler
(C) 2014-2017 Vitaly Puzrin and Andrey Tupitsin

This software is provided 'as-is', without any express or implied
warranty. In no event will the authors be held liable for any damages
arising from the use of this software.

Permission is granted to anyone to use this software for any purpose,
including commercial applications, and to alter it and redistribute it
freely, subject to the following restrictions:

1. The origin of this software must not be misrepresented; you must not
  claim that you wrote the original software. If you use this software
  in a product, an acknowledgment in the product documentation would be
  appreciated but is not required.
2. Altered source versions must be plainly marked as such, and must not be
  misrepresented as being the original software.
3. This notice may not be removed or altered from any source distribution.
```

**0BSD**: tslib 2.8.1 and 1.14.1 (the second under `pdf-lib`), Copyright (c)
Microsoft Corporation. The licence asks for no notice; it is named because it
ships.

**MIT**, each under the MIT text below, with its own copyright line:

- @dnd-kit/accessibility 3.1.1, @dnd-kit/utilities 3.2.2 — Copyright (c) 2021,
  Claudéric Demers
- @floating-ui/core 1.8.0, @floating-ui/dom 1.8.0, @floating-ui/react-dom
  2.1.9, @floating-ui/utils 0.2.12 — Copyright (c) 2021-present Floating UI
  contributors
- @pdf-lib/standard-fonts 1.0.0 — Copyright (c) 2018 Andrew Dillon
- @pdf-lib/upng 1.0.1 — Copyright (c) 2017 Photopea
- @xyflow/system 0.0.81 — Copyright (c) 2019-2025 webkid GmbH
- classcat 5.0.5 — Copyright © Jorge Bucaran
- zustand 5.0.15 and 4.5.7 — Copyright (c) 2019 Paul Henschel
- use-sync-external-store 1.6.0 — Copyright (c) Meta Platforms, Inc. and
  affiliates
- its-fine 2.0.0 — Copyright (c) 2022-2025 Poimandres
- react-use-measure 2.1.7 — Copyright (c) 2019-2025 Poimandres
- suspend-react 0.1.3 — Copyright (c) 2021 Paul Henschel
- react-merge-refs 2.1.1 — Copyright (c) 2020 Greg Bergé
- lodash.debounce 4.0.8 — Copyright jQuery Foundation and other contributors
  <https://jquery.org/>; based on Underscore.js, copyright Jeremy Ashkenas,
  DocumentCloud and Investigative Reporters & Editors
- aria-hidden 1.2.6, react-remove-scroll 2.7.2, react-style-singleton 2.2.3,
  use-callback-ref 1.3.3, use-sidecar 1.1.3 — Copyright (c) 2017 Anton
  Korzunov
- react-remove-scroll-bar 2.3.8 — Anton Korzunov (MIT by its manifest; the
  package ships no licence file)
- get-nonce 1.0.1 — Copyright (c) 2020 Anton Korzunov

```
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

The parts of Radix (`@radix-ui/…`, MIT, WorkOS) and Firebase (`@firebase/…`,
Apache-2.0, Google LLC) that the bundle contains are covered by those projects'
own credits on the Built with page.

## Fonts

Inter and JetBrains Mono are used on both platforms and both are licensed under
the **SIL Open Font License, Version 1.1**.

On the web they arrive through the `@fontsource-variable` packages, so the
licence text travels inside `node_modules` and into nothing that is
redistributed. On the phone the `.ttf` files are vendored directly into
`mobile/android/app/src/main/assets/fonts/` and are compiled into the APK — and
OFL §2 requires the copyright notice and the licence to accompany the font files
wherever they go. They now do: `OFL.txt` sits in that directory and ships with
them.

- Inter — Copyright 2016 The Inter Project Authors, https://github.com/rsms/inter
- JetBrains Mono — Copyright 2020 The JetBrains Mono Project Authors,
  https://github.com/JetBrains/JetBrainsMono

## Unresolved: @splinetool/runtime

**The 3D mascot's runtime ships with no licence grant, and this is a
distribution question that has not been answered.**

`@splinetool/runtime` (1.12.98) declares no `license` field, carries no LICENSE
file, records no licence in `package-lock.json`, and describes itself as
"© 2025 Spline, Inc.". It is compiled into two chunks of the published web
bundle. Absent a grant, there is no stated permission to redistribute it.

`web/src/components/guide/credits.ts` already refuses to guess at the terms and
says so on the Built with page, which is the right instinct; this note exists so
the question is recorded where a licence audit will find it rather than only in
a source comment.

Two ways to close it, and one of them has to happen before wide distribution:
obtain terms from Spline in writing, or drop the mascot. Nothing else in the
tree depends on it — it is decoration on the sidebar, and the 2D fallback
already renders whenever WebGPU is unavailable.

The scene file `public/mascot.splinecode` and `public/spline/process.wasm` come
from the same vendor and inherit the same question. `process.wasm` additionally
has no lockfile entry at all, having been vendored from
`@splinetool/modelling-wasm` rather than installed.
