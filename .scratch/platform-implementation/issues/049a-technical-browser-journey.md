# 049a: Technical Implementation browser journey

**Source:** [local Technical Implementation specification](../../../docs/superpowers/specs/2026-09-14-10-local-technical-implementation-spec.md)

**What to build:** Wire accepted agreement, Case creation, discovery, information request, revised plan, exact approval, SQL/Blob/Boards effects, production handoff and evidence to the existing shell and Case/Operations views.

**Blocked by:** 049: Reset/repeat, 043a: Operations browser
**Status:** complete
**Produces:** fixture-labeled browser M8 journey

- [x] A browser operator can run the complete seeded fixture journey without direct database/tool calls; every action has owner receipt and visible Case/projection correlation.
- [x] Exercise only registered `browser.v1` routes and validated package-specific form/response codecs; a stale version, malformed fixture or missing owner route cannot advance the Case display.
- [x] Denial, dependency failure, possible-send timeout, reconciliation, recovery and reset appear as distinct safe states; evidence links preserve fixture labels. No fake result is presented as live SQL/Blob/Boards evidence.
- [x] One repeatable end-to-end browser run with reset and root verification pass.
