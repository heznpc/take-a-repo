# skillBridge take-a-repo application plan

Do not edit skillBridge from the take-a-repo repo. This is the intended follow-up
plan once `take-a-repo.3.0` is published or linked locally.

## Goal

Upgrade the existing skillBridge take-a-repo setup from store screenshots plus one
functional demo into a repeatable launch/handoff bundle:

- Keep Chrome Web Store screenshots and promo tiles.
- Split SNS videos into multiple `demos[]` campaign cuts.
- Emit `storyboard.json`, `captions.json`, and `take-a-repo-manifest.json`.

## Suggested demo cuts

1. `demo-translate`
   - Audience: X/SNS.
   - Story: open a Skilljar course page, translate visible lesson text, show the
     translated state.
   - Captions:
     - `Open the course page`
     - `Translate visible lesson text`
     - `Keep the lesson readable in context`

2. `demo-protected-terms`
   - Audience: X/SNS and docs.
   - Story: show AI/product terms staying intact during translation.
   - Captions:
     - `AI terms stay protected`
     - `Glossary rules preserve product meaning`
     - `Review the result before sharing`

3. `demo-restore`
   - Audience: X/SNS.
   - Story: translated state, restore original, verify reversible behavior.
   - Captions:
     - `Restore the original anytime`
     - `One click returns to the source`
     - `Safe for course review workflows`

4. `demo-course-map`
   - Audience: docs/longer social.
   - Story: show sidebar/course-map/flashcard learning workflow if present.
   - Captions:
     - `Keep course context visible`
     - `Move between lesson and practice`
     - `Use the learning tools together`

## Config changes

Keep existing `scenes` and `promoTiles`. Replace or supplement the single
`demo` with `demos[]`:

```js
demos: [
  {
    name: 'demo-translate',
    audience: 'x',
    nextTool: 'screen-studio',
    preset: 'sns-video',
    mp4: { crf: 18 },
    trim: { start: 0, duration: '00:35' },
    thumbnail: { at: 1.2 },
    captions: [
      { at: 0.5, text: 'Open the course page' },
      { at: 4.0, text: 'Translate visible lesson text' },
      { at: 15.0, text: 'Restore the original anytime' },
    ],
    async run({ page, env, demo }) {},
  },
  {
    name: 'demo-protected-terms',
    audience: 'x',
    nextTool: 'screen-studio',
    preset: 'sns-video',
    mp4: { crf: 18 },
    trim: { start: 0, duration: '00:28' },
    thumbnail: { at: 1.0 },
    captions: [
      { at: 0.5, text: 'AI terms stay protected' },
      { at: 8.0, text: 'Glossary rules preserve product meaning' },
      { at: 18.0, text: 'Review the result safely' },
    ],
    async run({ page, env, demo }) {},
  },
]
```

## Verification

Run from skillBridge:

```bash
TAKE_A_REPO_HEADED=0 npx take-a-repo --scene demo-translate --mp4 --json
TAKE_A_REPO_HEADED=0 npx take-a-repo --scene demo-protected-terms --mp4 --json
```

Check:

- `take-a-repo-manifest.json` lists the mp4/webm/thumbnail/captions.
- `storyboard.json` has no unexpected lint warnings.
- Thumbnail frame shows a visible product result, not an empty loading state.
- Generated mp4 is `1280×720`.

## Release ordering

Do this after take-a-repo `1.3.0` is published and consumed by skillBridge. Do not
treat the handoff bundle as CWS deployment readiness by itself; skillBridge
release checks still need their existing live-store and bundle verification.
