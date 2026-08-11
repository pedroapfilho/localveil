"""Export a GLiNER checkpoint to the ONNX graph localveil's runtime expects, and quantize it.

The runtime contract is fixed by `packages/pii-detect/src/gliner-feeds.ts` and
`gliner-decode.ts`: six inputs named input_ids, attention_mask, words_mask, text_lengths,
span_idx and span_mask, and a primary output shaped [batch, positions, widths, entities].
An export that changes any of those breaks the app, so this script asserts them before it
writes anything a scoring run could waste time on.
"""

import argparse
import json
from pathlib import Path

INPUT_NAMES = [
    "input_ids",
    "attention_mask",
    "words_mask",
    "text_lengths",
    "span_idx",
    "span_mask",
]


def check(path: Path) -> None:
    import onnxruntime as ort

    session = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
    names = [entry.name for entry in session.get_inputs()]

    if sorted(names) != sorted(INPUT_NAMES):
        raise SystemExit(f"{path.name} takes {names}, which the runtime does not feed")

    size = path.stat().st_size / 1e6

    print(f"{path.name}: {size:.0f} MB, inputs ok, first output {session.get_outputs()[0].name}")


def quantize(source: Path, target: Path, op_types: list[str] | None) -> None:
    from onnxruntime.quantization import QuantType, quantize_dynamic

    quantize_dynamic(
        str(source),
        str(target),
        op_types_to_quantize=op_types,
        per_channel=True,
        reduce_range=False,
        weight_type=QuantType.QInt8,
    )

    check(target)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", default="urchade/gliner_multi_pii-v1")
    parser.add_argument("--out", type=Path, default=Path("build"))
    parser.add_argument("--prompts", type=Path, required=True)
    parser.add_argument("--skip-quantize", action="store_true")
    args = parser.parse_args()

    from gliner import GLiNER

    model = GLiNER.from_pretrained(str(args.source))
    model.eval()

    spec = model._get_onnx_input_spec()

    if spec["input_names"] != INPUT_NAMES:
        raise SystemExit(f"this checkpoint exports {spec['input_names']}, not {INPUT_NAMES}")

    prompts = json.loads(args.prompts.read_text())

    print(f"exporting {args.source} with {len(prompts)} entity prompts")

    args.out.mkdir(parents=True, exist_ok=True)
    model.export_to_onnx(save_dir=args.out, onnx_filename="model.onnx")

    fp32 = args.out / "model.onnx"

    check(fp32)

    if args.skip_quantize:
        return

    # Every op, but per-channel. quantize_dynamic leaves per_channel off by default, and
    # per-tensor weight quantization is a documented failure mode on attention-heavy graphs.
    # DeBERTa's disentangled attention is close to the worst case for it, which is the most
    # likely explanation for the 0.999 to 0.17 collapse the repo README records.
    quantize(fp32, args.out / "model_int8_perchannel.onnx", None)

    # The embedding lookup only. Two thirds of the parameters live there and a Gather is a
    # lookup rather than an accumulation, so it tolerates quantization where attention does not.
    quantize(fp32, args.out / "model_int8_embeddings.onnx", ["Gather"])


if __name__ == "__main__":
    main()
