import { UploadIcon } from "lucide-react";
import type { ChangeEvent, DragEvent } from "react";
import { useState } from "react";

import { cn } from "../lib/utils";

type FileDropzoneProps = {
  accept?: string;
  className?: string;
  disabled?: boolean;
  hint: string;
  label: string;
  onFilesSelected: (files: Array<File>) => void;
};

const FileDropzone = ({
  accept,
  className,
  disabled = false,
  hint,
  label,
  onFilesSelected,
}: FileDropzoneProps) => {
  const [dragging, setDragging] = useState(false);

  const report = (files: FileList | null) => {
    const selected = files === null ? [] : [...files];

    if (selected.length > 0) {
      onFilesSelected(selected);
    }
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();

    if (!disabled) {
      setDragging(true);
    }
  };

  const handleDragLeave = () => {
    setDragging(false);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);

    if (!disabled) {
      report(event.dataTransfer.files);
    }
  };

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    report(event.target.files);
    // Clearing the value is what lets the same file be picked twice in a row: an
    // unchanged value fires no change event.
    event.target.value = "";
  };

  return (
    // The drag handlers sit on a presentational wrapper rather than on the label:
    // a label carries no interactive role, and the real control is the nested
    // input, which is visually hidden and so cannot be the drop surface itself.
    <div
      className="w-full"
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      role="presentation"
    >
      {/* Making the zone the label means a click anywhere in it reaches the input
          through native label activation, and keyboard users get the input's own
          Enter and Space behaviour with no key handling of ours. */}
      <label
        className={cn(
          "border-foreground/20 bg-card hover:border-foreground/40 has-[input:focus-visible]:ring-ring has-[input:focus-visible]:ring-offset-background data-[dragging=true]:border-primary data-[dragging=true]:bg-primary/5 flex w-full cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed px-6 py-12 text-center transition-colors has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-offset-2 data-[disabled=true]:cursor-not-allowed data-[disabled=true]:opacity-60",
          className,
        )}
        data-disabled={disabled}
        data-dragging={dragging || undefined}
        data-slot="file-dropzone"
      >
        <UploadIcon aria-hidden className="text-muted-foreground size-6" />

        <span className="font-medium">{label}</span>

        <span className="text-muted-foreground text-sm">{hint}</span>

        <input
          accept={accept}
          className="sr-only"
          disabled={disabled}
          multiple
          onChange={handleChange}
          type="file"
        />
      </label>
    </div>
  );
};

export { FileDropzone };
export type { FileDropzoneProps };
