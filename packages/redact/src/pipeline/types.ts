import type { Detect, PiiLabel, Span } from "@repo/redact-core";

type DetectedText = { spans: Array<Span>; text: string };

type FileStageKey =
  | "stage.assembling"
  | "stage.detecting"
  | "stage.extracting"
  | "stage.finished"
  | "stage.reading"
  | "stage.recognising"
  | "stage.redacting"
  | "stage.rendering";

type WarningKey =
  | "warning.droppedCharacters"
  | "warning.lowConfidence"
  | "warning.noText"
  | "warning.notFullyRedacted"
  | "warning.scannedPages";

type FileProgress = (fraction: number, stage: FileStageKey) => void;

type RedactionResult = {
  blob: Blob;
  name: string;
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

type Mark = Span & { id: string };

type AnalysedReading = { marks: Array<Mark>; text: string };

/* A unit is one surface the file was read from: a whole text, an image, a page. It holds every
   reading of that surface, and only a scan has more than one: the pass the reader chose first,
   then the passes it passed over. */
type Analysis = {
  detections: Array<Detection>;
  units: Array<Array<AnalysedReading>>;
  warnings: Array<WarningKey>;
};

type Decisions = { covered: ReadonlyArray<string> };

type ApplyRequest = {
  analysis: Analysis;
  decisions: Decisions;
  file: File;
  onProgress: FileProgress;
};

/* What painting leaves: the file, the name that matches the format it was written in, the text
   still readable in it, and what painting had to give up. */
type Painted = { blob: Blob; name: string; visible: string; warnings: Array<WarningKey> };

type Redactor = {
  analyse: (file: File, detect: Detect, onProgress: FileProgress) => Promise<Analysis>;
  apply: (request: ApplyRequest) => Promise<Painted>;
};

type Bbox = { x0: number; x1: number; y0: number; y1: number };

type WordInput = { bbox: Bbox; text: string };

type PositionedWord = { bbox: Bbox; charEnd: number; charStart: number; text: string };

type Rect = { height: number; width: number; x: number; y: number };

export type {
  AnalysedReading,
  Analysis,
  ApplyRequest,
  Bbox,
  Decisions,
  DetectedText,
  Detection,
  FileProgress,
  FileStageKey,
  Mark,
  Painted,
  PositionedWord,
  Rect,
  RedactionResult,
  Redactor,
  WarningKey,
  WordInput,
};
