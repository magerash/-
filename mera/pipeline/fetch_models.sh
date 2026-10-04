#!/usr/bin/env bash
# Downloads the offline models used by the pipeline into mera/models (about 1.6 GB).
# All are fetched from GitHub releases (k2-fsa/sherpa-onnx, colmap/colmap).
set -euo pipefail
cd "$(dirname "$0")/../models"
R=https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models
fetch() { [ -e "$2" ] && { echo "have $2"; return; }; echo "get $1"; curl -fSL --retry 4 -o "$1" "$R/$1"; }
fetch silero_vad.onnx silero_vad.onnx
if [ ! -d sherpa-onnx-nemo-transducer-giga-am-v2-russian-2025-04-19 ]; then
  fetch sherpa-onnx-nemo-transducer-giga-am-v2-russian-2025-04-19.tar.bz2 x && tar xjf sherpa-onnx-nemo-transducer-giga-am-v2-russian-2025-04-19.tar.bz2 && rm sherpa-onnx-nemo-transducer-giga-am-v2-russian-2025-04-19.tar.bz2
fi
if [ ! -d sherpa-onnx-whisper-turbo ]; then
  fetch sherpa-onnx-whisper-turbo.tar.bz2 x && tar xjf sherpa-onnx-whisper-turbo.tar.bz2 && rm sherpa-onnx-whisper-turbo.tar.bz2
fi
[ -e vocab_tree_faiss_flickr100K_words32K.bin ] || curl -fSL --retry 4 -o vocab_tree_faiss_flickr100K_words32K.bin \
  https://github.com/colmap/colmap/releases/download/3.11.1/vocab_tree_faiss_flickr100K_words32K.bin
echo "models ready"
