import { UploadIcon } from "lucide-react";
import type { ChangeEvent, DragEvent } from "react";
import { useState } from "react";

import { cn } from "../lib/utils";

type FileDropzoneProps = {
  accept?: string;
  className?: string;
  disabled?: boolean;
  formats?: string;
  hint: string;
  label: string;
  onFilesSelected: (files: Array<File>) => void;
};

const FileDropzone = ({
  accept,
  className,
  disabled = false,
  formats,
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

    event.target.value = "";
  };

  return (
    <div
      className="w-full"
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      role="presentation"
    >
      <label
        className={cn(
          "group border-foreground/15 bg-muted/40 hover:border-foreground/30 hover:bg-muted/70 has-[input:focus-visible]:ring-ring has-[input:focus-visible]:ring-offset-background data-dragging:border-primary data-dragging:bg-primary/5 flex w-full cursor-pointer flex-col items-center gap-1 rounded-2xl border border-dashed px-6 py-12 text-center has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-offset-2 data-disabled:cursor-not-allowed data-disabled:opacity-60 sm:py-14",
          className,
        )}
        data-disabled={disabled || undefined}
        data-dragging={dragging || undefined}
        data-slot="file-dropzone"
      >
        <span className="bg-background ring-foreground/10 group-data-dragging:ring-primary/40 mb-3 flex size-11 items-center justify-center rounded-full shadow-xs ring-1 sm:size-10">
          <UploadIcon aria-hidden className="text-muted-foreground size-5 shrink-0 sm:size-4" />
        </span>

        <p className="text-lg font-medium sm:text-base">{label}</p>

        <p className="text-muted-foreground text-base text-pretty sm:text-sm">{hint}</p>

        {formats === undefined ? null : (
          <p className="text-muted-foreground/80 mt-4 max-w-[44ch] text-sm text-pretty">
            {formats}
          </p>
        )}

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
