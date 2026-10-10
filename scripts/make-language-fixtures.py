"""Test-only synthetic Urdu speech; not a production speech provider.

Requires edge-tts, separately installed. Writes local WAV fixtures for evaluation.
"""
import asyncio
import wave
from pathlib import Path
import av
import edge_tts

OUTPUT = Path(__file__).resolve().parents[1] / 'worker' / 'test-output'
CASES = [
    ('ur', 'ur-PK-AsadNeural', 'میں آپ کے بینک سے بات کر رہا ہوں۔ مجھے اپنا پاس ورڈ بتائیں ورنہ آپ کا اکاؤنٹ بند ہو جائے گا۔'),
]


async def main():
    OUTPUT.mkdir(exist_ok=True)
    for language, voice, text in CASES:
        mp3 = OUTPUT / (language + '.mp3')
        try:
            await edge_tts.Communicate(text, voice).save(str(mp3))
        except edge_tts.exceptions.NoAudioReceived:
            print('No synthetic', language, 'voice available from this test service; use a human recording.')
            continue
        resampler = av.AudioResampler(format='s16', layout='mono', rate=16000)
        with av.open(str(mp3)) as source, wave.open(str(OUTPUT / (language + '.wav')), 'wb') as dest:
            dest.setnchannels(1)
            dest.setsampwidth(2)
            dest.setframerate(16000)
            for frame in source.decode(audio=0):
                for converted in resampler.resample(frame):
                    dest.writeframes(converted.to_ndarray().tobytes())
            for converted in resampler.resample(None):
                dest.writeframes(converted.to_ndarray().tobytes())
        print('Generated synthetic', language, 'fixture')


if __name__ == '__main__':
    asyncio.run(main())
