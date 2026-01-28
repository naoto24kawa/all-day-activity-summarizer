#!/usr/bin/env python3
"""whisperX transcription wrapper with speaker diarization.

Usage:
    python3 whisperx_transcribe.py <audio_path> [--language <lang>] [--model <model>]

Output:
    JSON to stdout with the following structure:
    {
        "text": "full transcription text",
        "language": "ja",
        "segments": [
            {
                "start": 0,
                "end": 1500,
                "text": "segment text",
                "speaker": "SPEAKER_00"
            }
        ]
    }

Environment variables:
    HF_TOKEN: HuggingFace token for pyannote diarization model
"""

import argparse
import json
import sys
import warnings

warnings.filterwarnings("ignore")


def main() -> None:
    parser = argparse.ArgumentParser(description="Transcribe audio with whisperX")
    parser.add_argument("audio_path", help="Path to audio file")
    parser.add_argument("--language", default="ja", help="Language code (default: ja)")
    parser.add_argument(
        "--model", default="large-v3-turbo", help="Whisper model name (default: large-v3-turbo)"
    )
    parser.add_argument(
        "--embeddings-path", default=None, help="Path to speaker_embeddings.json for speaker identification"
    )
    args = parser.parse_args()

    import os

    # Workaround: PyTorch 2.6+ defaults weights_only=True in torch.load,
    # which breaks pyannote/lightning model loading with omegaconf objects.
    # Patch lightning_fabric._load to default weights_only=False.
    import torch

    import lightning_fabric.utilities.cloud_io as _cloud_io

    _orig_cloud_load = _cloud_io._load

    def _patched_cloud_load(path_or_url, map_location=None, weights_only=None):
        if weights_only is None:
            weights_only = False
        return _orig_cloud_load(path_or_url, map_location=map_location, weights_only=weights_only)

    _cloud_io._load = _patched_cloud_load

    # Also patch pytorch_lightning.core.saving which calls pl_load
    try:
        import pytorch_lightning.core.saving as _pl_saving

        _pl_saving.pl_load = _patched_cloud_load
    except (ImportError, AttributeError):
        pass

    import whisperx

    device = "cpu"
    compute_type = "int8"

    # 1. Transcribe with whisperX
    model = whisperx.load_model(args.model, device, compute_type=compute_type, language=args.language)
    audio = whisperx.load_audio(args.audio_path)
    result = model.transcribe(audio, batch_size=16)

    # 2. Align whisper output
    model_a, metadata = whisperx.load_align_model(language_code=args.language, device=device)
    result = whisperx.align(
        result["segments"], model_a, metadata, audio, device, return_char_alignments=False
    )

    # 3. Speaker diarization (if HF_TOKEN is available)
    speaker_name_map: dict[str, str] = {}
    diarize_embeddings = None
    hf_token = os.environ.get("HF_TOKEN")
    if hf_token:
        try:
            from whisperx.diarize import DiarizationPipeline

            diarize_model = DiarizationPipeline(use_auth_token=hf_token, device=device)
            diarize_segments = diarize_model(audio, return_embeddings=True)

            # If return_embeddings=True, diarize_model returns (segments, embeddings)
            if isinstance(diarize_segments, tuple):
                diarize_segments, diarize_embeddings = diarize_segments

            result = whisperx.assign_word_speakers(diarize_segments, result)

            # Speaker identification using registered embeddings
            if diarize_embeddings is not None and args.embeddings_path:
                speaker_name_map = _identify_speakers(diarize_embeddings, args.embeddings_path)
        except Exception as e:
            print(f"Diarization failed (continuing without speaker labels): {e}", file=sys.stderr)

    # 4. Build output
    segments = []
    for seg in result.get("segments", []):
        raw_speaker = seg.get("speaker")
        speaker = speaker_name_map.get(raw_speaker, raw_speaker) if raw_speaker else None
        segments.append(
            {
                "start": int(seg.get("start", 0) * 1000),  # convert to ms
                "end": int(seg.get("end", 0) * 1000),
                "text": seg.get("text", "").strip(),
                "speaker": speaker,
            }
        )

    full_text = " ".join(s["text"] for s in segments if s["text"])

    output = {
        "text": full_text,
        "language": args.language,
        "segments": segments,
    }

    # 5. Include speaker embeddings for unknown speaker accumulation
    if diarize_embeddings is not None:
        speaker_embeddings_out: dict[str, list[float]] = {}
        for label, emb in diarize_embeddings.items():
            if hasattr(emb, "tolist"):
                speaker_embeddings_out[label] = emb.flatten().tolist()
            else:
                speaker_embeddings_out[label] = list(emb)
        output["speaker_embeddings"] = speaker_embeddings_out

    json.dump(output, sys.stdout, ensure_ascii=False)


def _cosine_similarity(a: list[float], b: list[float]) -> float:
    """Compute cosine similarity between two vectors."""
    import math

    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(x * x for x in b))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


def _identify_speakers(
    diarize_embeddings: dict,
    embeddings_path: str,
    threshold: float = 0.5,
) -> dict[str, str]:
    """Match diarization speaker labels to registered speaker names.

    Args:
        diarize_embeddings: Dict mapping speaker labels (e.g. "SPEAKER_00") to embeddings.
        embeddings_path: Path to speaker_embeddings.json with registered speakers.
        threshold: Minimum cosine similarity to accept a match.

    Returns:
        Dict mapping speaker labels to registered names (e.g. {"SPEAKER_00": "Nishikawa"}).
    """
    import numpy as np

    if not os.path.exists(embeddings_path):
        return {}

    with open(embeddings_path, "r", encoding="utf-8") as f:
        registered: dict[str, list[float]] = json.load(f)

    if not registered:
        return {}

    speaker_name_map: dict[str, str] = {}
    for label, emb in diarize_embeddings.items():
        # emb may be a numpy array or list
        if hasattr(emb, "tolist"):
            emb_list = emb.flatten().tolist()
        else:
            emb_list = list(emb)

        best_name = None
        best_score = -1.0
        for name, reg_emb in registered.items():
            score = _cosine_similarity(emb_list, reg_emb)
            if score > best_score:
                best_score = score
                best_name = name

        if best_name and best_score >= threshold:
            speaker_name_map[label] = best_name
            print(
                f"Speaker {label} identified as {best_name} (similarity: {best_score:.3f})",
                file=sys.stderr,
            )
        else:
            print(
                f"Speaker {label} not matched (best: {best_score:.3f})",
                file=sys.stderr,
            )

    return speaker_name_map


if __name__ == "__main__":
    main()
