type PiiLabel =
  | "account_number"
  | "private_address"
  | "private_date"
  | "private_email"
  | "private_person"
  | "private_phone"
  | "private_url"
  | "secret";

type Span = { end: number; label: PiiLabel; score: number; start: number };

type Detect = (text: string) => Promise<Array<Span>>;

// Progress crosses a worker boundary and ends up on screen, where the redactor
// has no idea which language the reader picked, so a stage is a translation key
// rather than a sentence.
type ModelStageKey = "model.downloading" | "model.ready" | "model.slowDevice";

type FileStageKey =
  | "stage.assembling"
  | "stage.detecting"
  | "stage.extracting"
  | "stage.finished"
  | "stage.loadingModel"
  | "stage.reading"
  | "stage.recognising"
  | "stage.redacting"
  | "stage.rendering";

type StageKey = FileStageKey | ModelStageKey;

// Warnings reach the same screen as the stages and cross the same worker boundary,
// so they are keys for the same reason. They carry no values: a reader needs to know
// the result is shaky, not which page scored what.
type WarningKey =
  | "warning.droppedCharacters"
  | "warning.lowConfidence"
  | "warning.noText"
  | "warning.scannedPages";

// The two halves stay apart because only the model keys take a placeholder, and a
// caller that hands "model.downloading" to a plain lookup gets a throw at runtime.
type FileProgress = (fraction: number, stage: FileStageKey) => void;

type ModelProgress = (fraction: number, stage: ModelStageKey) => void;

type RedactionResult = {
  blob: Blob;
  redactionCount: number;
  warnings: Array<WarningKey>;
};

type Redactor = {
  accepts: (file: File) => boolean;
  redact: (file: File, detect: Detect, onProgress: FileProgress) => Promise<RedactionResult>;
};

type Bbox = { x0: number; x1: number; y0: number; y1: number };

type PositionedWord = { bbox: Bbox; charEnd: number; charStart: number; text: string };

type Rect = { height: number; width: number; x: number; y: number };

export type {
  Bbox,
  Detect,
  FileProgress,
  FileStageKey,
  ModelProgress,
  ModelStageKey,
  PiiLabel,
  PositionedWord,
  Rect,
  RedactionResult,
  Redactor,
  Span,
  StageKey,
  WarningKey,
};
