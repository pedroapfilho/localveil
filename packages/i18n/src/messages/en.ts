const en = {
  "app.name": "localveil",
  "app.skipToContent": "Skip to content",
  "app.tagline": "Redact personal data from your files. Nothing leaves your device.",
  "download.button": "Download ZIP ({count})",
  "download.excluded": "{count} files were left out because they failed.",
  "download.waiting": "Redact a file to enable the download.",
  "dropzone.formats": "Text, Markdown, CSV, JSON and log files",
  "dropzone.hint": "or drag and drop them here",
  "dropzone.label": "Choose files",
  "error.unknown": "Something went wrong.",
  "files.empty": "No files yet.",
  "files.heading": "Files",
  "files.noRedactions": "Nothing found to redact",
  "files.redactions": "{count} redacted",
  "files.remove": "Remove {name}",
  "locale.label": "Language",
  "model.downloading": "Downloading the detection model ({percent})",
  "model.ready": "Detection model ready",
  "model.slowDevice": "Running without GPU acceleration, this will be slow.",
  "stage.detecting": "Looking for personal data",
  "stage.finished": "Finished",
  "stage.loadingModel": "Loading the detection model",
  "stage.reading": "Reading the file",
  "stage.redacting": "Redacting",
  "status.done": "Done",
  "status.error": "Failed",
  "status.queued": "Queued",
  "status.running": "Working",
  "toast.downloaded": "Your ZIP is downloading.",
  "toast.failed": "Could not redact {name}.",
  "toast.unsupported": "{name} is not a supported file type.",
} as const;

type MessageKey = keyof typeof en;

type Messages = Record<MessageKey, string>;

export { en };
export type { MessageKey, Messages };
