import type { ComponentProps } from "react";

import { cn } from "../lib/utils";

type CheckboxProps = Omit<ComponentProps<"input">, "type"> & { indeterminate?: boolean };

const Checkbox = ({ className, indeterminate = false, ...props }: CheckboxProps) => (
  <span className={cn("group inline-grid size-5 grid-cols-1 sm:size-4", className)}>
    <input
      className="border-input checked:border-primary checked:bg-primary indeterminate:border-primary indeterminate:bg-primary focus-visible:outline-ring disabled:border-input disabled:bg-muted disabled:checked:bg-muted col-start-1 row-start-1 appearance-none rounded-sm border bg-white focus-visible:outline-2 focus-visible:outline-offset-2 forced-colors:appearance-auto"
      ref={(node) => {
        if (node !== null) {
          node.indeterminate = indeterminate;
        }
      }}
      type="checkbox"
      {...props}
    />

    <svg
      className="group-has-disabled:stroke-muted-foreground pointer-events-none col-start-1 row-start-1 size-7/8 self-center justify-self-center stroke-white"
      fill="none"
      viewBox="0 0 14 14"
    >
      <path
        className="group-not-has-checked:opacity-0"
        d="M3 8L6 11L11 3.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />

      <path
        className="group-not-has-indeterminate:opacity-0"
        d="M3 7H11"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  </span>
);

export { Checkbox };
export type { CheckboxProps };
