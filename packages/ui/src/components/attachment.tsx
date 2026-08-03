import type { ComponentProps } from "react";

import { cn } from "../lib/utils";

import { Button } from "./button";

type AttachmentState = "done" | "error" | "idle" | "processing" | "uploading";

type AttachmentProps = ComponentProps<"div"> & {
  orientation?: "horizontal" | "vertical";
  size?: "default" | "sm" | "xs";
  state?: AttachmentState;
};

const Attachment = ({
  className,
  orientation = "horizontal",
  size = "default",
  state = "done",
  ...props
}: AttachmentProps) => (
  <div
    className={cn(
      "group/attachment ring-foreground/10 bg-card relative flex gap-3 rounded-xl p-3 ring-1",
      orientation === "vertical" && "flex-col",
      size === "sm" && "gap-2 p-2",
      size === "xs" && "gap-2 p-1.5",
      state === "error" && "ring-destructive/40",
      className,
    )}
    data-orientation={orientation}
    data-size={size}
    data-slot="attachment"
    data-state={state}
    {...props}
  />
);

const AttachmentMedia = ({
  className,
  variant = "icon",
  ...props
}: ComponentProps<"div"> & { variant?: "icon" | "image" }) => (
  <div
    className={cn(
      "flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-lg",
      variant === "icon" && "bg-muted text-muted-foreground",
      "group-data-[state=error]/attachment:text-destructive",
      className,
    )}
    data-slot="attachment-media"
    data-variant={variant}
    {...props}
  />
);

const AttachmentContent = ({ className, ...props }: ComponentProps<"div">) => (
  <div
    className={cn("flex min-w-0 flex-1 flex-col justify-center gap-0.5", className)}
    data-slot="attachment-content"
    {...props}
  />
);

const AttachmentTitle = ({ className, ...props }: ComponentProps<"p">) => (
  <p
    className={cn("truncate text-base font-medium sm:text-sm", className)}
    data-slot="attachment-title"
    {...props}
  />
);

const AttachmentDescription = ({ className, ...props }: ComponentProps<"p">) => (
  <p
    className={cn("text-muted-foreground text-base sm:text-sm", className)}
    data-slot="attachment-description"
    {...props}
  />
);

const AttachmentActions = ({ className, ...props }: ComponentProps<"div">) => (
  <div
    className={cn("z-10 flex shrink-0 items-start gap-1", className)}
    data-slot="attachment-actions"
    {...props}
  />
);

const AttachmentAction = ({
  className,
  size = "icon-sm",
  variant = "ghost",
  ...props
}: ComponentProps<typeof Button>) => (
  <Button
    className={cn("relative", className)}
    data-slot="attachment-action"
    size={size}
    variant={variant}
    {...props}
  >
    <span
      aria-hidden
      className="absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-1/2 pointer-fine:hidden"
    />

    {props.children}
  </Button>
);

const AttachmentGroup = ({ className, ...props }: ComponentProps<"div">) => (
  <div className={cn("flex flex-col gap-2", className)} data-slot="attachment-group" {...props} />
);

export {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
};
export type { AttachmentProps, AttachmentState };
