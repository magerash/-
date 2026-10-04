"""Transcribe the owner's narration from every input that carries audio.

Speech is segmented with Silero VAD, then each segment is decoded twice:
  * Whisper large-v3-turbo (multilingual, language auto-detect)
  * GigaAM v2 RNN-T (Russian-specialised, much lower WER on Russian speech)
The primary text is chosen per detected language; the alternate is kept so the UI and the
fact extractor can show disagreements instead of hiding them.
Output: <project>/transcript.json
"""
from __future__ import annotations

import sys
import wave
from collections import Counter
from pathlib import Path

import numpy as np

from common import MODELS, Progress, extract_audio, inputs, project_dir, write_json

SR = 16000


def read_wav(path: Path) -> np.ndarray:
    with wave.open(str(path)) as w:
        data = w.readframes(w.getnframes())
    return np.frombuffer(data, dtype=np.int16).astype(np.float32) / 32768.0


def load_models():
    import sherpa_onnx

    vad_cfg = sherpa_onnx.VadModelConfig()
    vad_cfg.silero_vad.model = str(MODELS / "silero_vad.onnx")
    vad_cfg.silero_vad.threshold = 0.45
    vad_cfg.silero_vad.min_silence_duration = 0.6
    vad_cfg.silero_vad.min_speech_duration = 0.35
    vad_cfg.silero_vad.max_speech_duration = 20
    vad_cfg.sample_rate = SR

    wdir = MODELS / "sherpa-onnx-whisper-turbo"
    whisper = None
    if wdir.exists():
        whisper = sherpa_onnx.OfflineRecognizer.from_whisper(
            encoder=str(wdir / "turbo-encoder.int8.onnx"),
            decoder=str(wdir / "turbo-decoder.int8.onnx"),
            tokens=str(wdir / "turbo-tokens.txt"),
            language="",
            task="transcribe",
            num_threads=4,
        )
    gdir = MODELS / "sherpa-onnx-nemo-transducer-giga-am-v2-russian-2025-04-19"
    giga = None
    if gdir.exists():
        giga = sherpa_onnx.OfflineRecognizer.from_transducer(
            encoder=str(gdir / "encoder.int8.onnx"),
            decoder=str(gdir / "decoder.onnx"),
            joiner=str(gdir / "joiner.onnx"),
            tokens=str(gdir / "tokens.txt"),
            model_type="nemo_transducer",
            num_threads=4,
        )
    if whisper is None and giga is None:
        raise SystemExit("No ASR model found in models/. Run pipeline/fetch_models.sh")
    return vad_cfg, whisper, giga


def vad_segments(samples: np.ndarray, vad_cfg) -> list[tuple[float, np.ndarray]]:
    import sherpa_onnx

    vad = sherpa_onnx.VoiceActivityDetector(vad_cfg, buffer_size_in_seconds=120)
    win = vad_cfg.silero_vad.window_size
    segs = []
    for i in range(0, len(samples), win):
        vad.accept_waveform(samples[i : i + win])
        while not vad.empty():
            segs.append((vad.front.start / SR, np.array(vad.front.samples, dtype=np.float32)))
            vad.pop()
    vad.flush()
    while not vad.empty():
        segs.append((vad.front.start / SR, np.array(vad.front.samples, dtype=np.float32)))
        vad.pop()
    return segs


def decode(rec, audio: np.ndarray):
    s = rec.create_stream()
    s.accept_waveform(SR, audio)
    rec.decode_stream(s)
    return s.result


def main(pid: str) -> None:
    prog = Progress(pid)
    prog.update("transcribe", "running", "loading speech models")
    vad_cfg, whisper, giga = load_models()
    videos, voices = inputs(pid)
    sources = voices + videos  # dedicated voice recordings first: they are the owner's deliberate statement
    work = project_dir(pid) / "work" / "audio"
    out = {"sources": [], "segments": []}
    langs: Counter = Counter()
    for si, src in enumerate(sources):
        prog.update("transcribe", "running", f"{src.name}: voice activity", si / max(1, len(sources)))
        wav = extract_audio(src, work / (src.stem + ".wav"))
        samples = read_wav(wav)
        segs = vad_segments(samples, vad_cfg)
        out["sources"].append({"file": src.name, "kind": "voice" if src in voices else "video",
                               "duration": len(samples) / SR, "speech_segments": len(segs)})
        for k, (t0, audio) in enumerate(segs):
            seg = {"source": src.name, "t0": round(t0, 2), "t1": round(t0 + len(audio) / SR, 2)}
            if whisper is not None:
                r = decode(whisper, audio)
                seg["whisper"] = r.text.strip()
                seg["lang"] = (getattr(r, "lang", "") or "").strip("<|>") or None
                if seg["lang"]:
                    langs[seg["lang"]] += 1
            if giga is not None:
                r = decode(giga, audio)
                seg["gigaam"] = r.text.strip()
            out["segments"].append(seg)
            prog.update("transcribe", "running", f"{src.name}: {k + 1}/{len(segs)} segments",
                        (si + (k + 1) / max(1, len(segs))) / max(1, len(sources)))
    lang = langs.most_common(1)[0][0] if langs else ("ru" if giga else "unknown")
    out["language"] = lang
    primary = "gigaam" if (lang == "ru" and giga is not None) else "whisper"
    out["primary_model"] = primary
    for seg in out["segments"]:
        seg["text"] = seg.get(primary) or seg.get("whisper") or seg.get("gigaam") or ""
        alt = seg.get("whisper" if primary == "gigaam" else "gigaam")
        seg["alt"] = alt
    out["segments"] = [s for s in out["segments"] if s["text"]]
    write_json(project_dir(pid) / "transcript.json", out)
    prog.update("transcribe", "done", f"{len(out['segments'])} segments, language={lang}, model={primary}", 1.0)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "plot")
