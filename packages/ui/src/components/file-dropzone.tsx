import { FolderOpenIcon, UploadIcon } from "lucide-react";
import type { ChangeEvent, DragEvent } from "react";
import { useRef, useState } from "react";

import type { SelectedFile, Selection } from "../lib/dropped-files";
import { droppedFiles, pickedDirectoryFiles, selectedFiles } from "../lib/dropped-files";
import { cn } from "../lib/utils";

import { Menu, MenuContent, MenuItem, MenuTrigger } from "./menu";

type FileDropzoneProps = {
  accept?: string;
  className?: string;
  disabled?: boolean;
  filesLabel: string;
  folderLabel: string;
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
  filesLabel,
  folderLabel,
  formats,
  hint,
  label,
  onError,
  onFilesSelected,
  onLimitReached,
}: FileDropzoneProps) => {
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const directoryInputRef = useRef<HTMLInputElement>(null);

  const report = ({ files, limited }: Selection) => {
    if (limited) {
      onLimitReached?.();
    }

    if (files.length > 0) {
      onFilesSelected(files);
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
    report(selectedFiles(event.target.files ?? []));

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
      <Menu>
        <MenuTrigger
          className={cn(
            "group border-foreground/15 bg-muted/40 hover:border-foreground/30 hover:bg-muted/70 focus-visible:outline-ring data-dragging:border-primary data-dragging:bg-primary/5 flex w-full cursor-pointer flex-col items-center gap-1 rounded-2xl border border-dashed px-6 py-12 text-center focus-visible:outline-2 focus-visible:outline-offset-2 data-disabled:cursor-not-allowed data-disabled:opacity-60 sm:py-14",
            className,
          )}
          data-dragging={dragging || undefined}
          data-slot="file-dropzone"
          disabled={disabled}
        >
          <span className="bg-background ring-foreground/10 group-data-dragging:ring-primary/40 mb-3 flex size-11 items-center justify-center rounded-full shadow-xs ring-1 sm:size-10">
            <UploadIcon aria-hidden className="text-muted-foreground size-5 shrink-0 sm:size-4" />
          </span>

          <p className="text-lg font-medium sm:text-base">{label}</p>

          <p className="text-muted-foreground text-base text-pretty sm:text-sm">{hint}</p>

          {formats === undefined ? null : (
            <p className="text-muted-foreground mt-4 max-w-[44ch] text-sm text-pretty">{formats}</p>
          )}
        </MenuTrigger>

        <MenuContent>
          <MenuItem
            onClick={() => {
              fileInputRef.current?.click();
            }}
          >
            <UploadIcon aria-hidden className="size-4 shrink-0" />
            {filesLabel}
          </MenuItem>

          <MenuItem
            onClick={() => {
              void handleFolder();
            }}
          >
            <FolderOpenIcon aria-hidden className="size-4 shrink-0" />
            {folderLabel}
          </MenuItem>
        </MenuContent>
      </Menu>

      <input
        accept={accept}
        aria-label={filesLabel}
        className="hidden"
        disabled={disabled}
        multiple
        onChange={handleChange}
        ref={fileInputRef}
        tabIndex={-1}
        type="file"
      />

      <input
        accept={accept}
        aria-label={folderLabel}
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
    </div>
  );
};

export { FileDropzone };
export type { FileDropzoneProps };
