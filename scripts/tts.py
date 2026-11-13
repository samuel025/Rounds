"""Offline TTS via the system libespeak-ng (no install needed). usage: tts.py "text" out.wav -> prints duration seconds"""
import ctypes, sys, wave, array
text, out = sys.argv[1], sys.argv[2]
l = ctypes.CDLL("libespeak-ng.so.1")
sr = l.espeak_Initialize(2, 0, None, 0)
buf = array.array("h")
CB = ctypes.CFUNCTYPE(ctypes.c_int, ctypes.POINTER(ctypes.c_short), ctypes.c_int, ctypes.c_void_p)
def cb(w, n, ev):
    if w and n > 0: buf.extend(w[i] for i in range(n))
    return 0
cbf = CB(cb); l.espeak_SetSynthCallback(cbf)
l.espeak_SetVoiceByName(b"en-us"); l.espeak_SetParameter(1, 158, 0)  # rate wpm
b = text.encode(); l.espeak_Synth(b, len(b) + 1, 0, 1, 0, 0, None, None); l.espeak_Synchronize()
with wave.open(out, "wb") as f: f.setnchannels(1); f.setsampwidth(2); f.setframerate(sr); f.writeframes(buf.tobytes())
print(len(buf) / sr)
