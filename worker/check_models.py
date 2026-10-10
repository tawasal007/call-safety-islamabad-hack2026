"""Warm speech/translation models and measure inference on a supplied WAV."""
import argparse
import asyncio
import json
import time
import wave
from pathlib import Path
from server import engine


async def main(wav_path, language):
    # This utility explicitly benchmarks offline Whisper/NLLB, not Cloud streaming.
    engine.text_backend = 'local'
    await engine.warmup()
    if engine.error:
        raise RuntimeError('Whisper model load failed: ' + engine.error)
    with wave.open(str(wav_path), 'rb') as wav:
        assert (wav.getnchannels(), wav.getsampwidth(), wav.getframerate()) == (1, 2, 16000)
        pcm = wav.readframes(wav.getnframes())
    start = time.monotonic()
    result = await engine.recognize(pcm, language, True)
    speech_seconds = time.monotonic() - start
    assert result and result['english']
    start = time.monotonic()
    try:
        urdu = result['original'] if language == 'ur' else await engine.urdu(result['english'])
    except Exception as exc:
        raise RuntimeError('Urdu model verification failed: ' + type(exc).__name__) from None
    assert any('\u0600' <= c <= '\u06ff' for c in urdu), 'Translator did not return Urdu script'
    output = {'language': result['language'], 'original': result['original'], 'english': result['english'], 'urdu': urdu, 'speechInferenceSeconds': round(speech_seconds, 2),
              'translationSecondsIncludingFirstLoad': round(time.monotonic() - start, 2)}
    path = Path(__file__).parent / 'test-output' / f'model-check-{language}.json'
    path.parent.mkdir(exist_ok=True)
    path.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(output, ensure_ascii=True))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--wav', type=Path, required=True)
    parser.add_argument('--language', choices=['en', 'ur'], default='en')
    args = parser.parse_args()
    asyncio.run(main(args.wav, args.language))
