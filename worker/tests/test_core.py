import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from core import Store, UtteranceBuffer, keyword_matches


def segment(text, n=1, speaker='caller'):
    return {'roomId': 'call-test', 'segmentId': str(n), 'speaker': speaker, 'final': True,
            'startMs': n * 1000, 'endMs': n * 1000 + 500, 'english': text, 'revision': 1}


class DetectionTests(unittest.TestCase):
    def test_negative_cases(self):
        for text in ('How was your day?', 'Never share your OTP.', 'My OTP expired.',
                     'The movie was about a kidnapping.', 'If someone threatens you, get help.',
                     'Can you return the money you borrowed?', 'Can you send money for lunch?',
                     "Don't give me your password."):
            with self.subTest(text=text):
                self.assertEqual(keyword_matches([segment(text)]), [])

    def test_credentials_and_impersonation(self):
        result = keyword_matches([segment("I'm from your bank. Tell me the OTP now or your account will be blocked.")])
        self.assertTrue({'credential_request', 'impersonation', 'pressure'} <= {m['category'] for m in result})
        for match in result:
            self.assertIn(match['evidence'], "I'm from your bank. Tell me the OTP now or your account will be blocked.")

    def test_advice_does_not_mask_later_direct_request(self):
        result = keyword_matches([segment('Never share your OTP. Give me your password.')])
        self.assertEqual([m['category'] for m in result], ['credential_request'])

    def test_receiver_never_generates_caller_matches(self):
        self.assertEqual(keyword_matches([segment('Tell me your OTP now.', speaker='receiver')]), [])

    def test_request_split_across_segments_keeps_exact_evidence(self):
        result = keyword_matches([segment('Tell me your'), segment('OTP now.', 2)])
        self.assertEqual(result[0]['category'], 'credential_request')
        self.assertEqual(result[0]['evidence'], 'OTP')
        self.assertIn('2', result[0]['contextSegmentIds'])

    def test_cross_segment_threat_and_coercion(self):
        history = [segment('We have your brother.'), segment('Send money or we will hurt him.', 2)]
        result = keyword_matches(history)
        self.assertTrue({'payment_request', 'threat'} <= {m['category'] for m in result})
        self.assertIn('1', result[0]['contextSegmentIds'])
        history.append(segment("Don't hang up or contact your family.", 3))
        self.assertIn('coercion', {m['category'] for m in keyword_matches(history)})

    def test_extortion(self):
        result = keyword_matches([segment('Pay me or I will publish your private photos.')])
        self.assertTrue({'payment_request', 'private_information_threat'} <= {m['category'] for m in result})

    def test_old_context_expires(self):
        self.assertEqual(keyword_matches([segment('We have your brother.'), segment("Don't hang up.", 100)]), [])

    def test_original_urdu_evidence_survives_imperfect_english_translation(self):
        s = {**segment('Please provide the secret.'), 'language': 'ur',
             'original': 'میں آپ کے بینک سے بات کر رہا ہوں۔ مجھے اپنا پاس ورڈ بتائیں ورنہ آپ کا اکاؤنٹ بند ہو جائے گا۔'}
        result = keyword_matches([s])
        self.assertTrue({'credential_request', 'impersonation', 'pressure'} <= {m['category'] for m in result})
        for match in result:
            self.assertEqual(match['evidenceLanguage'], 'ur')
            self.assertIn(match['evidence'], s['original'])

    def test_urdu_safety_advice_is_not_a_credential_request(self):
        for original in ('اپنا پاس ورڈ کسی کو مت بتائیں۔', 'اپنا او ٹی پی کبھی شیئر نہ کریں۔', 'اگر کوئی پاس ورڈ مانگے تو نہ بتائیں۔'):
            s = {**segment('Never share your password.'), 'language': 'ur', 'original': original}
            self.assertEqual(keyword_matches([s]), [])

    def test_urdu_pin_does_not_match_inside_apna(self):
        for original in ('مجھے اپنا نام بتائیں۔', 'بتائیں اپنا نام کیا ہے؟'):
            s = {**segment('Tell me your name.'), 'language': 'ur', 'original': original}
            self.assertEqual(keyword_matches([s]), [])
        s = {**segment('Please provide the secret.'), 'language': 'ur',
             'original': 'مجھے اپنا پاس ورٹ بتائیں۔'}
        matches = keyword_matches([s])
        self.assertEqual(matches[0]['evidence'], 'پاس ورٹ بتائیں')


class SegmentationTests(unittest.TestCase):
    def test_interim_then_silence_final_preserves_audio(self):
        buffer = UtteranceBuffer()
        events = []
        for i in range(100):
            event = buffer.feed(bytes([i % 256]) * 640, i < 70)
            if event:
                events.append(event)
        self.assertFalse(events[0][-1])
        self.assertTrue(events[-1][-1])
        self.assertEqual(len(events[-1][0]), 100 * 640)
        self.assertEqual(buffer.frames, [])

    def test_silence_and_short_noise_do_not_form_speech(self):
        buffer = UtteranceBuffer()
        for _ in range(1000):
            self.assertIsNone(buffer.feed(b'\0' * 640, False))
        self.assertLessEqual(len(buffer.pre), 10)
        for _ in range(4):
            buffer.feed(b'\1' * 640, True)
        self.assertIsNone(buffer.flush())

    def test_forced_endpoint_bounds_long_speech(self):
        buffer = UtteranceBuffer(max_seconds=2)
        result = None
        for _ in range(100):
            result = buffer.feed(b'\1' * 640, True)
        self.assertTrue(result[-1])
        self.assertEqual(len(result[0]), 64000)


class PersistenceTests(unittest.TestCase):
    def test_per_call_isolation_revision_dedup_and_restart(self):
        output = Path(__file__).resolve().parents[1] / 'test-output'
        output.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=output) as temp:
            path = str(Path(temp) / 'calls.sqlite3')
            store = Store(path)
            store.start('call-test')
            store.start('call-other')
            s = segment('Hello')
            store.save({**s, 'final': False})
            self.assertEqual(store.get('call-test')['segments'], [])
            store.save(s)
            store.save({**s, 'revision': 2, 'english': 'Updated'})
            store.save(s)
            self.assertEqual(store.get('call-test')['segments'][0]['english'], 'Updated')
            self.assertEqual(store.get('call-other')['segments'], [])
            store.db.close()
            store = Store(path)
            store.recover()
            self.assertEqual(store.get('call-test')['status'], 'ended')
            self.assertEqual(len(store.get('call-test')['segments']), 1)
            store.db.close()


if __name__ == '__main__':
    unittest.main()
