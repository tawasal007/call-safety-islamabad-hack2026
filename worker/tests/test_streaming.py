import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from streaming import StreamingSegments


class StreamingTests(unittest.TestCase):
    def test_urdu_source_stays_in_urdu_until_separate_translation(self):
        state = StreamingSegments(0, 'ur')
        a = state.update('مجھے اپنا پاس ورڈ', 0, 1, False)
        b = state.update('مجھے اپنا پاس ورڈ بتائیں', 0, 2, True)
        self.assertEqual(a['segmentId'], b['segmentId'])
        self.assertEqual(b['language'], 'ur')
        self.assertEqual(b['original'], 'مجھے اپنا پاس ورڈ بتائیں')
        self.assertEqual(b['english'], '')

    def test_interim_revision_is_replaced_by_final_then_new_segment(self):
        state = StreamingSegments(1000)
        a = state.update('Tell me', 0, 1, False)
        b = state.update('Tell me your password.', 0, 2, True)
        c = state.update('Thank you.', 2, 3, True)
        self.assertEqual(a['segmentId'], b['segmentId'])
        self.assertGreater(b['revision'], a['revision'])
        self.assertTrue(b['final'])
        self.assertNotEqual(b['segmentId'], c['segmentId'])
        self.assertEqual((b['startMs'], b['endMs']), (1000, 3000))

    def test_replayed_final_and_duplicate_partial_do_not_duplicate_logs(self):
        state = StreamingSegments(0)
        state.update('Hello', 0, 1, False)
        self.assertIsNone(state.update('Hello', 0, 1, False))
        state.update('Hello.', 0, 1, True)
        self.assertIsNone(state.update('Hello.', 0, 1, True))

    def test_empty_final_discards_unconfirmed_words_without_persisting_them(self):
        state = StreamingSegments(0)
        a = state.update('Maybe', 0, 1, False)
        self.assertEqual(state.update('', 0, 1, True), {'discard': a['segmentId']})
        self.assertIsNone(state.update('', 1, 2, True))
        self.assertNotEqual(state.update('Hello', 2, 3, True)['segmentId'], a['segmentId'])

    def test_silence_has_no_caption(self):
        state = StreamingSegments(0)
        self.assertIsNone(state.update('  ', 0, 5, False))
        self.assertIsNone(state.update('', 0, 5, True))


if __name__ == '__main__':
    unittest.main()
