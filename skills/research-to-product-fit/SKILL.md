---
name: research-to-product-fit
description: Turn external research from GitHub trending, similar repos, blog posts, PM/marketing tools, and agent skills into evidence-backed product TODOs for starter-series projects, especially take-a-repo demo/store-asset automation. Use when asked to scout tools or patterns, compare research candidates, reduce missed research, evaluate adopt/adapt/reject decisions, or hand off work across role-separated scout, critic, and integrator prompts.
---

# Research To Product Fit

Use this skill to prevent "research theater": every external idea must be tied
to checked source evidence, a target project constraint, and a smallest useful
next action. Prefer repo-scoped work over global skill installation unless the
user explicitly asks for a global skill.

## Required Outputs

Produce or update these artifacts for each research task:

- `templates/research-ledger.md` format: source inventory, candidate evidence,
  missing checks, adopt/adapt/reject notes.
- `templates/project-fit-matrix.md` format: project constraint mapping and
  minimal TODO conversion.
- A pilot or task-specific note under `pilots/` when the research is tied to a
  named project decision.

## Workflow

1. Establish the target project boundary first. Record the repo root, git status,
   package/scripts/tests, README/docs, and the files that define the product
   surface being improved.
2. Scout candidates from at least two source classes when useful: GitHub
   trending/topics/search, similar repos, official docs, release notes/issues,
   product/marketing tools, and practical blog posts. Prefer primary sources.
3. Do not say a candidate was "read" until the minimum evidence is checked or
   explicitly marked missing:
   - README or landing page
   - package/config or install surface
   - examples or docs
   - tests or validation story
   - recent release, issue, commit, archive, or activity signal
4. Fill the research ledger. Keep rejected candidates; they are part of the
   anti-omission record.
5. Fill the project-fit matrix. For each useful pattern, cite the local file
   that makes it compatible or incompatible.
6. Convert research into TODOs only after the fit matrix exists. TODOs must be
   small, reversible, and testable; include target files, acceptance checks, and
   explicit non-goals.
7. Run available validation for any files changed. If only Markdown changed,
   validate skill frontmatter and run a link/path sanity check where possible.

## Agent Roles

The harness separates roles, not vendors. Default flow: Claude for scout/critic,
Codex for repo integration. Gemini is optional, not assumed; use Gemini only if
you want a second broad search pass.

- Scout: broaden search, fill `research-ledger.md`, and flag missing source
  checks without deciding implementation. Use Claude by default.
- Critic: challenge weak evidence, hype, license/activity risks, and over-broad
  TODOs. Use a separate Claude session or Codex.
- Integrator: re-check local repo state, choose adopt/adapt/reject, write or
  update project artifacts, and run validation. Use Codex.

## Decision Rules

Adopt when the candidate is license-compatible, maintained enough for the risk,
fits the target repo's architecture, has a clear validation path, and reduces
custom code.

Adapt when the pattern is useful but the package, service, license, maturity, or
blast radius is wrong for the pilot. Capture the idea in project-native terms.

Reject when the candidate is archived/inactive for the needed surface, conflicts
with privacy/store/compliance constraints, requires secrets or hosted services
that the project avoids, duplicates existing project scope, or pushes the work
from a small pilot into a new product.

## Product TODO Conversion

For each accepted or adapted pattern, write:

- Target project and local evidence files.
- Source evidence URL or file.
- Minimal implementation unit.
- Test or verification command.
- Stop condition that prevents scope creep.
- Follow-up that belongs after the pilot, not inside it.
