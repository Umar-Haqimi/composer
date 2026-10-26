# Tasks: Ghost groups and inline group rename

See `tasks/plan.md` and `SPEC.md`.

- [ ] T1: Extract shared grouping-suggestions hook (refactor)
  - Acceptance: `useVisibleGroupingSuggestions`, `acceptSuggestion` and `dismissSuggestions` live in
    `src/views/grouping/use-grouping-suggestions.ts`; `useGroupingNotice` uses them; notice behavior unchanged.
  - Verify: `pnpm typecheck`; `pnpm test:component` (existing `edit.grouping` and `use-grouping-notice` tests green).
  - Files: `src/views/grouping/use-grouping-suggestions.ts` (new), `src/views/grouping/use-grouping-notice.tsx`

- [ ] T2: Extract preview row rendering out of `edit.tsx` (refactor)
  - Acceptance: `<PreviewRows>` renders parsed rows and real group headers; `edit.tsx` only passes props/handlers;
    `edit.tsx` line count goes down; no visible change.
  - Verify: `pnpm typecheck`; `pnpm test:component` (all `edit.*.browser.test.tsx` green).
  - Files: `src/views/edit.tsx`, `src/views/edit/preview-rows.tsx` (new)

- [ ] T3: Ghost groups in the preview (test-first)
  - Acceptance: test 1 from SPEC passes; each run of a visible suggestion shows a faded header (Suggested,
    `n of m`, Group, Dismiss) and faded row tint; Group and Dismiss match the notice; ghost buttons don't
    affect selection.
  - Verify: write test 1 in `edit.grouping.browser.test.tsx`, see it fail for the right reason, implement,
    `pnpm test:component`; check in `pnpm dev`.
  - Files: `src/views/edit/preview-rows.tsx`, `src/views/edit/preview-group-header.tsx` (new, header + ghost
    variant moved from `line-preview.tsx`), `src/views/edit/line-preview.tsx`, `src/views/grouping/ghost-runs.ts`
    (new, pure lineId mapping), `src/views/edit.grouping.browser.test.tsx`

- [ ] T4: Move `RenameInput` to a shared primitive (refactor)
  - Acceptance: `src/ui/rename-input.tsx` exports `RenameInput` with a `className` prop; the timeline header
    imports it; timeline rename unchanged.
  - Verify: `pnpm typecheck`; `pnpm knip`; manual double-click rename in the timeline.
  - Files: `src/ui/rename-input.tsx` (new), `src/views/timeline/group-header-row.tsx`

- [ ] T5: Double-click rename on preview group headers (test-first)
  - Acceptance: test 2 from SPEC passes; double-click opens the input (prefilled, selected); Enter or blur
    saves, Escape cancels, empty keeps the old name; Enter on the focused name starts rename; undo reverts.
  - Verify: write test 2, see it fail, implement, `pnpm test:component`.
  - Files: `src/views/edit/preview-group-header.tsx`, `src/views/edit/preview-rows.tsx`,
    `src/views/edit.grouping.browser.test.tsx`

- [ ] T6: Gates and manual check
  - Acceptance: every SPEC success criterion is checked off.
  - Verify: `pnpm typecheck && pnpm test:unit && pnpm test:component && pnpm jscpd && pnpm lint:fix && pnpm knip`;
    in `pnpm dev`: ghosts match the notice, dismiss and restore round-trip, rubber-band drag next to ghost
    headers, rename in both the preview and the timeline; `graphify update .`
  - Files: none expected
