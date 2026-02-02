#!/usr/bin/env python3
"""whisperX transcription wrapper.

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
                "text": "segment text"
            }
        ]
    }
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
        "--initial-prompt", default=None, help="Initial prompt for vocabulary hints"
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

    # GPU が使える場合は CUDA を使用 (大幅に高速化)
    device = "cuda" if torch.cuda.is_available() else "cpu"
    compute_type = "float16" if device == "cuda" else "int8"
    print(f"Using device: {device} (compute_type: {compute_type})", file=sys.stderr)

    # 1. Transcribe with whisperX
    model = whisperx.load_model(args.model, device, compute_type=compute_type, language=args.language)
    audio = whisperx.load_audio(args.audio_path)

    # transcribe オプション
    transcribe_options = {"batch_size": 16}
    if args.initial_prompt:
        # WhisperX (faster-whisper) uses "prompt" instead of "initial_prompt"
        transcribe_options["prompt"] = args.initial_prompt
        print(f"Using initial_prompt: {args.initial_prompt[:100]}...", file=sys.stderr)

    result = model.transcribe(audio, **transcribe_options)

    # 2. Align whisper output
    try:
        model_a, metadata = whisperx.load_align_model(language_code=args.language, device=device)
        result = whisperx.align(
            result["segments"], model_a, metadata, audio, device, return_char_alignments=False
        )
    except Exception as e:
        print(f"Alignment failed (continuing with unaligned segments): {e}", file=sys.stderr)

    # 3. Build output
    segments = []
    for seg in result.get("segments", []):
        segments.append(
            {
                "start": int(seg.get("start", 0) * 1000),  # convert to ms
                "end": int(seg.get("end", 0) * 1000),
                "text": seg.get("text", "").strip(),
            }
        )

    full_text = " ".join(s["text"] for s in segments if s["text"])

    output = {
        "text": full_text,
        "language": args.language,
        "segments": segments,
    }

    json.dump(output, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()
