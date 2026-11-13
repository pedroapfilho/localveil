# Open decisions

Choices about localveil that are waiting for an answer. Each entry says what the code does today, why it is not a plain fix, the options, and what follows from choosing. Delete an entry when its decision is made and carried out.

## Where the OCR engine is downloaded from

### Today

`packages/redact/src/ocr/recognize.ts` starts Tesseract with `createWorker(language)` and passes no paths, so tesseract.js 7.0.0 uses its defaults. In the browser that is three downloads from `cdn.jsdelivr.net`:

| What                                                 | From                                                     | Kept in                    |
| ---------------------------------------------------- | -------------------------------------------------------- | -------------------------- |
| The worker script, 111 KB                            | `tesseract.js@v7.0.0/dist/worker.min.js`                 | The browser's HTTP cache   |
| The wasm core, about 4 MB, one of several per device | `tesseract.js-core@v7.0.0/tesseract-core-*-lstm.wasm.js` | The browser's HTTP cache   |
| The language file for `eng`, `por` or `spa`          | `@tesseract.js-data/<lang>/4.0.0_best_int`               | IndexedDB, by tesseract.js |

The CLI takes the worker and the core from `node_modules` and fetches only the language file.

`README.md` says in its summary and under "Privacy" that the only network traffic is the detection weights and a Tesseract language file, and that the page then works with the network off. It never names jsDelivr and does not mention the worker script or the core. `AGENTS.md` lists the same promise under "Notable decisions".

### Why it is open

- The worker script and the core are code, and they run on the pixels of the document being read. Today that code comes from a third party at run time, pinned only by the version in the URL.
- Working offline depends on the browser not evicting two files from its HTTP cache.
- Each visitor who reads a scan tells jsDelivr their address and that they came from localveil.
- The fix is either a build change that adds megabytes to the deployment or a change to what the product promises in writing. That is a product choice.

### Options

1. **Self-host all three (recommended).** Copy `worker.min.js` and the `tesseract.js-core` files into the web build, the way `apps/web/vite.config.ts` already emits the ONNX wasm, add the three language packages as dependencies, and pass `workerPath`, `corePath` and `langPath` in `recognize.ts`. The only third-party request left is the weights from Hugging Face, the code that touches a document is built from the lockfile, and the README needs one wording change (the language file comes from this site). The deployment grows by the core variants and three language files.
2. **Self-host the worker and the core, leave the language files on jsDelivr.** No third-party code runs, and the deployment grows less. The README must name jsDelivr as the source of the language file.
3. **Keep the CDN and correct the docs.** Rewrite the two README passages and the `AGENTS.md` line to list jsDelivr for the worker, the core and the language files. Nothing changes for a user, and the promise becomes "the weights, and Tesseract from a CDN".

Option 1 is the one that matches what the product says about itself: nothing but the weights leaves the page's own origin.

### To see it first

Open the deployed app with the network panel open, drop a scanned image, and filter by `jsdelivr`. Expect three requests on a first visit.

### Once decided

- With option 1 or 2, a `Content-Security-Policy` that allows scripts only from the site itself becomes possible. `apps/web/vercel.json` sets none today.
- With option 1, the CLI can read its language files from `node_modules` too and run with no network after the weights are cached.

## Which browsers the web app supports, and the two escape helpers

### Today

Two hand-written functions escape text before it goes into a `RegExp`:

- `escapeForRegExp` in `packages/redact/src/pipeline/text.ts`, used by `repeats.ts` and `defined-terms.ts` beside it.
- `quote` in `apps/web/src/components/glossary-text.tsx`.

They are not the same: the first also escapes `/`.

The platform has had `RegExp.escape` since Chrome 136, Firefox 134 and Safari 18.2, all released in 2025, and Node 24 has it. TypeScript accepts it in every package.

The repo states no browser floor. `apps/web/vite.config.ts` sets no `build.target`, so Vite 8 builds for its default (Chrome 111, Edge 111, Firefox 114, Safari 16.4). That target only lowers syntax; it adds no missing functions. The code already calls newer ones:

- `Intl.Segmenter` in the text path, which Firefox gained in version 125.
- pdf.js 6.3's browser build uses `Promise.try`, `Math.sumPrecise` and `Map.prototype.getOrInsertComputed`, all newer than `RegExp.escape`. This was read from the bundle, not tried in an old browser.

### Why it is open

Calling `RegExp.escape` directly makes text and image redaction throw in any browser older than the three versions above. PDFs very likely need such a browser already, so the real question is which browsers localveil supports, and nothing in the repo answers it.

### Options

1. **Share one helper now (recommended).** Export `escapeForRegExp` from `@repo/redact`, use it in the glossary, delete `quote`. Nothing changes for a user and the duplicate is gone. One hand-written helper stays.
2. **Set a 2025 floor.** Write the floor (Chrome 136, Firefox 134, Safari 18.2) in the README, set `build.target` to match, and replace both helpers with `RegExp.escape`. Anyone on an older browser gets an app that fails on the first file, unless a "this browser is too old" message is added with it.
3. **Keep both until late 2027**, when `RegExp.escape` counts as widely available, then replace them.

Option 1 costs nothing and does not close the floor question. Take it now, and answer the floor separately.

### To know first

The app has no analytics, so there is no record of which browsers visitors use. To learn what the PDF path needs in practice, redact a PDF on the deployed app in the oldest Safari and Firefox you would want to support.

### Once decided

With a stated floor, both helpers can go, `build.target` can rise to match, the README can list the supported browsers, and an "unsupported browser" message has a rule to follow.
