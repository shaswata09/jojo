# Third-party notices

jojo talks to software it does not ship. Nothing listed here is vendored into
this repository or bundled into either app — each is a program the user installs
and runs on their own machine, and jojo reaches it over a local address the user
supplies. The notices are reproduced anyway: the terms below are the terms under
which that software is offered, and a person running it deserves to see them
without going to look.

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

The icon artwork is credited there too: Lucide (ISC) on the web, Feather (MIT,
Cole Bemis) for the icons Lucide carried over from it and for the whole of the
phone app's set.

**On the phone, Guide → Built with is a short prose list rather than the
generated table.** It names what the app is built from and does not carry
versions or licence names, so this file — not that screen — is the attribution
of record for anyone reading the APK.

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
