import { useCallback, useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { SpeechRecognition } from '@capacitor-community/speech-recognition';
import { TextToSpeech } from '@capacitor-community/text-to-speech';
import { fetchSpeech } from './api';

const NATIVE = Capacitor.isNativePlatform();

interface RecognitionAlternative {
  0: { transcript: string };
  length: number;
  isFinal: boolean;
}

interface RecognitionResultEvent {
  resultIndex: number;
  results: ArrayLike<RecognitionAlternative>;
}

interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: RecognitionResultEvent) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}

type RecognitionCtor = new () => RecognitionLike;

function getRecognitionCtor(): RecognitionCtor | null {
  const scope = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

export function useVoice(onFinal: (text: string) => void) {
  // Android WebView has no SpeechRecognition, so the native shell uses the
  // platform recogniser instead. Browsers keep the Web Speech API.
  const [supported] = useState(() => NATIVE || Boolean(getRecognitionCtor()));
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<RecognitionLike | null>(null);
  const finalRef = useRef('');
  const nativeTextRef = useRef('');
  const nativeDoneRef = useRef(false);
  const stopRequestedRef = useRef(false);
  const onFinalRef = useRef(onFinal);
  onFinalRef.current = onFinal;

  const finishNative = useCallback(() => {
    if (nativeDoneRef.current) return;
    nativeDoneRef.current = true;
    const text = nativeTextRef.current.trim();
    nativeTextRef.current = '';
    setListening(false);
    setInterim('');
    if (text) onFinalRef.current(text);
  }, []);

  const startNative = useCallback(async () => {
    setError(null);
    setInterim('');
    nativeTextRef.current = '';
    nativeDoneRef.current = false;
    stopRequestedRef.current = false;

    try {
      const { available } = await SpeechRecognition.available();
      if (!available) {
        setError('Is phone par Hindi speech recognition nahi hai — type karke bhejein.');
        return;
      }

      const permissions = await SpeechRecognition.checkPermissions();
      if (permissions.speechRecognition !== 'granted') {
        const requested = await SpeechRecognition.requestPermissions();
        if (requested.speechRecognition !== 'granted') {
          setError('Mic ki permission chahiye. Settings mein allow karein.');
          return;
        }
      }

      await SpeechRecognition.removeAllListeners();
      await SpeechRecognition.addListener('partialResults', (data) => {
        const text = data.matches?.[0] ?? '';
        if (!text) return;
        nativeTextRef.current = text;
        setInterim(text);
      });
      await SpeechRecognition.addListener('listeningState', (data) => {
        if (data.status === 'started') {
          setListening(true);
        } else {
          setListening(false);
          if (
            !nativeTextRef.current.trim() &&
            !nativeDoneRef.current &&
            !stopRequestedRef.current
          ) {
            setError('Kuch sunai nahi diya — dobara boliye, ya type karke bhejein.');
          }
          finishNative();
        }
      });

      setListening(true);
      const result = await SpeechRecognition.start({
        language: 'hi-IN',
        maxResults: 1,
        partialResults: true,
        popup: false,
        prompt: 'Dukaan Saathi sun raha hai…',
      });
      // With partialResults the plugin resolves as soon as listening starts;
      // the final transcript arrives through partialResults + listeningState.
      const text = result?.matches?.[0];
      if (text) {
        nativeTextRef.current = text;
        finishNative();
      }
    } catch {
      if (nativeTextRef.current.trim()) {
        finishNative();
      } else {
        setListening(false);
        setInterim('');
        setError('Aawaz samajh nahi aayi — dobara boliye, ya type karke bhejein.');
      }
    }
  }, [finishNative]);

  const stop = useCallback(() => {
    if (NATIVE) {
      stopRequestedRef.current = true;
      setListening(false);
      void SpeechRecognition.stop().catch(() => finishNative());
      return;
    }
    recognitionRef.current?.stop();
    setListening(false);
  }, [finishNative]);

  const start = useCallback(() => {
    if (NATIVE) {
      void startNative();
      return;
    }

    const Ctor = getRecognitionCtor();
    if (!Ctor) {
      setError('Is browser mein mic support nahi hai — Chrome kholein, ya type karke boliye.');
      return;
    }
    recognitionRef.current?.abort();
    finalRef.current = '';
    setInterim('');
    setError(null);

    const recognition = new Ctor();
    recognition.lang = 'hi-IN';
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.onstart = () => setListening(true);
    recognition.onresult = (event) => {
      let finalText = '';
      let interimText = '';
      for (let index = event.resultIndex; index < event.results.length; index++) {
        const result = event.results[index];
        const text = result[0]?.transcript ?? '';
        if (result.isFinal) finalText += `${text} `;
        else interimText += text;
      }
      if (finalText.trim()) {
        finalRef.current = `${finalRef.current} ${finalText}`.trim();
      }
      setInterim(interimText);
    };
    recognition.onerror = (event) => {
      const code = event.error ?? '';
      if (code === 'not-allowed' || code === 'service-not-allowed') {
        setError('Mic ki permission chahiye. Browser settings mein allow karein.');
      } else if (code === 'no-speech') {
        setError('Kuch sunai nahi diya — dobara boliye.');
      } else if (code === 'network') {
        setError('Speech service tak network nahi pahuncha. Type karke bhejein.');
      } else if (code !== 'aborted') {
        setError('Aawaz samajh nahi aayi — dobara koshish karein.');
      }
      setListening(false);
    };
    recognition.onend = () => {
      setListening(false);
      setInterim('');
      const text = finalRef.current.trim();
      finalRef.current = '';
      if (text) onFinalRef.current(text);
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      setError('Mic abhi busy hai. Thodi der baad dobara boliye.');
    }
  }, [startNative]);

  useEffect(() => {
    return () => {
      if (NATIVE) {
        void SpeechRecognition.stop().catch(() => undefined);
        void SpeechRecognition.removeAllListeners();
        return;
      }
      recognitionRef.current?.abort();
    };
  }, []);

  return { supported, listening, interim, error, start, stop, clearError: () => setError(null) };
}

export function useSpeech(enabled: boolean, timbre: boolean) {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const stop = useCallback(() => {
    audioRef.current?.pause();
    audioRef.current = null;
    if (NATIVE) {
      void TextToSpeech.stop().catch(() => undefined);
      return;
    }
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  }, []);

  const speak = useCallback(
    async (text: string) => {
      if (!enabled || !text.trim()) return;
      stop();

      if (timbre) {
        try {
          const { audioBase64, mimeType } = await fetchSpeech(text);
          const audio = new Audio(`data:${mimeType};base64,${audioBase64}`);
          audioRef.current = audio;
          await audio.play();
          return;
        } catch {
          // Timbre unavailable — the device voice still speaks the reply.
        }
      }

      if (NATIVE) {
        try {
          await TextToSpeech.speak({ text, lang: 'hi-IN', rate: 0.95, pitch: 1, volume: 1 });
          return;
        } catch {
          return;
        }
      }

      if (!('speechSynthesis' in window)) return;
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'hi-IN';
      utterance.rate = 1.02;
      utterance.pitch = 1;
      const voices = window.speechSynthesis.getVoices();
      const hindi = voices.find((voice) => voice.lang.toLowerCase().startsWith('hi'));
      if (hindi) utterance.voice = hindi;
      window.speechSynthesis.speak(utterance);
    },
    [enabled, stop, timbre],
  );

  useEffect(() => stop, [stop]);

  return { speak, stop };
}
