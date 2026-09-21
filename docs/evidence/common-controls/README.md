# Common Controls Visual Evidence

`apps/web/scripts/common-controls-visual-diff.mjs` is the repeatable browser-evidence helper for the shared Search / Select / Input / TextArea / Button / PlaceholderCell controls.

The canonical design source for this evidence is `F:\ChenHai\Project\XianYuAgent-search-select-preview\docs\design-preview\xianyu-admin-controls-review.html`. The checked-in baseline copy is byte-identical to that review design.

It launches a clean headless Chrome through CDP, captures both the design baseline and the implementation page at exactly `1440×900` and `390×844`, then emits:

- `controls-baseline-*.png` — design baseline screenshots;
- `controls-implementation-*.png` — implementation screenshots;
- `controls-diff-*.png` — red-highlighted pixel-diff heatmaps;
- `visual-diff.md` — reviewer-friendly screenshot and computed-style tables;
- `evidence.json` — machine-readable hashes, dimensions, pixel statistics, and DOM metrics.

Run it after starting the implementation page:

```powershell
node apps/web/scripts/common-controls-visual-diff.mjs `
  --baseline F:\ChenHai\Project\XianYuAgent-search-select-preview\docs\design-preview\xianyu-admin-controls-review.html `
  --target-url http://127.0.0.1:4173/controls `
  --out-dir docs/evidence/common-controls
```

The script never edits production components. It only creates evidence files in the selected output directory. The default per-channel pixel threshold is `16`; the Markdown report deliberately leaves non-zero differences visible for manual sign-off instead of silently marking the page as identical.

Unit coverage for the deterministic PNG comparison helper:

```powershell
node --test apps/web/scripts/common-controls-visual-diff.test.mjs
```

