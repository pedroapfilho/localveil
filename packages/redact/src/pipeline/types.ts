import type { Detect, Span } from "@repo/redact-core";

import type { FileStageKey } from "./stages";

type DetectedText = { spans: Array<Span>; text: string };

type WarningKey =
  | "warning.droppedCharacters"
  | "warning.lowConfidence"
  | "warning.noText"
  | "warning.notFullyRedacted"
  | "warning.scannedPages";

type FileProgress = (fraction: number, stage: FileStageKey) => void;

type StageProgress = (stage: FileStageKey, done?: number) => void;

type RedactionResult = {
  blob: Blob;
  name: string;
  redactionCount: number;
  warnings: Array<WarningKey>;
};

type Mark = Span & { id: string };

type Detection = Mark & { page?: number; preview: string };

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
  onProgress: StageProgress;
};

type Painted = { blob: Blob; name: string; visible: string; warnings: Array<WarningKey> };

type Redactor = {
  analyse: (file: File, detect: Detect, onProgress: StageProgress) => Promise<Analysis>;
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
  Mark,
  Painted,
  PositionedWord,
  Rect,
  RedactionResult,
  Redactor,
  StageProgress,
  WarningKey,
  WordInput,
};
