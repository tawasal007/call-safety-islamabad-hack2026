"""Optional end-to-end STT probe: python scripts/probe-speech.py path-to-16bit-wav"""

import asyncio
import os
import sys
import wave
import json
from pathlib import Path

import aiohttp
import numpy as np
from livekit import rtc


async def main(wav_path: Path):
    app_url = os.environ.get("PROBE_APP_URL", "http://127.0.0.1:3000").rstrip("/")
    with wave.open(str(wav_path), "rb") as wav:
        assert wav.getsampwidth() == 2 and wav.getnchannels() == 1, "Use mono 16-bit PCM WAV"
        rate = wav.getframerate()
        raw = np.frombuffer(wav.readframes(wav.getnframes()), dtype=np.int16)
    output = np.interp(np.arange(0, len(raw), rate / 48000), np.arange(len(raw)), raw).astype(np.int16)

    async with aiohttp.ClientSession() as http:
        async with http.post(f"{app_url}/api/rooms", json={"language": os.environ.get("PROBE_LANGUAGE", "en")}) as response:
            response.raise_for_status()
            created = await response.json()
        async with http.post(f"{app_url}/api/rooms/join", json={
            "roomId": created["roomId"], "accessKey": created["callerAccessKey"],
        }) as response:
            response.raise_for_status()
            joined = await response.json()

        room = rtc.Room()
        await room.connect(joined["serverUrl"], joined["token"])
        try:
            for _ in range(20):
                if room.remote_participants:
                    break
                await asyncio.sleep(1)
            if not room.remote_participants:
                raise RuntimeError("Transcription worker did not join")
            source = rtc.AudioSource(48000, 1)
            track = rtc.LocalAudioTrack.create_audio_track("microphone", source)
            await room.local_participant.publish_track(track, rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_MICROPHONE))
            await asyncio.sleep(3)
            frame_size = 480
            for start in range(0, len(output), frame_size):
                chunk = output[start:start + frame_size]
                if len(chunk) < frame_size:
                    chunk = np.pad(chunk, (0, frame_size - len(chunk)))
                frame = rtc.AudioFrame(chunk.tobytes(), 48000, 1, frame_size)
                await source.capture_frame(frame)
                await asyncio.sleep(0.01)
            await source.wait_for_playout()
            for _ in range(15):
                await asyncio.sleep(1)
                async with http.get(f"{app_url}/api/call-logs/{created['roomId']}",
                                    headers={"Authorization": f"Bearer {joined['archiveAccessKey']}"}) as response:
                    response.raise_for_status()
                    log = await response.json()
                if log["segments"]:
                    print("Saved transcript:", json.dumps([(item["text"], item.get("translation")) for item in log["segments"]], ensure_ascii=True))
                    return
            raise RuntimeError("Speech was not saved within 15 seconds; inspect worker logs and STT credits")
        finally:
            await room.disconnect()


if __name__ == "__main__":
    asyncio.run(main(Path(sys.argv[1])))
