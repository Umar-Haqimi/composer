# Spec: Ghost groups and inline group rename in the edit preview

## Objective

Make grouping visible and editable where the lyrics are: the preview panel on the right of the edit tab.

1. **Ghost groups.** Every visible grouping suggestion renders in the preview as a faded copy of a real
   group: a header band above each run plus tinted rows. The header has **Group** and **Dismiss**
   buttons. Today suggestions exist only as a header notice whose modal says "At lines 5 to 8, 21 to 24",
   which forces the user to map line numbers back to lyrics.
2. **Inline rename.** Double-clicking a real group's header band in the preview turns its name into a text
   field (same gesture as the timeline). The new name applies to the group, so every run of that group shows it.

User: the person editing lyrics in the edit tab (single user, local app).

### User stories

- As an editor, I see exactly which lines a suggestion would group, in context, before accepting it.
- As an editor, I accept or dismiss a suggestion from the preview without opening the notice modal.
- As an editor, I rename a group ("Group 1" to "Chorus") without leaving the edit tab.

## Behavior

### Ghost groups

- Source of truth: `findRepeatingStandaloneSections(lines)` filtered by `hiddenByDismissal(..., dismissedSuggestions)`,
  exactly as `useGroupingNotice` does today. Ghosts and notice must always show the same set.
- Each run (`starts[i]` .. `starts[i] + length - 1`) gets a ghost header band above its first line, styled
  like `PreviewGroupHeader` but visibly provisional (reduced opacity and a dashed edge; neutral accent tint,
  since the real color is only picked at creation). Rows in the run get the same faded tint.
- Header content: a "Suggested" label, run ordinal (`1 of 3`), then **Group** and **Dismiss** buttons.
  Buttons appear on every run's header; acting on any run acts on the whole suggestion.
- **Group** calls the same accept path as the notice row (`acceptOne`): one undo step, default label
  `Group N`, same toasts. The ghost is replaced by the real group header.
- **Dismiss** calls the same dismissal path as the notice (`dismissSuggestion(fingerprint)`). The ghost
  disappears; the notice's dismissed list can restore it, and the ghost reappears on restore.
- Ghosts map to preview rows by store line id (`lines[start + k].id` matched against `ParsedLine.lineId`),
  not by row index, so a pending text debounce cannot misplace them. Rows with no matching id get no ghost.
- Ghost buttons do not start a rubber-band selection or select rows (stop `mousedown` and `click` propagation).
- The header notice stays as is.

### Inline rename

- Double-clicking `PreviewGroupHeader` swaps the name for a text input, prefilled and fully selected,
  matching the timeline's `onDoubleClick` rename. The name carries `title="Double-click to rename"`.
- Keyboard fallback: the name is focusable (accessible name includes the group label) and Enter starts rename.
- Enter or blur commits, Escape cancels. Commit trims; empty or unchanged input is a no-op.
- Commit calls `updateGroup(id, { label })`, which already goes through `commitHistory`, so rename is one
  undo step via the existing global undo/redo.
- Only one header is in rename mode at a time. Rename state is local to the edit preview (not the
  timeline store's `renamingGroupId`).
- Keystrokes in the input do not reach global shortcuts or the lyrics textarea (`stopPropagation`, as the
  timeline `RenameInput` does).
- The header loses `aria-hidden` (it now holds controls); decorative parts stay hidden.

## Tech Stack

React 19, TypeScript, Zustand stores (`useProjectStore`), Tailwind v4 (theme in `src/index.css`), Tabler
icons, Biome. No new dependencies.

## Commands

```bash
pnpm dev               # vite-react-ssg dev
pnpm typecheck         # tsc -b
pnpm test:unit         # Vitest, jsdom
pnpm test:component    # Vitest browser mode (Playwright Chromium)
pnpm jscpd             # duplication check
pnpm lint:fix          # Biome lint + format (rewrites files)
pnpm knip              # unused exports / files
graphify update .      # refresh the knowledge graph after code changes
```

## Project Structure

Expected touch points:

```
src/views/edit.tsx                         -> replace the inline preview row loop with <PreviewRows />
src/views/edit/preview-rows.tsx            -> NEW: renders parsed rows, real group headers, ghost headers
src/views/edit/line-preview.tsx            -> PreviewGroupHeader gains rename; ghost variant (or sibling file
                                              if it would pass 300 lines)
src/views/grouping/use-grouping-suggestions.ts -> NEW: visible suggestions + accept/dismiss, shared by the
                                              notice hook and the ghost rows
src/views/grouping/use-grouping-notice.tsx -> consume the shared hook; accept/dismiss move out
src/ui/rename-input.tsx                    -> NEW: RenameInput moved from timeline/group-header-row.tsx,
                                              with a className prop; both headers use it
src/views/timeline/group-header-row.tsx    -> import the shared RenameInput
src/views/edit.grouping.browser.test.tsx   -> extend (see Testing)
```

Exact file names can change during planning. The constraints don't: `edit.tsx` must not grow, every file stays under the
300-line budget, and suggestion logic, accept/dismiss, and the rename input each have one owner.

## Code Style

Follow the surrounding code. Example of the intended shape for the shared suggestions hook:

```tsx
function useVisibleGroupingSuggestions(enabled = true) {
  const lines = useProjectStore((s) => s.lines);
  const dismissed = useProjectStore((s) => s.dismissedSuggestions);
  const suggestions = useMemo(() => (enabled ? findRepeatingStandaloneSections(lines) : []), [enabled, lines]);
  return useMemo(() => hiddenByDismissal(suggestions, dismissed), [suggestions, dismissed]);
}
```

- Path aliases, named exports, no barrels, no `any` / `@ts-ignore`.
- Comments rare, explaining why. No em dashes in code or copy.
- Buttons use the existing button primitives (`button-primitives` guard). Counts use `pluralize`.
- Colors via CSS variables and `color-mix`, matching `PreviewGroupHeader`.

## Testing Strategy

Per AGENTS.md: test-light, browser tests only for core user flows, extend the nearest file.

Approved, in `src/views/edit.grouping.browser.test.tsx` (written first, must fail first):

1. Ghost flow: with `songWithTwoChoruses()`, the preview shows a ghost header; clicking its **Group**
   creates one group over `c1a, c1b, c2a, c2b`; clicking **Dismiss** on a fresh render hides the ghost
   and adds the fingerprint to `dismissedSuggestions`.
2. Rename flow: double-click the group header, type "Chorus", Enter; `groups[0].label === "Chorus"`; undo restores
   the old label.

Not tested: ghost styling, opacity, button placement, Escape/blur variants (presentational or thin
wrappers over tested store actions).

Gates before done: `pnpm typecheck && pnpm test:unit && pnpm test:component && pnpm jscpd && pnpm lint:fix`,
plus a manual check in `pnpm dev`.

## Boundaries

- **Always:** reuse `findRepeatingStandaloneSections`, `hiddenByDismissal`, `groupRepeatingSections`,
  `dismissSuggestion`, `updateGroup`; run all gates; keep guard tests green; run `graphify update .` after changes.
- **Ask first:** changing suggestion detection, the store shape, history behavior, or the header notice's
  UI; adding a dependency; touching a guard test or its allowlist.
- **Never:** a second copy of suggestion or accept logic; growing `edit.tsx`; write to the store
  outside the existing history path; delete or weaken existing tests.

## Success Criteria

- [ ] With an ungrouped song containing a repeated block, the preview shows a faded header band above each run
      and faded tint on its rows, before any click.
- [ ] Ghost count and placement always match the notice's visible suggestions (including after dismiss and restore).
- [ ] **Group** on a ghost produces the same result as **Group** in the notice, in one undo step.
- [ ] **Dismiss** on a ghost hides it and it appears in the notice's dismissed list; restoring brings it back.
- [ ] Clicking ghost buttons never changes row selection or starts a rubber band.
- [ ] Double-clicking a real group's header in the preview opens an inline input; Enter or blur saves, Escape cancels;
      empty input keeps the old name.
- [ ] A rename shows on every run of that group, in the preview and the timeline, and undo reverts it.
- [ ] Timeline rename still works with the shared `RenameInput`.
- [ ] `edit.tsx` line count does not increase; all gates pass.

## Out of Scope

- Changes to how suggestions are detected.
- Naming a ghost before accepting it.
- Removing or redesigning the header notice.
- Renaming groups from other tabs (beyond keeping the timeline working).
- Changing or previewing group colors.

## Decisions

- Ghost tint: neutral accent (approved with the spec).
- Tests: the two browser tests above.
- Rename trigger: double-click, consistent with the timeline.

Status: approved 2026-10-26.
