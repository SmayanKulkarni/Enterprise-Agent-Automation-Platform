# 11 — Configure Operational Memory in Studio

**What to build:** A workflow editor can configure a Memory node's retrieval bounds and enable an Agent to propose source-linked Operational Memory through guided controls. The edited graph survives draft save, check, and publish without changing unrelated node settings or creating a browser memory-write path.

**Blocked by:** None — can start immediately.

**Status:** resolved

- [x] The authenticated inspector offers labeled integer controls for a Memory node's item limit (1–20) and character budget (1–4000), and explains its required Node policy without making that policy editable through these controls.
- [x] Invalid, empty, fractional, and out-of-range entries produce accessible feedback and do not silently change the draft. A valid edit preserves other configuration fields and clears the current publishable check.
- [x] The Agent inspector enables or disables an optional top-level `memoryProposals` array in the existing response schema while preserving unrelated output fields, required fields, and Agent configuration. Disabling removes only the proposal property and any reference to it in the required list.
- [x] Guidance names the admitted task-fact and stated-preference types, exact source ID/digest and excerpt requirements, text and subject bounds, and the three-proposal limit. It explains that server validation derives scope and rejects secrets, instructions, inferred traits, and unsourced claims.
- [x] A saved and checked draft with these controls can be published through the existing graph contract. A representative Workflow Run demonstrates that an Agent proposal is either promoted or recorded as rejected through the server path, never written directly by the browser.
- [x] Focused browser and workflow tests cover the control-to-draft behavior, schema preservation, invalid settings, and the published proposal path. Controls work with keyboard and assistive technology.
