#!/usr/bin/env python3
"""평가셋 40발화를 통화 음질 합성음으로 만든다.

**지난 실측(docs/research/09·10)과 같은 조건이어야 비교가 됩니다.** 방법론 §음성:

    edge-tts (ko-KR-SunHiNeural · ko-KR-InJoonNeural 교대)
      -> ffmpeg  highpass=f=300, lowpass=f=3400      전화망 대역
                 -ar 8000 -ac 1 -c:a pcm_mulaw       8kHz μ-law
                 (+잡음) anoisesrc=c=pink:a=0.05

⚠️ **전부 합성입니다.** 실제 피해자 음성이 아닙니다 → ADR-043(합성만 올린다).

    python make_audio.py <eval-set.json> <출력폴더>
"""

from __future__ import annotations

import asyncio
import json
import subprocess
import sys
from pathlib import Path

import edge_tts

VOICES = ("ko-KR-SunHiNeural", "ko-KR-InJoonNeural")

# 전화망 대역 제한 + 8kHz μ-law. 잡음은 핑크 0.05 로 섞습니다.
# amix 는 기본이 입력 수만큼 음량을 나누므로 weights 로 말소리를 살립니다.
FILTER = (
    "[0:a]{gap}highpass=f=300,lowpass=f=3400[v];"
    "[v][1:a]amix=inputs=2:duration=first:weights=1 0.35[m]"
)


def gap_filter(sec: float) -> str:
    """앞뒤에 침묵을 붙인다 — 통화의 「상대가 말하는 동안」을 흉내 냅니다.

    ⚠️ **잡음보다 먼저 넣습니다.** 순서가 반대면 침묵 구간이 완전한 무음이 되어
    VAD 가 너무 쉽게 가릅니다. 실제 통화의 침묵에는 회선 잡음이 깔려 있고,
    VAD 가 실제로 푸는 문제는 「무음 찾기」가 아니라 **「잡음 속에서 말 찾기」**
    입니다. 이 순서라야 그 문제를 냅니다.
    """
    if sec <= 0:
        return ""
    return f"adelay={int(sec * 1000)},apad=pad_dur={sec},"


async def tts(text: str, voice: str, out: Path) -> None:
    await edge_tts.Communicate(text, voice).save(str(out))


def to_phone_noisy(src: Path, dst: Path, gap: float = 0.0) -> None:
    subprocess.run(
        [
            "ffmpeg", "-y", "-loglevel", "error",
            "-i", str(src),
            "-f", "lavfi", "-i", "anoisesrc=c=pink:a=0.05",
            "-filter_complex", FILTER.format(gap=gap_filter(gap)), "-map", "[m]",
            "-ar", "8000", "-ac", "1", "-c:a", "pcm_mulaw",
            str(dst),
        ],
        check=True,
    )


def duration(path: Path) -> float:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=nw=1:nk=1", str(path)],
        capture_output=True, text=True, check=True,
    )
    return float(out.stdout.strip())


async def main() -> int:
    if len(sys.argv) not in (3, 4):
        sys.exit(__doc__)
    eval_set = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    out_dir = Path(sys.argv[2])
    gap = float(sys.argv[3]) if len(sys.argv) == 4 else 0.0
    (out_dir / "raw").mkdir(parents=True, exist_ok=True)

    manifest = []
    total = speech = 0.0
    for i, item in enumerate(eval_set["items"]):
        voice = VOICES[i % len(VOICES)]
        raw = out_dir / "raw" / f"{item['id']}.mp3"
        wav = out_dir / f"{item['id']}.wav"
        if not wav.exists():
            if not raw.exists():
                await tts(item["text"], voice, raw)
            to_phone_noisy(raw, wav, gap)
        sec = duration(wav)
        total += sec
        speech += max(sec - 2 * gap, 0.0)
        manifest.append({"id": item["id"], "file": wav.name, "voice": voice, "seconds": round(sec, 2)})
        print(f"  {item['id']}  {sec:5.1f}초  {voice.split('-')[-1]}", flush=True)

    silence_ratio = round(1 - speech / total, 3) if total else 0.0
    (out_dir / "manifest.json").write_text(
        json.dumps({"condition": "phone_noisy" + (f"_gap{gap:g}" if gap else ""),
                    "gap_seconds": gap, "silence_ratio": silence_ratio,
                    "total_seconds": round(total, 1), "items": manifest},
                   ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"\n{len(manifest)}개 · 합계 {total/60:.1f}분 · 침묵 비율 {silence_ratio:.0%}")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
