import { LYRICS_FORMATS_PROSE } from "@/domain/lyrics-file/supported-formats";
import { cn } from "@/utils/cn";
import { PROJECT_FILE_PROSE } from "@/views/lyrics-import-modal/accepted-files";
import { type RefObject, useCallback, useEffect, useMemo } from "react";

// -- Interfaces ---------------------------------------------------------------

interface EditTextInputProps {
  textareaId: string;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  backdropRef: RefObject<HTMLDivElement | null>;
  rawText: string;
  currentLineNumber: number | null;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onFocus: () => void;
  onBlur: () => void;
  onCompositionStart: () => void;
  onCompositionEnd: (e: React.CompositionEvent<HTMLTextAreaElement>) => void;
  onPaste: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  onScroll: (scrollTop: number) => void;
}

// -- Constants ----------------------------------------------------------------

const LYRICS_TEXTAREA_PLACEHOLDER = `Paste your lyrics here, one line at a time...

Or paste or drop a whole lyrics file (${LYRICS_FORMATS_PROSE}) or ${PROJECT_FILE_PROSE} to import it`;

// The backdrop wraps exactly like the textarea only while both share every text metric.
const TEXT_METRICS = "py-2 px-3.5 text-sm font-medium leading-7 whitespace-pre-wrap wrap-break-word";

// -- Components ---------------------------------------------------------------

const EditTextInput: React.FC<EditTextInputProps> = ({
  textareaId,
  textareaRef,
  backdropRef,
  rawText,
  currentLineNumber,
  onChange,
  onFocus,
  onBlur,
  onCompositionStart,
  onCompositionEnd,
  onPaste,
  onScroll,
}) => {
  const rows = useMemo(() => rawText.split("\n"), [rawText]);

  const handleScroll = useCallback(
    (e: React.UIEvent<HTMLTextAreaElement>) => {
      const { scrollTop } = e.currentTarget;
      const backdrop = backdropRef.current;
      if (backdrop && backdrop.scrollTop !== scrollTop) backdrop.scrollTop = scrollTop;
      onScroll(scrollTop);
    },
    [backdropRef, onScroll],
  );

  // A native scrollbar narrows the textarea's text column; the backdrop follows that width so rows wrap alike.
  useEffect(() => {
    const textarea = textareaRef.current;
    const backdrop = backdropRef.current;
    if (!textarea || !backdrop) return;
    const fitBackdrop = () => {
      const width = `${textarea.clientWidth}px`;
      if (backdrop.style.width !== width) backdrop.style.width = width;
      if (backdrop.scrollTop !== textarea.scrollTop) backdrop.scrollTop = textarea.scrollTop;
    };
    fitBackdrop();
    const observer = new ResizeObserver(fitBackdrop);
    observer.observe(textarea);
    return () => observer.disconnect();
  }, [textareaRef, backdropRef]);

  return (
    <div className="flex flex-col flex-1 min-w-0">
      <label
        htmlFor={textareaId}
        className="flex items-center self-start h-7 mb-2 text-[13px] font-medium select-none text-(--label)"
      >
        Paste or type lyrics
      </label>
      <div className="relative flex-1 min-h-0 rounded-xl bg-(--well)">
        <div
          ref={backdropRef}
          aria-hidden
          className={cn(
            TEXT_METRICS,
            "absolute inset-px box-border overflow-hidden text-transparent select-none pointer-events-none",
          )}
        >
          {rows.map((row, index) => (
            <div
              key={index}
              data-edit-line={index + 1}
              className={cn(
                "min-h-7 -mx-2 px-2 rounded-md",
                index + 1 === currentLineNumber && "bg-composer-accent/15",
              )}
            >
              {row}
            </div>
          ))}
        </div>
        {/* react-doctor-disable-next-line react-doctor/control-has-associated-label */}
        <textarea
          id={textareaId}
          ref={textareaRef}
          value={rawText}
          onChange={onChange}
          onFocus={onFocus}
          onBlur={onBlur}
          onCompositionStart={onCompositionStart}
          onCompositionEnd={onCompositionEnd}
          onPaste={onPaste}
          onScroll={handleScroll}
          placeholder={LYRICS_TEXTAREA_PLACEHOLDER}
          className={cn(
            TEXT_METRICS,
            "absolute inset-0 border rounded-xl resize-none bg-transparent border-(--edge) caret-composer-accent focus:outline-none focus:border-(--lit-ring) placeholder:text-(--muted)",
          )}
          spellCheck={false}
        />
      </div>
    </div>
  );
};

// -- Exports ------------------------------------------------------------------

export { EditTextInput };
