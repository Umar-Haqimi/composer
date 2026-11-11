// -- Types --------------------------------------------------------------------

interface ScrollRow {
  lineNumber: number;
  top: number;
  height: number;
}

// -- Constants ----------------------------------------------------------------

const ROW_SELECTOR = "[data-edit-line]";

// -- Functions ----------------------------------------------------------------

// Row tops are relative to the container's scroll content, so they stay valid at any scroll position.
function measureScrollRows(container: HTMLElement): ScrollRow[] {
  const containerTop = container.getBoundingClientRect().top - container.scrollTop;
  return [...container.querySelectorAll<HTMLElement>(ROW_SELECTOR)].map((row) => {
    const rect = row.getBoundingClientRect();
    return { lineNumber: Number(row.dataset.editLine), top: rect.top - containerTop, height: rect.height };
  });
}

function rowAtScrollTop(rows: readonly ScrollRow[], scrollTop: number): ScrollRow {
  let found = rows[0];
  for (const row of rows) {
    if (row.top <= scrollTop) found = row;
  }
  return found;
}

// The target scroll position that puts the source's top line at the target's top, at the same fraction into the line.
function alignedScrollTop(
  sourceRows: readonly ScrollRow[],
  targetRows: readonly ScrollRow[],
  sourceScrollTop: number,
): number | null {
  if (sourceRows.length === 0 || targetRows.length === 0) return null;
  const source = rowAtScrollTop(sourceRows, sourceScrollTop);
  const target = targetRows.find((row) => row.lineNumber === source.lineNumber);
  if (!target) return null;
  const fraction = source.height > 0 ? Math.max(0, (sourceScrollTop - source.top) / source.height) : 0;
  return Math.max(0, target.top + fraction * target.height);
}

// -- Exports ------------------------------------------------------------------

export { alignedScrollTop, measureScrollRows };
