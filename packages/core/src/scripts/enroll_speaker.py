#!/usr/bin/env python3
"""Extract speaker embedding from an audio file using pyannote.

Usage:
    python3 enroll_speaker.py <audio_path>

Output:
    JSON to stdout: {"embedding": [0.1, 0.2, ...]}

Environment variables:
    HF_TOKEN: HuggingFace token for pyannote model access
"""

import argparse
import json
import sys
import warnings

warnings.filterwarnings("ignore")


def main() -> None:
    parser = argparse.ArgumentParser(description="Extract speaker embedding from audio")
    parser.add_argument("audio_path", help="Path to audio file")
    args = parser.parse_args()

    import os

    import torch
    from pyannote.audio import Inference

    hf_token = os.environ.get("HF_TOKEN")
    if not hf_token:
        print("Error: HF_TOKEN environment variable is required", file=sys.stderr)
        sys.exit(1)

    inference = Inference("pyannote/embedding", window="whole", use_auth_token=hf_token)
    embedding = inference(args.audio_path)

    # embedding is a numpy array, convert to list
    embedding_list = embedding.flatten().tolist()

    output = {"embedding": embedding_list}
    json.dump(output, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()
