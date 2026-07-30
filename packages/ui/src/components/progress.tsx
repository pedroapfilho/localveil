import { Progress as ProgressPrimitive } from "@base-ui/react/progress";
import type { ComponentProps } from "react";

import { cn } from "../lib/utils";

type ProgressProps = Omit<ComponentProps<typeof ProgressPrimitive.Root>, "value"> & {
  label: string;
  value: number;
};

const clampFraction = (value: number) => {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(1, Math.max(0, value));
};

// By transform rather than by growing a box: width is a layout property, and a
// download arriving in eight-megabyte steps would jerk through three rendering stages
// on every one.
//
// 200ms rather than 300 because those steps land about that often, and a transition
// longer than the gap between them never settles: the bar reads as permanently behind
// the number beside it.
const Progress = ({ className, label, value, ...props }: ProgressProps) => {
  const fraction = clampFraction(value);

  return (
    <ProgressPrimitive.Root
      aria-label={label}
      className={cn("w-full", className)}
      data-slot="progress"
      max={100}
      value={Math.round(fraction * 100)}
      {...props}
    >
      <ProgressPrimitive.Track className="bg-muted h-1 w-full overflow-hidden rounded-full">
        <ProgressPrimitive.Indicator
          className="bg-primary h-full w-full origin-left transition-transform duration-200 ease-linear motion-reduce:transition-none"
          data-slot="progress-indicator"
          style={{ transform: `scaleX(${String(fraction)})` }}
        />
      </ProgressPrimitive.Track>
    </ProgressPrimitive.Root>
  );
};

export { Progress };
export type { ProgressProps };
