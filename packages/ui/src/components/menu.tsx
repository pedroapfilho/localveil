import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import type { ComponentProps } from "react";

import { cn } from "../lib/utils";

const Menu = ({ ...props }: ComponentProps<typeof MenuPrimitive.Root>) => (
  <MenuPrimitive.Root data-slot="menu" {...props} />
);

const MenuTrigger = ({ className, ...props }: ComponentProps<typeof MenuPrimitive.Trigger>) => (
  <MenuPrimitive.Trigger
    className={cn(
      "focus-visible:outline-ring outline-none focus-visible:outline-2 focus-visible:outline-offset-2",
      className,
    )}
    data-slot="menu-trigger"
    {...props}
  />
);

const MenuContent = ({
  children,
  className,
  sideOffset = 6,
  ...props
}: ComponentProps<typeof MenuPrimitive.Popup> & { sideOffset?: number }) => (
  <MenuPrimitive.Portal>
    <MenuPrimitive.Positioner className="z-50" sideOffset={sideOffset}>
      <MenuPrimitive.Popup
        className={cn(
          "bg-popover text-popover-foreground ring-foreground/10 data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-closed:zoom-out-95 data-open:zoom-in-95 min-w-52 origin-(--transform-origin) rounded-xl p-1 shadow-md ring-1 duration-150 outline-none",
          className,
        )}
        data-slot="menu-content"
        {...props}
      >
        {children}
      </MenuPrimitive.Popup>
    </MenuPrimitive.Positioner>
  </MenuPrimitive.Portal>
);

const MenuItem = ({ className, ...props }: ComponentProps<typeof MenuPrimitive.Item>) => (
  <MenuPrimitive.Item
    className={cn(
      "data-highlighted:bg-muted flex w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-base outline-none data-disabled:cursor-not-allowed data-disabled:opacity-60 sm:text-sm",
      className,
    )}
    data-slot="menu-item"
    {...props}
  />
);

export { Menu, MenuContent, MenuItem, MenuTrigger };
