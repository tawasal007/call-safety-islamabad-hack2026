"""Measure streaming captions through deployed APIs + real simultaneous RTC audio.

Synthetic fixture only. No invitations, tokens or human call content in output.
"""
import argparse
import asyncio
import json
import re
import time
import wave
import unicodedata
from pathlib import Path
from urllib.parse import urlparse, parse_qs

import httpx
from livekit import rtc

EXPECTED = 'I am calling from your bank. Tell me your password now or your account will be blocked.'
URDU_EXPECTED = 'میں آپ کے بینک سے بات کر رہا ہوں۔ مجھے اپنا پاس ورڈ بتائیں ورنہ آپ کا اکاؤنٹ بند ہو جائے گا۔'


def words(text):
    # Compare Urdu words independently of diacritics and Arabic/Persian letter forms.
    text = ''.join(c for c in unicodedata.normalize('NFKD', text) if not unicodedata.combining(c))
    text = text.replace('ي', 'ی').replace('ك', 'ک').replace('پاسورڈ', 'پاس ورڈ')
    return re.findall(r"\w+", text.lower())


def wer(expected, actual):
    a, b = words(expected), words(actual)
    previous = list(range(len(b) + 1))
    for i, x in enumerate(a, 1):
        current = [i]
        for j, y in enumerate(b, 1):
            current.append(min(current[-1] + 1, previous[j] + 1, previous[j-1] + (x != y)))
        previous = current
    return round(previous[-1] / len(a), 3)


async def run(base, language='en', mixed=False):
    root = Path(__file__).resolve().parents[1]
    languages = {'caller': language, 'receiver': 'en' if mixed else language}
    fixtures = {}
    for role, spoken in languages.items():
        with wave.open(str(root / 'worker/test-output' / ('ur.wav' if spoken == 'ur' else 'english.wav')), 'rb') as wav:
            fixtures[role] = wav.readframes(wav.getnframes())
    events, starts = [], {}
    rooms, sources = [rtc.Room(), rtc.Room()], []
    async with httpx.AsyncClient(timeout=30) as client:
        created_response = await client.post(base + '/api/rooms')
        created_response.raise_for_status()
        created = created_response.json()
        room_id = created['roomId']
        keys = [created['callerAccessKey'], parse_qs(urlparse(created['inviteUrl']).query)['invite'][0]]
        grants = []
        for key in keys:
            response = await client.post(base + '/api/rooms/join', json={'roomId': room_id, 'accessKey': key})
            response.raise_for_status()
            grants.append(response.json())

        @rooms[1].on('data_received')
        def received(packet):
            if packet.participant and packet.participant.identity == 'transcriber-' + room_id and packet.topic == 'call-safety.transcription':
                event = json.loads(packet.data)
                if event['type'] == 'segment':
                    events.append((time.monotonic(), event['segment']))

        try:
            for room, grant in zip(rooms, grants):
                await room.connect(grant['serverUrl'], grant['token'])
            for role, key in zip(('caller', 'receiver'), keys):
                response = await client.post(base + '/api/transcription',
                    json={'roomId': room_id, 'accessKey': key, 'language': languages[role]})
                response.raise_for_status()
            for room in rooms:
                source = rtc.AudioSource(16000, 1)
                track = rtc.LocalAudioTrack.create_audio_track('streaming-test', source)
                await room.local_participant.publish_track(track,
                    rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_MICROPHONE))
                sources.append(source)
            await asyncio.sleep(2)

            async def speak(role, source):
                audio = fixtures[role]
                starts[role] = time.monotonic()
                # Deadline pacing avoids Windows timer overshoot accumulating
                # across hundreds of frames and inflating latency measurements.
                for index, offset in enumerate(range(0, len(audio) + 32000 * 6, 640)):
                    data = audio[offset:offset+640].ljust(640, b'\0')
                    await source.capture_frame(rtc.AudioFrame(data, 16000, 1, 320))
                    await asyncio.sleep(max(0, starts[role] + (index+1) * .02 - time.monotonic()))
                await source.wait_for_playout()

            await asyncio.gather(*(speak(role, source) for role, source in zip(('caller', 'receiver'), sources)))
            for _ in range(35):
                response = await client.post(base + '/api/calls/' + room_id,
                    json={'historyKey': grants[0]['historyAccessKey']})
                response.raise_for_status()
                log = response.json()
                if log['segments'] and all(s['translationStatus'] != 'pending' for s in log['segments']):
                    break
                await asyncio.sleep(1)
            assert log['segments'], 'No finalized segments saved'
            metrics = {}
            for role in ('caller', 'receiver'):
                live = [(at, s) for at, s in events if s['speaker'] == role]
                partials = [(at, s) for at, s in live if not s['final']]
                finals = [s for s in log['segments'] if s['speaker'] == role]
                assert partials and finals, 'Missing interim or finalized speaker captions'
                first = min(at for at, _ in partials) - starts[role]
                transcript = ' '.join(s['original'] for s in finals)
                error = wer(URDU_EXPECTED if languages[role] == 'ur' else EXPECTED, transcript)
                duration = len(fixtures[role]) / 32000
                assert first < duration, 'No caption until after speech ended'
                assert first < 3.5, 'First caption exceeded streaming target'
                assert error <= .15, 'Fixture transcription has too many word errors'
                assert all(s['language'] == languages[role] for s in finals), 'Wrong source language'
                assert all(s['translationStatus'] == 'ready' and s['english'] and s['urdu'] for s in finals), 'Missing bilingual final output'
                assert all(s['recognizer'] == 'livekit/deepgram/nova-3' for s in finals)
                assert max(s['latencyMs'] for s in finals) < 5000, 'Final captions delayed by backlog'
                metrics[role] = {'firstInterimSeconds': round(first, 2), 'fixtureWordErrorRate': error,
                    'language': languages[role],
                    'finalLatencySeconds': [round(s['latencyMs']/1000, 2) for s in finals],
                    'finalSegments': len(finals), 'transcript': transcript,
                    'translationSeconds': [round(s.get('translationLatencyMs', 0)/1000, 2) for s in finals],
                    'urduTranslationsReady': all(s['translationStatus'] == 'ready' for s in finals)}
            assert any(s['matches'] for s in log['segments'] if s['speaker'] == 'caller')
            assert not any(s['matches'] for s in log['segments'] if s['speaker'] == 'receiver')
            assert len({s['segmentId'] for s in log['segments']}) == len(log['segments'])
            denied = await client.post(base + '/api/calls/' + room_id, json={'historyKey': 'invalid'})
            assert denied.status_code == 403
            # Muted tracks remain subscribed: ensure silence cannot add gibberish.
            saved_ids = {s['segmentId'] for s in log['segments']}
            await asyncio.sleep(6)
            response = await client.post(base + '/api/calls/' + room_id,
                json={'historyKey': grants[0]['historyAccessKey']})
            response.raise_for_status()
            assert {s['segmentId'] for s in response.json()['segments']} == saved_ids, 'Silence produced captions'
            result = {'base': base, 'roomId': room_id, 'simultaneousSpeakers': metrics,
                      'silence': 'passed', 'keywordAttribution': 'passed', 'privateLogs': 'passed'}
            output = root / 'worker/test-output' / ('streaming-benchmark-' + ('mixed' if mixed else language) + '.json')
            output.write_text(json.dumps(result, indent=2), encoding='utf-8')
            print(json.dumps(result))
        finally:
            for source in sources:
                await source.aclose()
            for room in rooms:
                await room.disconnect()
        for _ in range(35):
            await asyncio.sleep(1)
            response = await client.post(base + '/api/calls/' + room_id,
                json={'historyKey': grants[0]['historyAccessKey']})
            if response.json()['status'] == 'ended':
                print('Ended log saved and worker released the room.')
                break
        else:
            raise AssertionError('Worker did not release room')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--base', default='https://call-safety-urdu.vercel.app')
    parser.add_argument('--language', choices=['en', 'ur'], default='en')
    parser.add_argument('--mixed', action='store_true')
    args = parser.parse_args()
    asyncio.run(run(args.base.rstrip('/'), args.language, args.mixed))
