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

type Progress = (fraction: number, stage: string) => void;

type RedactionResult = {
  blob: Blob;
  redactionCount: number;
  warnings: Array<string>;
};

type Redactor = {
  accepts: (file: File) => boolean;
  redact: (file: File, detect: Detect, onProgress: Progress) => Promise<RedactionResult>;
};

type Bbox = { x0: number; x1: number; y0: number; y1: number };

type PositionedWord = { bbox: Bbox; charEnd: number; charStart: number; text: string };

type Rect = { height: number; width: number; x: number; y: number };

export type {
  Bbox,
  Detect,
  PiiLabel,
  PositionedWord,
  Progress,
  Rect,
  RedactionResult,
  Redactor,
  Span,
};
