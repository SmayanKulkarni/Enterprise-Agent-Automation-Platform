# Studio Trigger and Layout Clarity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing live Trigger and selected-node experience understandable and readable without presenting an outbound webhook placeholder as executable.

**Architecture:** Finish the existing Studio guidance ticket in the current inspector and webhook panel, then repair the current responsive grid and library cards at reproduced viewport widths. No workflow execution semantics or new service is introduced.

**Tech Stack:** React, CSS, existing workflow-model helpers and browser commands, Vitest, browser viewport checks.

**Spec:** `docs/superpowers/specs/2026-09-26-tenant-openrouter-studio-design.md`

## Global Constraints

- Signed Webhook is an inbound Trigger mode; the fixture-only outbound Webhook block is not executable in live Studio.
- Keep existing canvas zoom/drag, draft save, published webhook credential/test, and keyboard flows working.
- Do not add code comments or dependencies. Do not edit the user's pending SQL changes.
- Finish `.scratch/studio-ux-guidance/issues/02-live-studio-guidance.md` without creating a duplicate ticket.

---

## File map

| File | Responsibility |
| --- | --- |
| `apps/browser/src/platform-app.tsx` | Trigger and Agent field guidance, library wording, selected-node and mobile library access. |
| `apps/browser/src/webhook-panel.tsx` | Existing post-publication signed inbound setup and test destination. |
| `apps/browser/src/styles.css` | Current workspace tracks, card typography/wrapping, and responsive access. |
| `apps/browser/src/workflow-model.ts` | Existing live/fixture node distinction and Trigger input helpers. |
| `apps/browser/src/workflow-model.test.ts` | Focused Trigger input and model-helper checks. |

### Task 1: Finish the in-progress Trigger guidance ticket

**Files:** Modify `apps/browser/src/platform-app.tsx`, `apps/browser/src/webhook-panel.tsx`; test `apps/browser/src/workflow-model.test.ts` and existing webhook tests.

**Interfaces:** Consume `TriggerSettings`, `ManualInput`, `WebhookPanel`, `parseTriggerInput`, and the published definition ID. Produce clearer copy and focusable links only; no new command or node kind.

- [ ] **Step 1: Record the current behavior at Manual and Webhook selections.** Capture what the mode selector, schema fields, sample start, and published webhook panel show to an editor and admin. Confirm the fixture `webhook` kind is absent from `liveLibrary`.
- [ ] **Step 2: Add a focused failing UI or helper check where behavior changes.** Verify Manual input errors remain beside their fields, Webhook mode does not trigger a manual run, and the published Webhook path points to the existing panel. Run `corepack pnpm vitest run apps/browser/src/workflow-model.test.ts packages/workflow/src/webhook.test.ts` and confirm the new assertion fails before editing.
- [ ] **Step 3: Make the smallest copy and markup change.** Explain Manual as a person starting a published run and Webhook as a signed external event. Label input schema separately from sample input, link to the published `WebhookPanel`, associate errors with controls, and call the fixture-only outgoing Webhook a non-live example. Keep `deliverWebhook` and `workflow.test-webhook` untouched.
- [ ] **Step 4: Verify and update the existing ticket.** Re-run focused tests and `corepack pnpm typecheck`; exercise keyboard mode switching, required field errors, unpublished/published states, and the inbound signed test. Mark remaining criteria in the existing issue complete only after checks pass.
- [ ] **Step 5: Commit the UI slice.** Stage only the touched UI and existing-ticket files after inspecting the diff.

### Task 2: Repair crowded Studio panels at reproduced widths

**Files:** Modify `apps/browser/src/styles.css`, and `apps/browser/src/platform-app.tsx` only if narrow-screen library access needs a control; test existing browser checks and viewport review.

**Interfaces:** Consume the existing `.studio-workspace`, `.node-library`, `.workflow-canvas`, `.inspector`, `.library-group`, and `.workflow-node` structure. Preserve canvas coordinates and current zoom handlers.

- [ ] **Step 1: Reproduce and record the failing width.** Inspect the live three-node starter at 1440, 1024, 768, and 390 CSS pixels plus 200% browser zoom. Note overflowing text, clipped controls, hidden library, and inspector reachability; add the user's reported viewport if available.
- [ ] **Step 2: Add a meaningful visual acceptance check.** Capture before images or a small viewport script that checks library/inspector controls stay reachable and no horizontal document overflow appears at the target width. This is the failure signal for the CSS change.
- [ ] **Step 3: Adjust existing layout rules.** Replace rigid tracks at the failing breakpoint with minmax/clamped tracks or stacking, allow library item labels to wrap, increase the current 9–11px text where it harms reading, and expose the live library through a keyboard-operable narrow-screen control if stacking alone does not suffice. Keep canvas scrolling and zoom intact.
- [ ] **Step 4: Verify neighboring behavior.** Repeat viewport captures, keyboard tab order, library add/drag, selected-node editing, canvas pan/zoom, and fixture/live wording. Run `corepack pnpm typecheck` and `corepack pnpm build:showcase`.
- [ ] **Step 5: Commit the layout slice.** Stage only the layout files and any focused check after inspecting the diff.

## Handoff

This plan does not implement an outbound Webhook/HTTP effect. If outbound delivery is later confirmed as product scope, write a separate design and plan for a governed effect with destination policy, SSRF controls, credential storage, idempotent dispatch, receipts, approval, and unknown-outcome handling before adding it to the live library.
