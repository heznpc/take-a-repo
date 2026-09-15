# take-a-repo Handoff Conventions

take-a-repo is the autonomous launch asset pipeline for browser extensions. It
turns a reusable product story into channel variants, validates the final files,
and gives agents machine-readable fixes until the requested targets are
technically publish-ready. The handoff pack is an internal machine boundary, not a request
for a user to inspect JSON or edit media. The user reviews the final rendered
candidate and records Approve or Request changes; agents own the repair loop.

## Files

Every successful run writes these files unless `handoff: false` is set:

- `take-a-repo-manifest.json` — the entry point. Read this first.
- `storyboard.json` — demo intent, beats, viewport, trim/framing hints, and
  structured storyboard lint.
- `captions.json` — portable caption timing, text, style, and measured rendering QA.
- `schemas/take-a-repo-manifest.schema.json` — local manifest validation contract.
- `schemas/storyboard.schema.json` — local storyboard validation contract.
- `schemas/captions.schema.json` — local captions validation contract.
- `schemas/approval.schema.json` — user decision validation contract.

The first review decision also writes `take-a-repo-approval.json`. It is separate
from generated evidence and binds the decision to the exact deliverable digest.

Schema references are included in each file as `$schema` URNs, and the package
ships matching schema files under `schemas/`. Each output pack also carries its
own copies; resolve `handoff.schemaFiles` relative to the directory containing
`take-a-repo-manifest.json`. The URN is an identity key, not a network fetch
requirement. take-a-repo validates the finalized core handoff documents with these
same schemas before writing the manifest and validates approval decisions when
they are read or written.

The CLI's `ok:true` means the requested stages completed. `machineStatus` is
`publish-ready`, `needs-fix`, `blocked`, or `not-requested`. Delivery `status`
also applies the approval gate and can be `awaiting-approval`,
`changes-requested`, or `approved`.

## Manifest Roles

External tools should use `assets[].role`, not filename guessing:

- `store-screenshot` — CWS screenshot PNG.
- `promo-tile` — CWS promo image PNG.
- `store-listing-copy` — generated listing copy.
- `privacy-disclosure` — generated store-review worksheet.
- `source-demo-webm` — Playwright's original recording, useful as evidence.
- `sns-demo-mp4` — H.264 MP4 intended for X/SNS upload or editor import.
- `thumbnail` — poster frame extracted from the final clip.
- `storyboard-contract` — `storyboard.json`.
- `captions-contract` — `captions.json`.
- `handoff-manifest` — `take-a-repo-manifest.json`.
- `handoff-schema` — one of the locally bundled JSON schemas.

Each asset has a stable `id`, repo-relative `path`, `outPath`, `type`, `format`,
`role`, and `source.kind`. Resolve `outPath` relative to the manifest directory;
use `path` only when the consumer also knows the repository root. Delivered
files other than the self-referential manifest carry byte size and SHA-256
integrity metadata. Consumers must ignore unknown roles and fields for
forward-compatible v1 processing.

## Run and Review State

`manifest.run.id` identifies the current invocation. On a full run, every
asset's `runId` matches it and its state is `produced`. A scene-filtered or
`--no-video` run is `run.mode:"partial"`; untouched outputs keep their older
`runId` and become `retained`. Missing files are pruned. A retained file whose
digest changed becomes `modified`, is excluded from adapter readiness, and must
be recaptured.

`handoff.review` remains an additive v1 compatibility summary. Autonomous
callers use `handoff.automation` instead; `needs-fix` never means "ask the user
to review." `handoff.approval` is the distinct final-media decision gate.
`handoff.summary` reports asset, demo, adapter, technically publish-ready, and
approved target counts.

## Autonomous Publishing

One demo story can declare `targets: ['cws-youtube', 'x', 'youtube-shorts']`.
Each expanded target records its profile in `storyboard.json` and receives
mechanical defaults for viewport, H.264/yuv420p, duration cap, caption position,
and thumbnail. `youtube-shorts` resolves timed story captions to the built-in
`focus` + `outline` style: compact word chunks, current-word emphasis, and a
bottom safe offset. The style is deterministic for silent demos and requires no transcript
engine. CWS and X use `static` unless the config overrides `captionOptions`.

`storyboard.demos[].captionStyle` and `captions.demos[].style` preserve the
resolved `mode`, `appearance`, `position`, timing, chunk size, active color, and safe offset
for downstream agents. `captions.demos[].timeline[]` is the reproducible
trim-relative render plan: each frame includes its start/end, rendered chunk,
source phrase, words, and active-word index.

Localized variants may also declare `captionOptions.typography`. The resolved
locale, direction, family stack, fitting bounds, and configured font families
remain in the public style. Project-local font files are glyph-checked and
subset before browser injection; data URLs never enter the handoff. Instead,
`captions.demos[].qa` records project-relative font paths, source/subset byte
counts, missing glyphs, scheduled/measured frame counts, browser font-load
state, fitted sizes, line count, and line balance.

When `config.calibration` is declared, `storyboard.demos[].calibration` records
the applied profile hash, layout preset, and protected regions. The tracked
calibration JSON remains the editable source; the storyboard is run evidence.
Protected-region collisions become structured warnings, and a dashboard profile
is considered verified only when its current hash has produced a real
`publish-ready` recapture.

`handoff.automation.targets[]` validates:

- final MP4 presence and unchanged integrity;
- ffprobe codec, pixel format, actual dimensions, and actual duration, plus a
  bounded full-video ffmpeg decode that rejects truncated/corrupt MP4s;
- poster-frame presence, exact target dimensions, and nonblank PNG pixel statistics;
- measured caption presence, viewport bounds, overflow, line count, outline
  stroke, schedule drift, font application, fitted size, and line balance from
  the real recorded page;
- storyboard lint being enabled for every publish target;
- structured storyboard warnings, including early result and restore beats;
- configured targets that were skipped or produced no output.

Failures become `automation.actions[]` with `owner:"agent"`, an explicit `fix`,
and a target/scene rerun instruction. Agents increment `--attempt`, apply every
fix, and rerun `automation.retryScenes[]`. The default maximum is three. Only
the exhausted `blocked` state sets technical
`automation.userActionRequired:true`.

Machine `publish-ready` means these automated checks passed. It does not mean
the user approved the media. `handoff.approval.targets[]` compares the current
deliverable SHA-256 and calibration profile hash with `take-a-repo-approval.json`:

- `awaiting-approval` — show the final candidate to the user.
- `changes-requested` — the agent owns the note, edit, and recapture.
- `approved` — only this exact digest passed user review.

Any recapture or profile change makes a prior decision stale. External
publication has not happened yet; `targets[].upload` identifies the connector,
and an authorized external write may proceed only when
`handoff.approval.publishable` is true.

Adapter `readiness` is tool-specific. `ready` means the required, unmodified
asset roles and storyboard content are present for that recommendation; it does
not mean the connector is installed or the user approved the assets.

## Manual Fallback

Target workflows omit `adapterHints[]` by default. They are available for
legacy targetless captures or when `automation.manualFallback:true` is
explicitly configured. Hints are advisory; take-a-repo does not hold credentials or
install MCP servers.

Each hint includes:

- `id` / `label` — the target tool or tool family.
- `kind` — broad category such as `design-mcp`, `desktop-editor`,
  `code-video`, or `avatar-video`.
- `readiness` — `ready`, `needs-input`, or `needs-assets`.
- `connector` — optional connector metadata, for example `{ "type": "mcp",
  "name": "figma" }`.
- `useAssets` — manifest asset references the tool should consume.
- `missingRoles` / `missingInputs` — what to capture or provide next.
- `nextStep` — the agent-facing action.

Autonomous flow:

1. Read the CLI `status` and manifest path.
2. On `needs-fix`, execute every agent-owned action and rerun only the listed
   scenes with the next `--attempt`.
3. On `blocked`, report the exhausted technical blocker and attempted fixes.
4. On `awaiting-approval`, present each final candidate in the Calibrator and
   wait for the user's Approve or Request changes decision.
5. On `changes-requested`, apply the decision note, recapture, and return the
   new digest for review.
6. On `approved`, let an authorized connector publish only the approved digest.
7. Keep repo fixtures and the story/action script as the repeatable source.

Fallback tool notes:

- Figma MCP: use the `figma-mcp` hint when the manifest has a thumbnail and
  storyboard. It is good for cover frames, social layout, and design-system
  review. The agent should connect to Figma through its own MCP environment.
- Screen Studio: use `sns-demo-mp4` as the base clip, then add polish such as
  cursor smoothing, callouts, and final crop. Preserve `captions.json` timing.
- Canva: use `thumbnail` as a cover/poster frame and import the MP4 for light
  layout work. Keep captions short enough to survive mobile previews.
- Supademo: use `storyboard.json` beats as step names if converting the clip
  into a guided product tour.
- Remotion: use `sns-demo-mp4`, `captions.json`, and `storyboard.json` when a
  repeatable template-based video is better than hand editing.
- Higgsfield or AI video studios: use the `higgsfield` hint for campaign
  variants around the proof clip. Do not replace the captured product proof
  with generated UI.
- LongCat Video Avatar or presenter video: use the `longcat-video-avatar` hint
  only after adding avatar reference and voice/narration inputs.
- MCP adapters: treat the manifest as the only required input path. The adapter
  should resolve all other files through `assets[]`.

## Storyboard Lint

`storyboard.json.storyboardLint[]` is structured for agents:

```json
{
  "name": "demo",
  "ok": false,
  "warnings": [
    {
      "code": "missing-safety-restore",
      "severity": "warning",
      "message": "storyboard has no visible safety/restore beat",
      "fix": "show restore, undo, original text, or another safety path"
    }
  ]
}
```

Current warning codes:

- `invalid-captions`
- `no-captions`
- `single-caption`
- `late-first-caption`
- `dense-focus-caption`
- `invalid-caption-options`
- `long-caption`
- `missing-safety-restore`
- `missing-mp4`
- `edge-framing`
- `odd-viewport`
- `short-duration`
- `long-duration`
- `missing-duration`
- `invalid-duration`
- `caption-locale-missing`
- `caption-font-not-embedded`
- `caption-missing-glyph`
- `caption-font-load-failed`
- `caption-typography-not-applied`
- `caption-type-fit-failed`
- `caption-unbalanced-lines`
- `caption-outside-viewport`
- `caption-overflow`
- `caption-too-many-lines`
- `caption-outline-missing`
- `caption-protected-region-overlap`
- `protected-region-outside-viewport`
- `caption-frame-missing`
- `caption-timing-drift`

Lint warnings do not fail a capture. They tell the agent how to improve the next
`take-a-repo.config.js` edit.

## Versioning

The handoff contract is versioned independently from the npm package:

- Top-level `version: 1` means handoff contract v1.
- Top-level `kind` identifies the document type.
- `$schema` points at the matching schema URN.
- Approval decisions use `kind: "take-a-repo.approval"` and are tied to an asset
  digest, not a mutable filename.
- New fields may be added in v1. Existing fields should keep their meaning.

Downstream tools should ignore unknown fields and key off `kind`, `version`, and
`assets[].role`. For validation, prefer the schemas copied into the handoff
pack. The same files remain available through the installed `take-a-repo` package's
`./schemas/*` export; never fetch the URN as a URL.
