#!/usr/bin/env python3
"""시연용 Mock 증거 셋을 만든다 — 통화 녹음 하나 · 화면 캡처 둘.

정본: 같은 폴더의 `script.json`(대본) · `README.md`(무엇이고 왜 합성인가)

## 왜 합성인가

[ADR-043](../../../decisions/043-gpu-hosting.md)이 **절대 조건**으로 걸어 둔 것입니다 —
*"합성 데이터만 올립니다. 실제 피해자의 음성·이미지는 올리지 않습니다."*
올린 녹음·이미지는 **가려지기 전 원본 그대로** 전사·판독 서버로 나가기 때문입니다
(`flows/read-evidence.ts` 가 전사 **뒤에** 가립니다). 합성이면 지킬 개인정보가 없습니다.

실제 통화 음성인 「그놈 목소리」는 [research/07](../../../docs/research/07-학습데이터-조사.md)의
**D-02(공공누리 유형)·D-03(내려받기 가능 여부)이 미확인**이라 쓰지 않습니다 —
[research/09](../../../docs/research/09-로컬모델-PII인식-실측.md)가 같은 이유로 안 썼습니다.

## 음성은 실측과 같은 조건입니다

`assets/datasets/08-25-stt-preprocess/make_audio.py` 와 **같은 사슬**을 씁니다 —
전사 정확도가 시연에서만 좋게 나오면 안 되기 때문입니다.

    edge-tts (남녀 교대) -> ffmpeg highpass=300, lowpass=3400   전화망 대역
                                  -ar 8000 -ac 1 -c:a pcm_mulaw  8kHz μ-law
                                  + anoisesrc=c=pink:a=0.05      회선 잡음

⚠️ **TTS 합성음은 실제 통화보다 발음이 또렷합니다** → research/09 의 같은 경고.
전사가 여기서 잘 된다고 실제 통화에서도 그렇다고 말하면 안 됩니다.

    python make_mock.py [출력폴더]        # 기본값: 이 폴더
"""

from __future__ import annotations

import asyncio
import json
import subprocess
import sys
from pathlib import Path

import edge_tts
from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent

# 사기범은 남성, 피해자는 여성 — `make_audio.py` 와 같은 두 목소리입니다
VOICE = {"scammer": "ko-KR-InJoonNeural", "victim": "ko-KR-SunHiNeural"}

# 전화망 대역 제한 + 8kHz μ-law. 잡음은 핑크 0.05.
# amix 는 기본이 입력 수만큼 음량을 나누므로 weights 로 말소리를 살립니다
FILTER = (
    "[0:a]highpass=f=300,lowpass=f=3400[v];"
    "[v][1:a]amix=inputs=2:duration=first:weights=1 0.35[m]"
)

# 글꼴 — Windows 의 맑은 고딕을 먼저 보고, 없으면 나눔고딕으로 떨어집니다.
# `make_screens.py` 가 맑은 고딕을 쓰고 있어 같은 글꼴을 먼저 봅니다
FONT_CANDIDATES = {
    "regular": [
        "/mnt/c/Windows/Fonts/malgun.ttf",
        "C:/Windows/Fonts/malgun.ttf",
        "/usr/share/fonts/truetype/nanum/NanumGothic.ttf",
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    ],
    "bold": [
        "/mnt/c/Windows/Fonts/malgunbd.ttf",
        "C:/Windows/Fonts/malgunbd.ttf",
        "/usr/share/fonts/truetype/nanum/NanumGothicBold.ttf",
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
    ],
}


def font(weight: str, size: int) -> ImageFont.FreeTypeFont:
    for path in FONT_CANDIDATES[weight]:
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    raise SystemExit(
        f"한글 글꼴을 못 찾았습니다 ({weight}). 맑은 고딕이나 나눔고딕을 설치하세요."
    )


# ── 통화 녹음 ────────────────────────────────────────────────────


async def make_call(script: dict, out: Path) -> None:
    """한 줄씩 합성해 이어 붙이고, 통화 음질로 떨어뜨립니다.

    **줄 사이에 침묵을 둡니다.** 붙여 놓으면 화자가 바뀌는 자리를 알 수 없어
    전사기의 화자분리가 할 일이 없어집니다.
    """
    raw = out.parent / "raw"
    raw.mkdir(parents=True, exist_ok=True)

    parts: list[Path] = []
    for i, line in enumerate(script["lines"]):
        piece = raw / f"{i:02d}.mp3"
        if not piece.exists():
            await edge_tts.Communicate(line["text"], VOICE[line["who"]]).save(str(piece))
        parts.append(piece)

    # 이어 붙이기 — 사이에 0.35초 침묵을 넣습니다
    listing = raw / "concat.txt"
    silence = raw / "sil.mp3"
    if not silence.exists():
        subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi",
             "-i", "anullsrc=r=24000:cl=mono", "-t", "0.35", str(silence)],
            check=True,
        )
    lines = []
    for piece in parts:
        lines.append(f"file '{piece.as_posix()}'")
        lines.append(f"file '{silence.as_posix()}'")
    listing.write_text("\n".join(lines), encoding="utf-8")

    joined = raw / "joined.mp3"
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0",
         "-i", str(listing), "-c", "copy", str(joined)],
        check=True,
    )

    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error",
         "-i", str(joined),
         "-f", "lavfi", "-i", "anoisesrc=c=pink:a=0.05",
         "-filter_complex", FILTER, "-map", "[m]",
         "-ar", "8000", "-ac", "1", "-c:a", "pcm_mulaw",
         str(out)],
        check=True,
    )


def duration(path: Path) -> float:
    got = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=nw=1:nk=1", str(path)],
        capture_output=True, text=True, check=True,
    )
    return float(got.stdout.strip())


# ── 화면 캡처 둘 ──────────────────────────────────────────────────

WIDTH = 900
INK = (26, 28, 33)
DIM = (120, 126, 138)
BG = (235, 237, 241)
MINE = (254, 229, 0)      # 카카오톡 노랑 계열 — 내 말풍선
THEIRS = (255, 255, 255)


def wrap(draw: ImageDraw.ImageDraw, text: str, f: ImageFont.FreeTypeFont, limit: int) -> list[str]:
    """글자 폭으로 줄을 나눕니다 — 한국어는 공백이 드물어 글자 단위로 봅니다."""
    out: list[str] = []
    for para in text.split("\n"):
        line = ""
        for ch in para:
            if draw.textlength(line + ch, font=f) > limit and line:
                out.append(line)
                line = ch
            else:
                line += ch
        out.append(line)
    return out


def make_messages(spec: dict, out: Path) -> None:
    """문자·메신저 화면 한 장. **말풍선 좌우로 화자가 갈립니다.**

    전사·판독 쪽 화자 나누기가 글상자의 가로 위치를 보므로(`transcriber`),
    좌우를 확실히 벌려 둡니다.
    """
    f_head = font("bold", 26)
    f_time = font("regular", 18)
    f_body = font("regular", 24)

    pad, gap, bubble_max = 28, 14, 470
    probe = ImageDraw.Draw(Image.new("RGB", (1, 1)))

    blocks = []
    height = 96 + pad
    for line in spec["lines"]:
        rows = wrap(probe, line["text"], f_body, bubble_max - 32)
        box_h = 22 + len(rows) * 34
        blocks.append((line, rows, box_h))
        height += box_h + gap

    img = Image.new("RGB", (WIDTH, height + pad), BG)
    d = ImageDraw.Draw(img)

    # 머리 — 상대 번호. **이름이 아니라 번호입니다**(모르는 사람이라서)
    d.rectangle([0, 0, WIDTH, 76], fill=(247, 248, 250))
    d.text((pad, 24), spec["peer"], font=f_head, fill=INK)
    d.line([(0, 76), (WIDTH, 76)], fill=(219, 222, 228), width=1)

    y = 96
    for line, rows, box_h in blocks:
        mine = line["who"] == "me"
        width_px = max(probe.textlength(r, font=f_body) for r in rows) + 32
        width_px = min(width_px, bubble_max)
        x = WIDTH - pad - width_px if mine else pad

        d.rounded_rectangle(
            [x, y, x + width_px, y + box_h], radius=14,
            fill=MINE if mine else THEIRS,
            outline=(224, 227, 233) if not mine else None,
        )
        for i, row in enumerate(rows):
            d.text((x + 16, y + 11 + i * 34), row, font=f_body, fill=INK)

        stamp = line["time"]
        w = probe.textlength(stamp, font=f_time)
        d.text(
            (x - 8 - w if mine else x + width_px + 8, y + box_h - 26),
            stamp, font=f_time, fill=DIM,
        )
        y += box_h + gap

    img.save(out)


def make_transfer(spec: dict, out: Path) -> None:
    """은행 앱의 이체 완료 화면 한 장 — 계좌·금액이 통화·문자와 같습니다."""
    f_brand = font("bold", 24)
    f_title = font("bold", 34)
    f_amount = font("bold", 46)
    f_label = font("regular", 23)
    f_value = font("bold", 25)
    f_foot = font("regular", 19)

    height = 300 + len(spec["rows"]) * 58 + 80
    img = Image.new("RGB", (WIDTH, height), (255, 255, 255))
    d = ImageDraw.Draw(img)
    pad = 44

    d.rectangle([0, 0, WIDTH, 84], fill=(247, 248, 250))
    d.text((pad, 28), spec["bank"], font=f_brand, fill=INK)

    d.text((pad, 124), spec["title"], font=f_title, fill=INK)
    d.text((pad, 182), spec["amount"], font=f_amount, fill=INK)
    d.line([(pad, 268), (WIDTH - pad, 268)], fill=(228, 231, 236), width=1)

    y = 292
    for label, value in spec["rows"]:
        d.text((pad, y), label, font=f_label, fill=DIM)
        w = d.textlength(value, font=f_value)
        d.text((WIDTH - pad - w, y - 2), value, font=f_value, fill=INK)
        y += 58

    d.line([(pad, y + 8), (WIDTH - pad, y + 8)], fill=(228, 231, 236), width=1)
    d.text((pad, y + 30), spec["foot"], font=f_foot, fill=DIM)

    img.save(out)


# ── ────────────────────────────────────────────────────────────


async def main() -> int:
    out_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else HERE
    out_dir.mkdir(parents=True, exist_ok=True)
    script = json.loads((HERE / "script.json").read_text(encoding="utf-8"))

    call = out_dir / "call.wav"
    await make_call(script["call"], call)
    print(f"call.wav      {duration(call):6.1f}초  {call.stat().st_size / 1024:7.0f}KB")

    messages = out_dir / "messages.png"
    make_messages(script["messages"], messages)
    print(f"messages.png  {Image.open(messages).size}  {messages.stat().st_size / 1024:7.0f}KB")

    transfer = out_dir / "transfer.png"
    make_transfer(script["transfer"], transfer)
    print(f"transfer.png  {Image.open(transfer).size}  {transfer.stat().st_size / 1024:7.0f}KB")

    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
