import type { ComponentProps } from "react";

import { Progress } from "../components/progress";

type FractionProgressProps = Omit<ComponentProps<typeof Progress>, "value" | "max"> & {
  label: string;
  value: number;
};

const FractionProgress = ({ label, value, ...props }: FractionProgressProps) => {
  const fraction = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;

  return <Progress aria-label={label} max={100} value={Math.round(fraction * 100)} {...props} />;
};

export { FractionProgress };
