const OPTIONS = {
  help: { describe: "show this and stop", short: "h", type: "boolean" },
  jobs: {
    describe: "redact this many files at once, rather than half the cores up to four",
    type: "string",
    value: "n",
  },
  model: { describe: "redact with a model other than the default", type: "string", value: "id" },
} as const;

const COMMANDS = [
  ["localveil [options] [paths]", "redact the files and folders named, or browse for them"],
  ["localveil models", "list the detection models and which are downloaded"],
  ["localveil models download <id>", "download a model now rather than on the first run"],
  ["localveil models remove <id>", "delete a downloaded model"],
] as const;

const FLAGS = Object.entries(OPTIONS).map(
  ([name, option]) =>
    [
      `${"short" in option ? `-${option.short}, ` : ""}--${name}${"value" in option ? ` <${option.value}>` : ""}`,
      option.describe,
    ] as const,
);

const table = (rows: ReadonlyArray<readonly [string, string]>) => {
  const width = Math.max(...rows.map(([left]) => left.length));

  return rows.map(([left, right]) => `  ${left.padEnd(width)}    ${right}`).join("\n");
};

const USAGE = `Usage:\n${table(COMMANDS)}\n\nOptions:\n${table(FLAGS)}\n`;

export { OPTIONS, USAGE };
