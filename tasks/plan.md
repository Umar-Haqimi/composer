# Plan: Ghost groups and inline group rename

Implements `SPEC.md` (approved 2026-10-26).

## Approach

Refactor first, with no behavior change, so that each owner exists in one place. Then add the two
features on top, each test-first.

```
T1 shared suggestions hook ──┐
T2 extract <PreviewRows> ────┼──> T3 ghost groups (test 1)
                             │
T4 shared RenameInput ───────┴──> T5 preview rename (test 2)
                                         │
                                         v
                                  T6 gates + manual check
```

- T1, T2 and T4 are independent refactors and can be done in any order.
- T3 needs T1 (the hook) and T2 (the place to render ghosts).
- T5 needs T2 (the header lives in `PreviewRows`) and T4 (the shared input).

## Key design points

- **One owner for suggestions.** `useVisibleGroupingSuggestions` returns `{ visible, dismissedFingerprints }`.
  `acceptSuggestion(section)` and `dismissSuggestions(fingerprints)` move into the same module, and both
  `useGroupingNotice` and the ghost header call them.
- **Ghost mapping by line id.** A small pure helper turns `visible` plus store `lines` into
  `Map<lineId, { section, runOrdinal, isFirstOfRun }>`. `PreviewRows` looks up each `ParsedLine.lineId`
  in it. That way a pending text debounce can't put a ghost on the wrong row.
- **Ghost row tint.** `LinePreview` gets a `ghost` flag (or a neutral `groupColor` plus a
  `provisional` flag) so `rowBodyTone` gives a fainter tint. Real `groupColor` still wins: suggestions
  only cover ungrouped lines, so the two never overlap.
- **Rename state** is `useState<string | null>` (the group id being renamed) in `PreviewRows`. It's
  stored per group, not per instance: only the header that was double-clicked shows the input, and the
  committed label updates every run.
- **Event isolation.** Ghost buttons and the rename input stop `mousedown` and `click` propagation, so
  the rubber-band container and row selection never see them. The input also stops `keydown`, as the
  timeline input already does.

## Risks

| Risk | Mitigation |
|---|---|
| `edit.tsx` (allowlisted at 610 lines) grows | T2 moves the row loop out first; T6 checks the line count went down |
| `line-preview.tsx` passes 300 lines | Put `PreviewGroupHeader` and the ghost header in `edit/preview-group-header.tsx` |
| Moving `RenameInput` breaks timeline rename (no existing test) | Manual timeline rename check in T4 and T6 |
| Ghost buttons break the rubber band or selection | Covered by stopPropagation; manual drag check in T6 |
| jscpd flags ghost and real header as duplicates | Share the band markup through one component with a `variant` prop |

## Checkpoints

- After T1, T2 and T4: `pnpm typecheck && pnpm test:component` all green, no visible change.
- After T3: test 1 passes, and ghosts look right in `pnpm dev`.
- After T5 and T6: all gates pass, manual checklist done, `graphify update .` run.
