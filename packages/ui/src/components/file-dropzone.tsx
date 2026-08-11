import { FolderOpenIcon, UploadIcon } from "lucide-react";
import type { ChangeEvent, DragEvent } from "react";
import { useRef, useState } from "react";

import type { SelectedFile, Selection } from "../lib/dropped-files";
import { droppedFiles, pickedDirectoryFiles, selectedFiles } from "../lib/dropped-files";
import { cn } from "../lib/utils";

import { Button } from "./button";

type FileDropzoneProps = {
  accept?: string;
  className?: string;
  disabled?: boolean;
  folderLabel?: string;
  formats?: string;
  hint: string;
  label: string;
  onError?: () => void;
  onFilesSelected: (files: Array<SelectedFile>) => void;
  onLimitReached?: () => void;
};

const FileDropzone = ({
  accept,
  className,
  disabled = false,
  folderLabel,
  formats,
  hint,
  label,
  onError,
  onFilesSelected,
  onLimitReached,
}: FileDropzoneProps) => {
  const [dragging, setDragging] = useState(false);
  const directoryInputRef = useRef<HTMLInputElement>(null);

  const report = ({ files, limited }: Selection) => {
    if (limited) {
      onLimitReached?.();
    }

    if (files.length > 0) {
      onFilesSelected(files);
    }
  };

  const reportList = (files: FileList | null) => {
    report(selectedFiles(files ?? []));
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

  const handleDrop = async (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);

    if (!disabled) {
      try {
        report(await droppedFiles(event.dataTransfer));
      } catch {
        onError?.();
      }
    }
  };

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    reportList(event.target.files);

    event.target.value = "";
  };

  const handleFolder = async () => {
    if (disabled) {
      return;
    }

    try {
      const files = await pickedDirectoryFiles();

      if (files === undefined) {
        directoryInputRef.current?.click();
        return;
      }

      report(files);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        onError?.();
      }
    }
  };

  return (
    <div
      className="w-full"
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={(event) => {
        void handleDrop(event);
      }}
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
          <p className="text-muted-foreground mt-4 max-w-[44ch] text-sm text-pretty">{formats}</p>
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

      {folderLabel === undefined ? null : (
        <>
          <div className="mt-3 flex justify-center">
            <Button
              disabled={disabled}
              onClick={() => {
                void handleFolder();
              }}
              type="button"
              variant="outline"
            >
              <FolderOpenIcon aria-hidden data-icon="inline-start" />
              {folderLabel}
            </Button>
          </div>

          <input
            accept={accept}
            aria-hidden
            className="hidden"
            disabled={disabled}
            multiple
            onChange={handleChange}
            ref={(input) => {
              directoryInputRef.current = input;

              if (input !== null) {
                input.webkitdirectory = true;
              }
            }}
            tabIndex={-1}
            type="file"
          />
        </>
      )}
    </div>
  );
};

export { FileDropzone };
export type { FileDropzoneProps };
