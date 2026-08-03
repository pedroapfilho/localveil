import { Select as SelectPrimitive } from "@base-ui/react/select";
import { CheckIcon, ChevronDownIcon } from "lucide-react";
import type { ComponentProps } from "react";

import { cn } from "../lib/utils";

const Select = ({ ...props }: ComponentProps<typeof SelectPrimitive.Root>) => (
  <SelectPrimitive.Root data-slot="select" {...props} />
);

const SelectGroup = ({ ...props }: ComponentProps<typeof SelectPrimitive.Group>) => (
  <SelectPrimitive.Group data-slot="select-group" {...props} />
);

const SelectValue = ({ ...props }: ComponentProps<typeof SelectPrimitive.Value>) => (
  <SelectPrimitive.Value data-slot="select-value" {...props} />
);

const SelectTrigger = ({
  children,
  className,
  ...props
}: ComponentProps<typeof SelectPrimitive.Trigger>) => (
  <SelectPrimitive.Trigger
    className={cn(
      "border-input bg-background hover:bg-muted focus-visible:border-ring focus-visible:ring-ring/50 flex h-9 w-fit items-center justify-between gap-2 rounded-lg border px-3 py-2 text-base whitespace-nowrap outline-none focus-visible:ring-3 disabled:cursor-not-allowed disabled:opacity-50 sm:h-8 sm:text-sm [&_svg]:pointer-events-none [&_svg]:shrink-0",
      className,
    )}
    data-slot="select-trigger"
    {...props}
  >
    {children}

    <SelectPrimitive.Icon>
      <ChevronDownIcon aria-hidden className="text-muted-foreground size-4" />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
);

const SelectContent = ({
  children,
  className,
  ...props
}: ComponentProps<typeof SelectPrimitive.Popup>) => (
  <SelectPrimitive.Portal>
    <SelectPrimitive.Positioner alignItemWithTrigger={false} sideOffset={6}>
      <SelectPrimitive.Popup
        className={cn(
          "bg-popover text-popover-foreground ring-foreground/10 data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-closed:zoom-out-95 data-open:zoom-in-95 z-50 min-w-(--anchor-width) origin-(--transform-origin) overflow-hidden rounded-xl p-1 shadow-md ring-1 duration-150",
          className,
        )}
        data-slot="select-content"
        {...props}
      >
        {children}
      </SelectPrimitive.Popup>
    </SelectPrimitive.Positioner>
  </SelectPrimitive.Portal>
);

const SelectItem = ({
  children,
  className,
  ...props
}: ComponentProps<typeof SelectPrimitive.Item>) => (
  <SelectPrimitive.Item
    className={cn(
      "data-highlighted:bg-muted data-highlighted:text-foreground relative flex w-full cursor-default items-center gap-2 rounded-lg py-2 pr-8 pl-2 text-base outline-none select-none data-disabled:pointer-events-none data-disabled:opacity-50 sm:py-1.5 sm:text-sm",
      className,
    )}
    data-slot="select-item"
    {...props}
  >
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>

    <SelectPrimitive.ItemIndicator className="absolute right-2 flex items-center justify-center">
      <CheckIcon aria-hidden className="size-4 shrink-0" />
    </SelectPrimitive.ItemIndicator>
  </SelectPrimitive.Item>
);

export { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue };
