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

type DocumentLanguage = "en" | "es" | "pt";

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

type WarningKey =
  | "warning.droppedCharacters"
  | "warning.lowConfidence"
  | "warning.noText"
  | "warning.notFullyRedacted"
  | "warning.scannedPages";

type FileProgress = (fraction: number, stage: FileStageKey) => void;

type ModelProgress = (fraction: number, stage: ModelStageKey) => void;

type RedactionResult = {
  blob: Blob;
  redactionCount: number;
  warnings: Array<WarningKey>;
};

type Detection = {
  confidence: number;
  end: number;
  id: string;
  label: PiiLabel;
  page?: number;
  preview: string;
  start: number;
};

type Analysis = {
  detections: Array<Detection>;
  handle: unknown;
  warnings: Array<WarningKey>;
};

type Decisions = { covered: ReadonlyArray<string> };

type ApplyRequest = {
  analysis: Analysis;
  decisions: Decisions;
  detect: Detect;
  file: File;
  onProgress: FileProgress;
};

type Redactor = {
  accepts: (file: File) => boolean;
  analyse: (file: File, detect: Detect, onProgress: FileProgress) => Promise<Analysis>;
  apply: (request: ApplyRequest) => Promise<RedactionResult>;
};

type Bbox = { x0: number; x1: number; y0: number; y1: number };

type PositionedWord = { bbox: Bbox; charEnd: number; charStart: number; text: string };

type Rect = { height: number; width: number; x: number; y: number };

export type {
  Analysis,
  ApplyRequest,
  Bbox,
  Decisions,
  Detect,
  Detection,
  DocumentLanguage,
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
