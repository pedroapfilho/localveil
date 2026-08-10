import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import type { ComponentProps } from "react";

import { cn } from "../lib/utils";

const Popover = ({ ...props }: ComponentProps<typeof PopoverPrimitive.Root>) => (
  <PopoverPrimitive.Root data-slot="popover" {...props} />
);

const PopoverTrigger = ({
  className,
  ...props
}: ComponentProps<typeof PopoverPrimitive.Trigger>) => (
  <PopoverPrimitive.Trigger
    className={cn(
      "focus-visible:outline-ring outline-none focus-visible:outline-2 focus-visible:outline-offset-2",
      className,
    )}
    data-slot="popover-trigger"
    {...props}
  />
);

const PopoverContent = ({
  children,
  className,
  sideOffset = 6,
  ...props
}: ComponentProps<typeof PopoverPrimitive.Popup> & { sideOffset?: number }) => (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Positioner
      className="z-50 max-w-[min(20rem,calc(100vw-2rem))]"
      sideOffset={sideOffset}
    >
      <PopoverPrimitive.Popup
        className={cn(
          "bg-popover text-popover-foreground ring-foreground/10 data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-closed:zoom-out-95 data-open:zoom-in-95 origin-(--transform-origin) rounded-xl p-3 shadow-md ring-1 duration-150 outline-none",
          className,
        )}
        data-slot="popover-content"
        {...props}
      >
        {children}
      </PopoverPrimitive.Popup>
    </PopoverPrimitive.Positioner>
  </PopoverPrimitive.Portal>
);

const PopoverDescription = ({
  className,
  ...props
}: ComponentProps<typeof PopoverPrimitive.Description>) => (
  <PopoverPrimitive.Description
    className={cn("text-muted-foreground text-base text-pretty sm:text-sm", className)}
    data-slot="popover-description"
    {...props}
  />
);

const PopoverTitle = ({ className, ...props }: ComponentProps<typeof PopoverPrimitive.Title>) => (
  <PopoverPrimitive.Title
    className={cn("text-base font-medium sm:text-sm", className)}
    data-slot="popover-title"
    {...props}
  />
);

export { Popover, PopoverContent, PopoverDescription, PopoverTitle, PopoverTrigger };
