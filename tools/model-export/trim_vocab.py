"""Trim a GLiNER checkpoint's vocabulary to the scripts localveil actually reads.

mDeBERTa-v3-base carries 86M parameters of transformer and 192M of embedding matrix
(250,105 rows by 768) for a multilingual vocabulary, so two thirds of the download is a lookup
table. localveil reads English, Portuguese and Spanish, and Tesseract only ever hands it eng,
por or spa, so every non-Latin piece in that table is dead weight.

This prunes rather than retokenizes. An mDeBERTa study on Estonian found that pruning the
existing vocabulary held NER performance in the baseline range while replacing the tokenizer
dropped it below every baseline, and the reason is mechanical: pruning only deletes rows, so
every piece that survives keeps the embedding it was trained with.

UNVALIDATED. Read tools/model-export/README.md before trusting its output: the fp32 export
this builds on does not yet reproduce the shipped model's behaviour, so a trimmed model cannot
be compared against packages/eval/BASELINE.md until that gate passes.
"""

import argparse
import json
from pathlib import Path

import torch

KEPT_RANGES = [
    (0x0000, 0x007F),  # ASCII
    (0x00A0, 0x00FF),  # Latin-1 Supplement
    (0x0100, 0x017F),  # Latin Extended-A
    (0x0180, 0x024F),  # Latin Extended-B
    (0x0250, 0x02FF),  # IPA and spacing modifiers, which SentencePiece emits for some pieces
    (0x0300, 0x036F),  # Combining diacritics
    (0x1E00, 0x1EFF),  # Latin Extended Additional
    (0x2000, 0x206F),  # General punctuation
    # U+2581 LOWER ONE EIGHTH BLOCK is SentencePiece's word-initial marker. Leaving it out
    # deletes every "\u2581word" piece and keeps only the bare "word" form, so a word-initial
    # token becomes two tokens. Measured: that inflates the corpus by about half and costs
    # 5 F1, with no unknown tokens to hint at why.
    (0x2580, 0x259F),  # Block elements
    (0x20A0, 0x20CF),  # Currency symbols
    (0x2100, 0x214F),  # Letterlike symbols
]


def is_latin_piece(piece: str) -> bool:
    return all(any(low <= ord(ch) <= high for low, high in KEPT_RANGES) for ch in piece)


def prompt_pieces(tokenizer, prompts: list[str]) -> set[str]:
    """Every piece the 24 entity prompts tokenize into.

    GLiNER classifies against these strings at inference time, so a prompt that falls back to
    UNK does not degrade gracefully: it silently stops asking for that entity type.
    """
    pieces: set[str] = set()

    for prompt in prompts:
        pieces.update(tokenizer.tokenize(prompt))

    return pieces


def choose(spec: dict, protected: set[str]) -> list[int]:
    vocab = spec["model"]["vocab"]

    return [
        index
        for index, (piece, _score) in enumerate(vocab)
        if piece in protected or is_latin_piece(piece)
    ]


def rewrite(spec: dict, keep: list[int]) -> dict:
    vocab = spec["model"]["vocab"]
    moved = {old: new for new, old in enumerate(keep)}
    beyond = len(vocab)

    spec["model"]["vocab"] = [vocab[index] for index in keep]

    if spec["model"]["unk_id"] not in moved:
        raise SystemExit("the unknown-token id did not survive trimming")

    spec["model"]["unk_id"] = moved[spec["model"]["unk_id"]]

    for entry in spec.get("added_tokens", []):
        if entry["id"] < beyond:
            if entry["id"] not in moved:
                raise SystemExit(f"added token {entry['content']} did not survive trimming")

            entry["id"] = moved[entry["id"]]
        else:
            entry["id"] = len(keep) + (entry["id"] - beyond)

    return spec


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", default="urchade/gliner_multi_pii-v1")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--prompts", type=Path, required=True)
    args = parser.parse_args()

    from gliner import GLiNER

    model = GLiNER.from_pretrained(args.source)
    model.eval()

    tokenizer = model.data_processor.transformer_tokenizer
    prompts = json.loads(args.prompts.read_text())

    args.out.mkdir(parents=True, exist_ok=True)
    model.save_pretrained(args.out)

    path = args.out / "tokenizer.json"
    spec = json.loads(path.read_text())

    if spec["model"]["type"] != "Unigram":
        raise SystemExit(f"expected a Unigram tokenizer, found {spec['model']['type']}")

    protected = {entry["content"] for entry in spec.get("added_tokens", [])}
    protected |= prompt_pieces(tokenizer, prompts)
    protected |= {chr(code) for code in range(0x20, 0x7F)}

    unigram = len(spec["model"]["vocab"])
    keep = choose(spec, protected)
    added_names = [
        entry["content"] for entry in sorted(spec.get("added_tokens", []), key=lambda e: e["id"])
        if entry["id"] >= unigram
    ]
    spec_ent_token = model.config.ent_token

    encoder = model.model.token_rep_layer.bert_layer.model
    embeddings = encoder.get_input_embeddings()
    rows = embeddings.weight.shape[0]
    width = embeddings.weight.shape[1]

    # Rows past the Unigram vocabulary are the tokens GLiNER added ([MASK], [FLERT], <<ENT>>,
    # <<SEP>>). They are not in the vocab list, so they are kept by position rather than name.
    order = keep + list(range(unigram, rows))

    with torch.no_grad():
        kept = embeddings.weight[torch.tensor(order)].clone()

    print(f"unigram vocabulary {unigram} -> {len(keep)} pieces")
    print(f"embedding rows {rows} -> {len(order)}")
    print(f"embedding parameters {rows * width / 1e6:.0f}M -> {len(order) * width / 1e6:.0f}M")

    embeddings.weight = torch.nn.Parameter(kept)
    embeddings.num_embeddings = len(order)
    encoder.config.vocab_size = len(order)
    model.config.vocab_size = len(order)

    # GLiNER stores the absolute id of <<ENT>> and refuses to load if it points past the
    # tokenizer. The added tokens keep their order at the end of the table, so the new id is
    # their old offset past the Unigram vocabulary, counted from the trimmed length.
    added = {name: unigram + at for at, name in enumerate(added_names)}
    ent = added.get(spec_ent_token)

    if ent is None:
        raise SystemExit(f"{spec_ent_token} is not one of the added tokens {list(added)}")

    model.config.class_token_index = order.index(ent)

    model.save_pretrained(args.out)
    path.write_text(json.dumps(rewrite(spec, keep), ensure_ascii=False))
    (args.out / "spm.model").unlink(missing_ok=True)

    print(f"wrote {args.out}")


if __name__ == "__main__":
    main()
