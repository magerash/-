"""Extract site facts from the narration (Russian + English keyword grammar).

Every fact keeps its quote, clip and timestamp, so it can later be pinned to the camera pose
that was recording when it was said ("here is the entrance" -> where the camera looked).
Facts are flagged when the two ASR models disagree on the key word.
Output: <project>/facts.json
"""
from __future__ import annotations

import re
import sys

from common import Progress, project_dir, read_json, write_json

# kind -> (label, regex over lower-cased text)
FEATURES = {
    "plot_shape": ("Plot shape", r"прямоугольн|rectangular|квадратн"),
    "slope": ("Slope / fall of the land", r"уклон|спуска\w*|под гор|slope|downhill|вниз"),
    "entrance": ("Entrance / gate", r"въезд|ворот|калитк|entrance|gate"),
    "fence": ("Fence", r"забор|заборчик|fence"),
    "boundary": ("Plot boundary", r"границ\w* участк|boundary"),
    "forest": ("Forest", r"\bлес\b|лес\s|к лесу|в лес|forest|woods"),
    "house": ("House", r"\bдом\w*|house|cottage"),
    "sauna": ("Sauna (banya)", r"бан[яиеьк]\w*|баньк\w*|саун\w*|sauna|banya"),
    "parking": ("Parking", r"парковк\w*|стоян\w*|стояночк\w*|parking"),
    "garden": ("Vegetable garden / beds", r"огород\w*|грядк\w*|garden beds?|vegetable"),
    "rock_garden": ("Rock garden", r"альпийск\w* горк\w*|rock garden"),
    "sheds": ("Utility sheds", r"бытовк\w*|бытовочк\w*|бутовк\w*|бутовочк\w*|сарай|shed"),
    "woodpile": ("Woodpile / chopping spot", r"поленниц\w*|полейниц\w*|дрова|firewood"),
    "table": ("Summer table", r"столик\w*|table"),
    "stove": ("Outdoor stove", r"печ\w*|stove"),
    "terrace": ("Terrace / deck", r"террас\w*|deck|terrace"),
    "bath": ("Plunge bath", r"ванн\w*|окуна\w*|plunge"),
    "back_gate": ("Back exit to the forest", r"выход в лес|exit to the forest"),
    "tyre": ("Large tyre", r"покрышк\w*|tyre|tire"),
    "scale_refs": ("Objects of standard size", r"предмет\w* .*размер|standard size"),
    "dimensions_promised": ("Plot dimensions supplied separately", r"габарит\w*"),
    "lens": ("Lens / camera mode", r"ноль шесть|0[.,]6|широк\w*|wide"),
}
INTENTS = {
    "build_here": r"(построить|разместить|размещать|построим|build)",
    "pool": r"бассейн|pool",
}
DIRECTIONS = {
    "right": r"справа|направо|on the right",
    "left": r"слева|налево|on the left",
    "behind": r"сзади|за домом|за баней|behind",
    "near_forest": r"ближе к лесу|у леса|near the forest",
    "here": r"\bздесь\b|\bтут\b|\bвот\b|here",
}
NUM = r"(\d+(?:[.,]\d+)?)"
DIM_PATTERNS = [
    re.compile(NUM + r"\s*(?:на|x|х|×|by)\s*" + NUM + r"\s*(?:м|метр|m\b)?"),
    re.compile(NUM + r"\s*(?:м|метр\w*|meters?|m)\b"),
]


def main(pid: str) -> None:
    prog = Progress(pid)
    pdir = project_dir(pid)
    tr = read_json(pdir / "transcript.json")
    clip_of = {c["file"]: c["id"] for c in read_json(pdir / "frames.json")["clips"]}
    facts, intents, dims = [], [], []
    for i, seg in enumerate(tr["segments"]):
        text = seg["text"].lower()
        alt = (seg.get("alt") or "").lower()
        base = {"segment": i, "source": seg["source"], "clip": clip_of.get(seg["source"]),
                "t0": seg["t0"], "t1": seg["t1"], "quote": seg["text"]}
        dirs = [d for d, rx in DIRECTIONS.items() if re.search(rx, text)]
        for kind, (label, rx) in FEATURES.items():
            m = re.search(rx, text)
            if not m:
                continue
            agree = bool(re.search(rx, alt)) if alt else None
            # approximate time of the keyword inside the segment (uniform speech rate)
            frac = m.start() / max(1, len(text))
            facts.append({**base, "kind": kind, "label": label, "keyword": m.group(0),
                          "t_word": round(seg["t0"] + frac * (seg["t1"] - seg["t0"]), 2),
                          "directions": dirs, "asr_agree": agree})
        for kind, rx in INTENTS.items():
            if re.search(rx, text):
                intents.append({**base, "kind": kind})
        for rx in DIM_PATTERNS:
            for m in rx.finditer(text):
                dims.append({**base, "match": m.group(0)})
    summary = {}
    for f in facts:
        s = summary.setdefault(f["kind"], {"label": f["label"], "mentions": 0, "asr_agree": 0})
        s["mentions"] += 1
        s["asr_agree"] += 1 if f["asr_agree"] else 0
    out = {"language": tr.get("language"), "facts": facts, "intents": intents, "spoken_dimensions": dims,
           "summary": summary}
    write_json(pdir / "facts.json", out)
    prog.update("facts", "done", f"{len(facts)} fact mentions, {len(summary)} feature kinds, "
                f"{len(dims)} spoken dimensions, {len(intents)} build intents", 1.0)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "plot")
