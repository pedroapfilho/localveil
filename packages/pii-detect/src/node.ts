import type { ModelSpec } from "./catalog";
import { weightsUrl } from "./catalog";
import { cachePathFor } from "./disk-cache";

// Where the CLI keeps a model's weights, whether or not they have been downloaded yet.
const weightsPath = (model: ModelSpec) => cachePathFor(weightsUrl(model));

export { MODEL_CACHE_DIR } from "./disk-cache";
export { weightsPath };
