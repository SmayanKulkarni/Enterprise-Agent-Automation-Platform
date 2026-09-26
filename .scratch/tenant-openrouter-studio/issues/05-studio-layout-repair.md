# 05 — Make live Studio blocks and selected-node controls readable

**What to build:** At the reported viewport and common desktop, tablet, and mobile widths, editors can read and reach the live block library, canvas, and selected-node controls without clipping or misleading webhook behavior.

**Blocked by:** None — can start immediately.

**Status:** implemented — visual verification pending

- [ ] Reproduce and record the repaired three-step live Studio layout at 1440, 1024, 768, and 390 CSS pixels, including 200% zoom.
- [x] Library labels and selected-node controls wrap/read clearly; narrow-screen users retain keyboard-operable access to adding live blocks.
- [ ] Canvas zoom, drag/drop, connection ports, inspector editing, and 200% browser zoom keep working.
- [x] The live library still excludes fixture-only outbound Webhook/HTTP blocks; signed inbound Webhook setup remains a Trigger mode.

## Implementation path

`StudioEditor` in `apps/browser/src/platform-app.tsx` renders `.studio-workspace` with `liveLibrary`, `.workflow-canvas`, and `Inspector`. `apps/browser/src/styles.css` currently uses rigid 224/500/330px tracks, then 190/430/280px tracks under 1100px, while the library disappears under 820px. Library/inspector text is commonly 9–11px. Reproduce before adjusting the existing grid tracks, wrapping and font sizes. If stacking cannot keep the live library reachable, add a small accessible narrow-screen reveal control in `StudioEditor`. Preserve the existing scene coordinate and zoom logic. The existing `.scratch/studio-ux-guidance/issues/02-live-studio-guidance.md` owns unfinished Trigger mode explanations and the link to `WebhookPanel`; complete that ticket rather than duplicate it here. Use its wording to distinguish inbound Trigger setup from the fixture-only outgoing placeholder.

## Blast radius and verification

The CSS selectors affect both live and fixture Studio. Compare both modes at each width and 200% zoom; check that library add, selected-node inspector, canvas scrolling, edge hit targets, keyboard order, focus visibility, and browser page zoom outside canvas remain correct. Do not infer the exact CSS defect from the handoff screenshot alone. No graph/compiler/runtime change is expected. This ticket can proceed in parallel with provider backend tickets; coordinate final Agent inspector spacing with ticket 04.

## Completed

The responsive implementation uses shrinkable center tracks and stacks the live library above the canvas and inspector below 820px; fixture-only HTTP and outbound Webhook blocks remain excluded by `liveLibrary`. The browser build passes; viewport and 200% zoom interaction checks remain to be recorded.
