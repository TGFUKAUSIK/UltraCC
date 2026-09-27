# Third-Party Notices

This repository contains original UltraCC code plus a small number of
reference acknowledgements and external runtime services. This document
separates them precisely.

**UltraCC — original code** — Copyright (c) 2026 Kausik SS.
Licensed under the MIT License — see [`LICENSE`](./LICENSE).

---

## 1. Reference-only projects (no material incorporated)

The following projects were used as **references for ideas, UX patterns, and
behavioral research only**. No source code, data tables, or other material
from them is included in this repository.

### UniCC

- **Project:** UniCC — <https://github.com/Arya4930/UniCC>
- **Upstream license:** MIT
- **Usage:** reference for feature ideas and UX research.
- **Branding lineage:** UltraCC grew out of a UniCC working copy; legacy
  identifiers (`VIT_UNICC_*` extension message types, `VitUniCCDatabase`,
  “VIT Uni CC Bridge” extension name) preserve that history. No MIT notice is
  strictly required, but this attribution is provided in good faith.

### VIT Student (android-vtop-chennai)

- **Project:** VIT Student — <https://github.com/therealsujitk/android-vtop-chennai>
- **Upstream license:** GPL-3.0
- **Usage:** reference for VTOP login/session behavior research (native
  Android project; no code is shared with this browser/TypeScript codebase).
- **Status:** reference-only. Studying a GPL-licensed project does not, by
  itself, make UltraCC GPL — no GPL-licensed source is included here.

---

## 2. External runtime data services

Live campus data for the library catalogue, clubs directory and transport
routes is ingested **server-side** by UltraCC's own edge function
(`supabase/functions/campus-data`), cached in the project's Supabase database,
and served to the app through the UltraCC API. The upstream endpoints are
supplied as deploy-time environment variables and are never committed to this
repository.

The frontend makes **zero direct requests** to any upstream host (enforced by
`src/lib/__tests__/upstreamIsolation.test.ts`); upstream access exists only
inside the server-side ingest code.

The **VIT Chennai transport route dataset** (110 routes, stops, pickup times,
dispersal placements, bus rules) is served from UltraCC's own bundled,
verified dataset (`src/data/transport.json`, mirrored server-side in
`supabase/functions/campus-data/transport.json`) — no third-party API
dependency.

---

## 3. CodeChef-VIT Papers (previous-year question archive)

- **Project:** CodeChef-VIT Papers — <https://github.com/CodeChefVIT/papers-codechef>,
  browsable at <https://www.papers.codechefvit.com>
- **Upstream license:** MIT License — Copyright (c) 2025 CodeChef-VIT
  ([`LICENSE` upstream](https://github.com/CodeChefVIT/papers-codechef/blob/staging/LICENSE)),
  reproduced verbatim at the end of this section. UltraCC's own
  [`LICENSE`](./LICENSE) covers UltraCC's original code only: using their
  archive does not relicense it, and this notice does not relicense theirs.
- **Source:** the metadata is taken from the project's public, MIT-licensed
  repository. No separate permission was sought — the MIT licence covers the
  use of the code and metadata, subject to its terms.
- **What UltraCC takes:** question-paper **metadata** only, fetched
  server-side by `supabase/functions/pyq-sync` and normalised into the
  project's own `public.pyq_papers` table. No browser talks to their site;
  `src/lib/__tests__/upstreamIsolation.test.ts` enforces that their host never
  appears in frontend code.
- **What UltraCC does not take:** the paper files. All 3,154 PDFs stay on
  CodeChef-VIT's storage; the app embeds and links to the source URL. No
  binary is vendored into this repository, and none is copied into object
  storage.
- **Attribution:** credit stays in this repository — the README references and
  this notice name CodeChef-VIT Papers and reproduce their MIT licence. The
  papers remain CodeChef-VIT's content — UltraCC does not
  claim authorship of any question paper, nor of any metadata field it did not
  derive itself (course code and course title are split out of their `subject`
  string, and that derivation is the only thing added).
- **Gaps are inherited, not filled:** upstream publishes no difficulty rating,
  no tags and no answer-key URL for most papers, so neither is invented here.

### A note on what the licence does and does not cover

The MIT licence above is CodeChef-VIT's licence on **their repository** — the
papers API, the site and their code. The question papers themselves are a
separate matter: they were set by VIT's faculty and are collected, scanned and
hosted by CodeChef-VIT. UltraCC copies none of those bytes into this
repository, into its database or into object storage; it stores only the
catalogue entry that says which paper exists and where their own file lives,
and it renders the file from the URL CodeChef-VIT publishes. Nothing here
claims authorship of, or rights over, any question paper, and no licence is
granted or implied over VIT's examination content.

### Upstream licence text (verbatim)

```text
MIT License

Copyright (c) 2025 CodeChef-VIT

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

---

## 4. VIT Chennai published information

Factual campus information (bus routes, stops, pickup times, slot timings)
originate from VIT Chennai's own published sources. Facts are not
copyrightable; no endorsement is implied.

---

## 5. Runtime dependencies

UltraCC's runtime dependencies (React, Vite, Tesseract.js, Lucide, Motion,
Express, etc.) are separate works licensed on their own terms (MIT,
Apache-2.0, ISC, etc.). The UltraCC project license does not relicense them.
They are declared in [`package.json`](./package.json) and pinned in
`package-lock.json`. Run `npx license-checker` for a full inventory if needed
for distribution.

npm packages do not require entries here unless their licenses require
source-redistribution notices in distributions.

---

## 6. Original code

All source code, UI, architecture, and data transformations are original
UltraCC work:

**UltraCC — Copyright (c) 2026 Kausik SS** — SPDX: MIT.
