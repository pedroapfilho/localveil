import { ScrollArea as ScrollAreaPrimitive } from "@base-ui/react/scroll-area";
import type { ComponentProps } from "react";

import { cn } from "../lib/utils";

const ScrollBar = ({
  className,
  orientation = "vertical",
  ...props
}: ComponentProps<typeof ScrollAreaPrimitive.Scrollbar>) => (
  <ScrollAreaPrimitive.Scrollbar
    className={cn(
      "flex touch-none p-px opacity-0 transition-opacity select-none data-hovering:opacity-100 data-scrolling:opacity-100",
      orientation === "vertical" && "h-full w-1.5",
      orientation === "horizontal" && "h-1.5 flex-col",
      className,
    )}
    data-slot="scroll-area-scrollbar"
    orientation={orientation}
    {...props}
  >
    <ScrollAreaPrimitive.Thumb className="bg-foreground/20 flex-1 rounded-full" />
  </ScrollAreaPrimitive.Scrollbar>
);

type ScrollAreaProps = ComponentProps<typeof ScrollAreaPrimitive.Root> & {
  viewportClassName?: string;
};

const ScrollArea = ({ children, className, viewportClassName, ...props }: ScrollAreaProps) => (
  <ScrollAreaPrimitive.Root
    className={cn("relative", className)}
    data-slot="scroll-area"
    {...props}
  >
    <ScrollAreaPrimitive.Viewport
      className={cn(
        "focus-visible:outline-ring size-full overscroll-contain focus-visible:outline-2 focus-visible:-outline-offset-2",
        viewportClassName,
      )}
      data-slot="scroll-area-viewport"
    >
      {children}
    </ScrollAreaPrimitive.Viewport>

    <ScrollBar />
  </ScrollAreaPrimitive.Root>
);

export { ScrollArea, ScrollBar };
export type { ScrollAreaProps };
