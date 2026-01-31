/**
 * Web Speech API を使った音声認識フック
 *
 * @example
 * ```tsx
 * const { listening, transcript, startListening, stopListening } = useSpeechRecognition();
 *
 * <Button onClick={() => listening ? stopListening() : startListening(currentText)}>
 *   {listening ? <MicOff /> : <Mic />}
 * </Button>
 * ```
 */

import { useCallback, useRef, useState } from "react";

interface UseSpeechRecognitionOptions {
  /** 言語設定 (デフォルト: ja-JP) */
  lang?: string;
  /** 連続認識モード (デフォルト: true) */
  continuous?: boolean;
  /** 中間結果を含めるか (デフォルト: true) */
  interimResults?: boolean;
  /** 認識結果が更新されたときのコールバック */
  onTranscriptChange?: (transcript: string) => void;
}

interface UseSpeechRecognitionReturn {
  /** 音声認識中かどうか */
  listening: boolean;
  /** 認識されたテキスト */
  transcript: string;
  /** 音声認識を開始 (baseText を渡すと、その後ろに追記される) */
  startListening: (baseText?: string) => void;
  /** 音声認識を停止 */
  stopListening: () => void;
  /** ブラウザが音声認識に対応しているか */
  isSupported: boolean;
}

export function useSpeechRecognition(
  options?: UseSpeechRecognitionOptions,
): UseSpeechRecognitionReturn {
  const {
    lang = "ja-JP",
    continuous = true,
    interimResults = true,
    onTranscriptChange,
  } = options ?? {};

  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const baseTextRef = useRef("");
  const committedRef = useRef("");

  const isSupported =
    typeof window !== "undefined" &&
    (window.SpeechRecognition !== undefined || window.webkitSpeechRecognition !== undefined);

  const updateTranscript = useCallback(
    (newTranscript: string) => {
      setTranscript(newTranscript);
      onTranscriptChange?.(newTranscript);
    },
    [onTranscriptChange],
  );

  const startListening = useCallback(
    (baseText = "") => {
      if (!isSupported) {
        console.warn("SpeechRecognition is not supported in this browser");
        return;
      }

      // 既に認識中なら停止
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }

      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      const recognition = new SpeechRecognition();

      recognition.lang = lang;
      recognition.continuous = continuous;
      recognition.interimResults = interimResults;

      // ベーステキストを保持
      baseTextRef.current = baseText;
      committedRef.current = "";

      recognition.onresult = (event: SpeechRecognitionEvent) => {
        let interim = "";
        let newFinal = "";

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          if (result?.isFinal) {
            newFinal += result[0]?.transcript ?? "";
          } else {
            interim += result?.[0]?.transcript ?? "";
          }
        }

        if (newFinal) {
          committedRef.current += newFinal;
        }

        const fullTranscript = baseTextRef.current + committedRef.current + interim;
        updateTranscript(fullTranscript);
      };

      recognition.onend = () => {
        setListening(false);
        recognitionRef.current = null;
      };

      recognition.onerror = () => {
        setListening(false);
        recognitionRef.current = null;
      };

      recognitionRef.current = recognition;
      recognition.start();
      setListening(true);
      updateTranscript(baseText);
    },
    [isSupported, lang, continuous, interimResults, updateTranscript],
  );

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.onresult = null; // 結果ハンドラを無効化
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setListening(false);
  }, []);

  return {
    listening,
    transcript,
    startListening,
    stopListening,
    isSupported,
  };
}
