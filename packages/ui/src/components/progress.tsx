import { Progress as ProgressPrimitive } from "@base-ui/react/progress";
import type { ComponentProps, CSSProperties } from "react";

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

const Progress = ({ className, label, value, ...props }: ProgressProps) => {
  const fraction = clampFraction(value);
  const fillStyle: CSSProperties & { "--progress-fraction": number } = {
    "--progress-fraction": fraction,
  };

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
          className="progress-fill bg-primary h-full w-full origin-left transition-transform duration-200 ease-linear motion-reduce:transition-none"
          data-slot="progress-indicator"
          style={fillStyle}
        />
      </ProgressPrimitive.Track>
    </ProgressPrimitive.Root>
  );
};

export { Progress };
export type { ProgressProps };
