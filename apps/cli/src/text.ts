const ELLIPSIS = "…";

const truncateEnd = (value: string, width: number): string => {
  if (width <= 0) {
    return "";
  }

  if (value.length <= width) {
    return value;
  }

  return `${value.slice(0, width - 1)}${ELLIPSIS}`;
};

const truncateStart = (value: string, width: number): string => {
  if (width <= 0) {
    return "";
  }

  if (value.length <= width) {
    return value;
  }

  return `${ELLIPSIS}${value.slice(value.length - (width - 1))}`;
};

export { truncateEnd, truncateStart };
