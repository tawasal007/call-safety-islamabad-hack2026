"""Speak a WAV into an invited room. Reads the invitation from standard input."""

import asyncio
import sys
import wave
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import aiohttp
import numpy as np
from livekit import rtc


async def main(wav_path: Path, invitation: str):
    parsed = urlparse(invitation.strip())
    room_id = parsed.path.rsplit("/", 1)[-1]
    access_key = parse_qs(parsed.query).get("invite", [""])[0]
    if not room_id.startswith("call-") or not access_key:
        raise ValueError("Invalid invitation")
    with wave.open(str(wav_path), "rb") as wav:
        assert wav.getsampwidth() == 2 and wav.getnchannels() == 1
        rate = wav.getframerate()
        raw = np.frombuffer(wav.readframes(wav.getnframes()), dtype=np.int16)
    samples = np.interp(np.arange(0, len(raw), rate / 48000), np.arange(len(raw)), raw).astype(np.int16)

    async with aiohttp.ClientSession() as http:
        async with http.post("http://127.0.0.1:3000/api/rooms/join", json={
            "roomId": room_id, "accessKey": access_key,
        }) as response:
            response.raise_for_status()
            joined = await response.json()
    room = rtc.Room()
    await room.connect(joined["serverUrl"], joined["token"])
    try:
        source = rtc.AudioSource(48000, 1)
        track = rtc.LocalAudioTrack.create_audio_track("microphone", source)
        await room.local_participant.publish_track(track, rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_MICROPHONE))
        await asyncio.sleep(5)
        for start in range(0, len(samples), 480):
            chunk = samples[start:start + 480]
            if len(chunk) < 480:
                chunk = np.pad(chunk, (0, 480 - len(chunk)))
            await source.capture_frame(rtc.AudioFrame(chunk.tobytes(), 48000, 1, 480))
            await asyncio.sleep(0.01)
        await source.wait_for_playout()
        await asyncio.sleep(6)
        print("Receiver speech sent; check the browser transcript and Call Logs")
    finally:
        await room.disconnect()


if __name__ == "__main__":
    asyncio.run(main(Path(sys.argv[1]), sys.stdin.readline()))
