export const API_URL = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";
export const WS_URL = import.meta.env.VITE_WS_URL || "ws://127.0.0.1:8000/ws/interview";

export const INTERVIEW_MAX_SECONDS = 600; 
export const DEFAULT_MAX_QUESTIONS = 10;

export const INTERVIEW_LANGUAGES = [
  { code: "en-IN", name: "English (India)" },
  { code: "en-US", name: "English (US)" },
  { code: "hi-IN", name: "Hindi" },
  { code: "es-ES", name: "Spanish" },
  { code: "fr-FR", name: "French" },
  { code: "de-DE", name: "German" },
  { code: "zh-CN", name: "Chinese (Mandarin)" },
  { code: "ja-JP", name: "Japanese" },
  { code: "ar-SA", name: "Arabic" },
  { code: "pt-BR", name: "Portuguese" },
  { code: "ru-RU", name: "Russian" },
  { code: "ta-IN", name: "Tamil" },
  { code: "te-IN", name: "Telugu" },
  { code: "kn-IN", name: "Kannada" },
  { code: "bn-IN", name: "Bengali" },
];

export const SILENCE_THRESHOLD = 12;
export const SILENCE_DURATION_MS = 2500;
export const MAX_ANSWER_DURATION_MS = 120000;
export const MIN_ANSWER_DURATION_MS = 1200;
