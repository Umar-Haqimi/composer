import { reconcileLine } from "@/domain/line/model";
import { useAudioStore } from "@/stores/audio";
import { useProjectStore } from "@/stores/project";
import { installUtilitiesUsedIn } from "@/test/browser-css";
import { render } from "@/test/render";
import { EditPanel } from "@/views/edit";
import { afterEach, describe, expect, it } from "vitest";

// -- Fixtures -----------------------------------------------------------------

const syncedLine = (n: number) =>
  reconcileLine({ id: `l${n}`, text: `Line number ${n}`, agentId: "v1", begin: n * 2, end: n * 2 + 2 });

const song = (count: number) => Array.from({ length: count }, (_, i) => syncedLine(i + 1));

let installed: HTMLStyleElement[] = [];

async function renderSizedPanel() {
  const screen = await render(
    <div style={{ display: "flex", flexDirection: "column", height: 360, width: 900 }}>
      <EditPanel />
    </div>,
  );
  installed.push(await installUtilitiesUsedIn(screen.container));
  return screen;
}

const row = (container: Element, lineNumber: number) =>
  container.querySelector<HTMLElement>(`[data-line-row="${lineNumber}"]`)!;

function mouse(type: string, target: EventTarget, x: number, y: number, buttons = 1) {
  target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, buttons }));
}

afterEach(() => {
  for (const style of installed) style.remove();
  installed = [];
});

// -- Tests --------------------------------------------------------------------

describe("EditPanel · preview sync", () => {
  it("highlights the line under the playhead in the preview and the textarea", async () => {
    useProjectStore.setState({ activeTab: "edit", lines: song(3), groups: [] });
    useAudioStore.setState({ currentTime: 4.5 });
    const screen = await renderSizedPanel();

    await expect.poll(() => row(screen.container, 2).hasAttribute("data-speaking")).toBe(true);
    expect(row(screen.container, 1).hasAttribute("data-speaking")).toBe(false);
    expect(screen.getByTestId("textarea-playing-bands").element().childElementCount).toBe(1);

    useAudioStore.setState({ currentTime: 6.5 });
    await expect.poll(() => row(screen.container, 3).hasAttribute("data-speaking")).toBe(true);
    expect(row(screen.container, 2).hasAttribute("data-speaking")).toBe(false);

    useAudioStore.setState({ currentTime: 0.5 });
    await expect.element(screen.getByTestId("textarea-playing-bands")).not.toBeInTheDocument();
  });

  it("selects every line a rubber band crosses", async () => {
    useProjectStore.setState({ activeTab: "edit", lines: song(5), groups: [] });
    const screen = await renderSizedPanel();
    await expect.poll(() => row(screen.container, 1).closest("[data-overlayscrollbars-viewport]")).toBeTruthy();
    const from = row(screen.container, 2).querySelector("[data-testid='line-preview-text']")!.getBoundingClientRect();
    const to = row(screen.container, 4).getBoundingClientRect();
    const start = row(screen.container, 2).querySelector("[data-testid='line-preview-text']")!;

    mouse("mousedown", start, from.left + 2, from.top + 4);
    mouse("mousemove", window, from.left + 40, to.top + 4);
    await expect.element(screen.getByTestId("preview-rubber-band")).toBeInTheDocument();
    mouse("mouseup", window, from.left + 40, to.top + 4, 0);
    // The click that follows the drag must not toggle the row under the pointer.
    mouse("click", start, from.left + 40, to.top + 4, 0);

    await expect.element(screen.getByText("3 lines selected")).toBeInTheDocument();
    await expect.element(screen.getByTestId("preview-rubber-band")).not.toBeInTheDocument();
  });

  it("keeps the textarea and the preview scrolled to the same line", async () => {
    useProjectStore.setState({ activeTab: "edit", lines: song(80), groups: [] });
    const screen = await renderSizedPanel();
    const textarea = screen.container.querySelector("textarea")!;
    const viewport = () => row(screen.container, 1).closest<HTMLElement>("[data-overlayscrollbars-viewport]")!;
    await expect.poll(() => viewport()).toBeTruthy();

    textarea.scrollTop = 28 * 30;
    textarea.dispatchEvent(new Event("scroll"));

    await expect
      .poll(() => row(screen.container, 31).getBoundingClientRect().top - viewport().getBoundingClientRect().top)
      .toBeLessThan(10);
    expect(
      Math.abs(row(screen.container, 31).getBoundingClientRect().top - viewport().getBoundingClientRect().top),
    ).toBeLessThan(10);

    viewport().scrollTop = 0;
    viewport().dispatchEvent(new Event("scroll"));
    await expect.poll(() => textarea.scrollTop).toBe(0);
  });
});
