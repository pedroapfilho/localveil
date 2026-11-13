import type { PiiLabel } from "./labels";

type Span = { end: number; label: PiiLabel; score: number; start: number };

type Detect = (text: string) => Promise<Array<Span>>;

export type { Detect, Span };
