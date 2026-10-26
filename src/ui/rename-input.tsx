import { cn } from "@/utils/cn";
import { focusAndSelectOnMount } from "@/utils/focus-and-select-on-mount";
import { useState } from "react";

// Stops key and click events so typing never reaches global shortcuts and clicks never reach the header behind.
const RenameInput: React.FC<{
  initialValue: string;
  onCommit: (next: string) => void;
  onCancel: () => void;
  ariaLabel: string;
  className?: string;
}> = ({ initialValue, onCommit, onCancel, ariaLabel, className }) => {
  const [value, setValue] = useState(() => initialValue);
  return (
    <input
      ref={focusAndSelectOnMount}
      type="text"
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") onCommit(value);
        else if (e.key === "Escape") onCancel();
        e.stopPropagation();
      }}
      onBlur={() => onCommit(value)}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      className={cn("bg-transparent font-semibold text-composer-text focus:outline-none px-0", className)}
    />
  );
};

export { RenameInput };
