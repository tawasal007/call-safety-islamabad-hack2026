"""Evaluate existing LiveKit Inference access using a local synthetic fixture."""
import asyncio
import argparse
import json
import logging
import time
import wave
from pathlib import Path

import aiohttp
from dotenv import load_dotenv
from livekit import rtc
from livekit.agents import inference, stt, APIConnectOptions

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / '.env.local')
logging.getLogger('livekit.agents').setLevel(logging.CRITICAL)


async def main(language):
    fixture = 'ur.wav' if language == 'ur' else 'english.wav'
    with wave.open(str(ROOT / 'worker/test-output' / fixture), 'rb') as wav:
        audio = wav.readframes(wav.getnframes())
    async with aiohttp.ClientSession() as http:
        model = inference.STT(model='deepgram/nova-3', language=language, sample_rate=16000,
            http_session=http, extra_kwargs={'interim_results': True, 'endpointing': 300,
                                            'punctuate': True, 'smart_format': True})
        stream = model.stream(conn_options=APIConnectOptions(max_retry=0, timeout=10))
        started = time.monotonic()
        events = []
        async def collect():
            async for event in stream:
                if event.type in (stt.SpeechEventType.INTERIM_TRANSCRIPT, stt.SpeechEventType.FINAL_TRANSCRIPT):
                    data = event.alternatives[0]
                    events.append({'type': event.type.value, 'text': data.text,
                        'receivedSeconds': round(time.monotonic() - started, 2),
                        'start': data.start_time, 'end': data.end_time})
        reader = asyncio.create_task(collect())
        try:
            for index, offset in enumerate(range(0, len(audio) + 64000, 640)):
                if reader.done():
                    await reader
                stream.push_frame(rtc.AudioFrame(audio[offset:offset+640].ljust(640, b'\0'), 16000, 1, 320))
                await asyncio.sleep(max(0, started + (index+1) * .02 - time.monotonic()))
            stream.end_input()
            await asyncio.wait_for(reader, 15)
            print(json.dumps({'ready': True, 'audioSeconds': len(audio)/32000, 'events': events}))
        except Exception as exc:
            print(json.dumps({'ready': False, 'errorType': type(exc).__name__,
                             'statusCode': getattr(exc, 'status_code', None)}))
        finally:
            await stream.aclose()
            await model.aclose()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--language', choices=['en', 'ur'], default='en')
    asyncio.run(main(parser.parse_args().language))
