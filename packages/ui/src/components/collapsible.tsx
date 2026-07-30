import { Collapsible as CollapsiblePrimitive } from "@base-ui/react/collapsible";
import type { ComponentProps } from "react";

import { cn } from "../lib/utils";

const Collapsible = ({ ...props }: ComponentProps<typeof CollapsiblePrimitive.Root>) => (
  <CollapsiblePrimitive.Root data-slot="collapsible" {...props} />
);

const CollapsibleTrigger = ({
  className,
  ...props
}: ComponentProps<typeof CollapsiblePrimitive.Trigger>) => (
  <CollapsiblePrimitive.Trigger
    className={cn(
      "focus-visible:outline-ring outline-none focus-visible:outline-2 focus-visible:outline-offset-2",
      className,
    )}
    data-slot="collapsible-trigger"
    {...props}
  />
);

// The height comes from Base UI as a variable because only it can measure a panel
// that is closed. Animated in CSS rather than by a spring so a panel opened during a
// scroll does not fight the scroll for frames.
const CollapsiblePanel = ({
  className,
  ...props
}: ComponentProps<typeof CollapsiblePrimitive.Panel>) => (
  <CollapsiblePrimitive.Panel
    className={cn(
      "h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] data-ending-style:h-0 data-starting-style:h-0 motion-reduce:transition-none",
      className,
    )}
    data-slot="collapsible-panel"
    {...props}
  />
);

export { Collapsible, CollapsiblePanel, CollapsibleTrigger };
