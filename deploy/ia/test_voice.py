"""Pruebas del puente HTTP de Chatterbox sin descargar ni ejecutar modelos."""
import importlib.util, io, os, pathlib, tempfile, unittest
from unittest.mock import patch

from fastapi import HTTPException


class VoiceProxyTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        root = pathlib.Path(cls.tmp.name)
        key = root / "key"
        key.write_text("test-key")
        with patch.dict(os.environ, {"IA_API_KEY_FILE": str(key), "IA_CACHE": str(root),
                                  "CHATTERBOX_URL": "http://chatterbox:8011/speak"}):
            spec = importlib.util.spec_from_file_location("oficina_ia_test", pathlib.Path(__file__).with_name("app.py"))
            cls.ia = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(cls.ia)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_voice_advertised_alongside_existing_voices(self):
        request = type("Request", (), {"headers": {"authorization": "Bearer test-key"}})()
        ids = {entry["id"] for entry in self.ia.voices(request)}
        self.assertTrue({"chatterbox-latam", "piper-claude", "kokoro-dora"} <= ids)

    def test_proxy_forwards_text_and_speed_as_json(self):
        class Answer(io.BytesIO):
            def __enter__(self): return self
            def __exit__(self, *_): self.close()

        wav = b"RIFF\x00\x00\x00\x00WAVEdata"
        with patch.object(self.ia.urllib.request, "urlopen", return_value=Answer(wav)) as open_url:
            self.assertEqual(self.ia.synthesize_chatterbox("Hola", 1.25), wav)
        request = open_url.call_args.args[0]
        self.assertEqual(request.full_url, "http://chatterbox:8011/speak")
        self.assertEqual(request.get_header("Content-type"), "application/json")
        self.assertEqual(request.data, b'{"text": "Hola", "speed": 1.25}')
        self.assertEqual(open_url.call_args.kwargs["timeout"], 105)

    def test_long_notice_is_rejected_before_network_call(self):
        with patch.object(self.ia.urllib.request, "urlopen") as open_url:
            with self.assertRaises(HTTPException) as raised:
                self.ia.synthesize_chatterbox("x" * 181, 1)
        self.assertEqual(raised.exception.status_code, 400)
        open_url.assert_not_called()

    def test_unavailable_service_has_controlled_error(self):
        with patch.object(self.ia.urllib.request, "urlopen", side_effect=OSError("offline")):
            with self.assertRaises(HTTPException) as raised:
                self.ia.synthesize_chatterbox("Hola", 1)
        self.assertEqual(raised.exception.status_code, 503)


if __name__ == "__main__":
    unittest.main()
