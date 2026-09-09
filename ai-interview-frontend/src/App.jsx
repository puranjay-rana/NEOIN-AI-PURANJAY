import React, { useEffect, useRef, useState, useMemo } from "react";
import "./App.css";

// Configuration & Utils
import {
  API_URL,
  WS_URL,
  INTERVIEW_MAX_SECONDS,
  DEFAULT_MAX_QUESTIONS,
  INTERVIEW_LANGUAGES,
  SILENCE_THRESHOLD,
  SILENCE_DURATION_MS,
  MAX_ANSWER_DURATION_MS,
  MIN_ANSWER_DURATION_MS,
} from "./config/constants";
import { safeRound, blobToBase64 } from "./utils/formatters";
import { computeVideoAnalytics, computeVoiceAnalytics, computeConfidenceTimeline } from "./utils/analytics";
import { uploadResumeApi } from "./services/api";

// UI Components
import { Alert } from "./components/common/UIComponents";
import { AssessmentSetup } from "./components/setup/AssessmentSetup";

// Live Interview View Components
import { InterviewHeader } from "./components/interview/InterviewHeader";
import { AIAvatarSection } from "./components/interview/AIAvatarSection";
import { CandidateFeedSection } from "./components/interview/CandidateFeedSection";
import { TranscriptSection } from "./components/interview/TranscriptSection";
import { ExitModal } from "./components/interview/ExitModal";

// Dashboard View Components
import { DashboardHeader } from "./components/dashboard/DashboardHeader";
import { KPIGrid } from "./components/dashboard/KPIGrid";
import { CompetencyRadarChart } from "./components/dashboard/CompetencyRadarChart";
import { SkillMetricsSection } from "./components/dashboard/SkillMetricsSection";
import { AnalyticsSection } from "./components/dashboard/AnalyticsSection";
import { QuestionBreakdown } from "./components/dashboard/QuestionBreakdown";
import { ProctoringSummary } from "./components/dashboard/ProctoringSummary";
import { FullSessionRecordingCard } from "./components/dashboard/FullSessionRecordingCard";

function App() {
  // DOM & Media Refs
  const videoRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioRecordingStreamRef = useRef(null);
  const chunksRef = useRef([]);
  const wsRef = useRef(null);

  // Assessment & Session Refs
  const answerFramesRef = useRef([]);
  const frameTimerRef = useRef(null);
  const transcriptEndRef = useRef(null);
  const lastSpokenQuestionRef = useRef(""); 
  const askedQuestionsRef = useRef([]); 
  const lastAcceptedQuestionNumberRef = useRef(0);
  const answerSubmitLockRef = useRef(false);
  const interviewPhaseRef = useRef("IDLE");

  // Speech Recognition & TTS Refs
  const recognitionRef = useRef(null);
  const finalTranscriptRef = useRef("");
  const speechVoicesRef = useRef([]);
  const ttsAudioElRef = useRef(null);

  // Flags & Timers Refs
  const startingInterviewRef = useRef(false);
  const startingRecordingRef = useRef(false);
  const finishRequestedRef = useRef(false);
  const manualExitRef = useRef(false); 
  const finishFallbackTimerRef = useRef(null); 
  const cheatWarningTimerRef = useRef(null);
  const showTextAnswerRef = useRef(false);

  // Full Session Video Recording Refs
  const sessionRecorderRef = useRef(null);
  const sessionChunksRef = useRef([]);
  const [fullSessionUrl, setFullSessionUrl] = useState("");

  // Audio Mixer & Silence Detection Refs
  const silenceAudioCtxRef = useRef(null);
  const silenceIntervalRef = useRef(null);
  const silenceStartedAtRef = useRef(null);
  const speechDetectedRef = useRef(false);
  const recordingStartedAtRef = useRef(0);
  const maxAnswerTimeoutRef = useRef(null);
  const sessionAudioCtxRef = useRef(null);
  const sessionMixDestRef = useRef(null);

  // Setup Form State
  const [resumeFile, setResumeFile] = useState(null);
  const [resumeText, setResumeText] = useState("");
  const [jobDescription, setJobDescription] = useState("");
  const [maxQuestions, setMaxQuestions] = useState(DEFAULT_MAX_QUESTIONS);
  const [interviewLanguage, setInterviewLanguage] = useState("en-US");

  // Candidate Metadata State
  const [candidateName, setCandidateName] = useState("");
  const [appliedRole, setAppliedRole] = useState("");
  const [interviewDate] = useState("09 Sep 2026");

  // Interview Operational State
  const [started, setStarted] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [connected, setConnected] = useState(false);
  const [recording, setRecording] = useState(false);
  const [interviewFinished, setInterviewFinished] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  const [question, setQuestion] = useState("");
  const [questionAudioB64, setQuestionAudioB64] = useState("");
  const [questionAudioMime, setQuestionAudioMime] = useState("audio/mpeg");
  const [questionNumber, setQuestionNumber] = useState(0);
  const [answer, setAnswer] = useState("");
  const [isSpeakingAI, setIsSpeakingAI] = useState(false);
  const [interviewPhase, setInterviewPhase] = useState("IDLE");
  const [showTextAnswer, setShowTextAnswer] = useState(false);
  const [showExitModal, setShowExitModal] = useState(false);
  const [endedEarly, setEndedEarly] = useState(false);

  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [micEnabled, setMicEnabled] = useState(true);
  const [camEnabled, setCamEnabled] = useState(true);
  const [expandedIndex, setExpandedIndex] = useState(0);

  // Scores State
  const [scores, setScores] = useState({
    technical: 0,
    relevance: 0,
    communication: 0,
    video: 0,
    confidence: 0,
    overall: 0,
    resumeMatch: 0,
    problemSolving: 0,
    leadership: 0,
    domainKnowledge: 0,
    integrity: 100,
  });

  const [transcript, setTranscript] = useState([]);
  const [backendTranscript, setBackendTranscript] = useState([]);
  const [feedback, setFeedback] = useState("");
  const [hasScore, setHasScore] = useState(false); 
  const [finalReport, setFinalReport] = useState("");
  const [status, setStatus] = useState("Ready");
  const [error, setError] = useState("");

  // Anti-cheating Proctoring State
  const [cheatWarning, setCheatWarning] = useState("");
  const [cheatStats, setCheatStats] = useState({
    tabSwitches: 0,
    copyEvents: 0,
    pasteEvents: 0,
    fullscreenExits: 0,
    multipleFaces: 0,
  });

  useEffect(() => {
    showTextAnswerRef.current = showTextAnswer;
  }, [showTextAnswer]);

  // Voice Cache Population for Speech Synthesis
  useEffect(() => {
    if (!("speechSynthesis" in window)) return;
    const loadVoices = () => {
      speechVoicesRef.current = window.speechSynthesis.getVoices();
    };
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
    return () => {
      window.speechSynthesis.onvoiceschanged = null;
    };
  }, []);

  // Analytics Calculations
  const videoAnalytics = useMemo(() => computeVideoAnalytics(backendTranscript), [backendTranscript]);
  const voiceAnalytics = useMemo(() => computeVoiceAnalytics(backendTranscript), [backendTranscript]);
  const confidenceTimeline = useMemo(() => computeConfidenceTimeline(backendTranscript), [backendTranscript]);

  // General Cleanup on Unmount
  useEffect(() => {
    return () => {
      cleanupAllMedia();
      if (wsRef.current) wsRef.current.close();
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
      if (finishFallbackTimerRef.current) clearTimeout(finishFallbackTimerRef.current);
      if (cheatWarningTimerRef.current) clearTimeout(cheatWarningTimerRef.current);
      if (fullSessionUrl) URL.revokeObjectURL(fullSessionUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stopSilenceDetection = () => {
    if (silenceIntervalRef.current) {
      clearInterval(silenceIntervalRef.current);
      silenceIntervalRef.current = null;
    }
    if (maxAnswerTimeoutRef.current) {
      clearTimeout(maxAnswerTimeoutRef.current);
      maxAnswerTimeoutRef.current = null;
    }
    if (silenceAudioCtxRef.current) {
      try { silenceAudioCtxRef.current.close(); } catch (_) {}
      silenceAudioCtxRef.current = null;
    }
    silenceStartedAtRef.current = null;
    speechDetectedRef.current = false;
  };

  const cleanupAllMedia = () => {
    stopSpeechRecognition();
    stopVideoFrameCapture();
    stopSilenceDetection();
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      try { mediaRecorderRef.current.stop(); } catch (_) {}
    }
    if (sessionRecorderRef.current && sessionRecorderRef.current.state !== "inactive") {
      try { sessionRecorderRef.current.stop(); } catch (_) {}
    }
    if (sessionAudioCtxRef.current) {
      try { sessionAudioCtxRef.current.close(); } catch (_) {}
      sessionAudioCtxRef.current = null;
      sessionMixDestRef.current = null;
    }
    if (audioRecordingStreamRef.current) {
      audioRecordingStreamRef.current.getTracks().forEach((track) => track.stop());
      audioRecordingStreamRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
  };

  // Timer Tick Interval
  useEffect(() => {
    let interval = null;
    if (started && !interviewFinished) {
      interval = setInterval(() => {
        setElapsedSeconds((prev) => {
          if (prev >= INTERVIEW_MAX_SECONDS - 1) {
            manualExitRef.current = true;
            handleCompleteInterview();
            return INTERVIEW_MAX_SECONDS;
          }
          return prev + 1;
        });
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [started, interviewFinished]);

  // Speech Synthesis Fallbacks & Question Playback
  const speakWithBrowserFallback = (text, onDone) => {
    if (!("speechSynthesis" in window)) {
      onDone();
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = interviewLanguage;
    const availableVoices = speechVoicesRef.current.length
      ? speechVoicesRef.current
      : window.speechSynthesis.getVoices();
    const langPrefix = interviewLanguage.split("-")[0];
    const matchedVoice =
      availableVoices.find((v) => v.lang === interviewLanguage) ||
      availableVoices.find((v) => v.lang && v.lang.startsWith(langPrefix));
    if (matchedVoice) utterance.voice = matchedVoice;
    utterance.onstart = () => {
      setIsSpeakingAI(true);
      interviewPhaseRef.current = "AI_SPEAKING";
      setInterviewPhase("AI_SPEAKING");
      setStatus("AI is speaking...");
    };
    utterance.onend = onDone;
    utterance.onerror = onDone;
    window.speechSynthesis.speak(utterance);
  };

  const speakRepeatWithBrowserFallback = (text) => {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = interviewLanguage;
    const availableVoices = speechVoicesRef.current.length
      ? speechVoicesRef.current
      : window.speechSynthesis.getVoices();
    const langPrefix = interviewLanguage.split("-")[0];
    const matchedVoice =
      availableVoices.find((v) => v.lang === interviewLanguage) ||
      availableVoices.find((v) => v.lang && v.lang.startsWith(langPrefix));
    if (matchedVoice) utterance.voice = matchedVoice;
    utterance.onstart = () => setStatus("Repeating question...");
    utterance.onend = () => setStatus("Listening for your answer...");
    utterance.onerror = () => setStatus("Listening for your answer...");
    window.speechSynthesis.speak(utterance);
  };

  const repeatQuestion = () => {
    if (!question || isSpeakingAI) return;

    if (questionAudioB64 && ttsAudioElRef.current) {
      const audioEl = ttsAudioElRef.current;
      const originalOnPlay = audioEl.onplay;
      const originalOnEnded = audioEl.onended;

      audioEl.onplay = () => setStatus("Repeating question...");
      audioEl.onended = () => {
        audioEl.onplay = originalOnPlay;
        audioEl.onended = originalOnEnded;
        setStatus("Listening for your answer...");
      };

      try {
        audioEl.currentTime = 0;
      } catch (_) {}
      audioEl.play().catch(() => {
        audioEl.onplay = originalOnPlay;
        audioEl.onended = originalOnEnded;
        speakRepeatWithBrowserFallback(question);
      });
    } else {
      speakRepeatWithBrowserFallback(question);
    }
  };

  // Question Reception Handler
  useEffect(() => {
    if (!question || !started || question === lastSpokenQuestionRef.current) return;
    lastSpokenQuestionRef.current = question;

    const proceedToAnswer = () => {
      setIsSpeakingAI(false);
      if (!interviewFinished && !finishRequestedRef.current) {
        interviewPhaseRef.current = "WAITING_FOR_ANSWER";
        setInterviewPhase("WAITING_FOR_ANSWER");
        setStatus("Listening for your answer...");
        if (!showTextAnswerRef.current) {
          startRecording();
        }
      }
    };

    if (questionAudioB64 && ttsAudioElRef.current) {
      const audioEl = ttsAudioElRef.current;
      audioEl.src = `data:${questionAudioMime || "audio/mpeg"};base64,${questionAudioB64}`;
      audioEl.onplay = () => {
        setIsSpeakingAI(true);
        interviewPhaseRef.current = "AI_SPEAKING";
        setInterviewPhase("AI_SPEAKING");
        setStatus("AI is speaking...");
      };
      audioEl.onended = proceedToAnswer;
      audioEl.onerror = () => speakWithBrowserFallback(question, proceedToAnswer);
      audioEl.play().catch(() => speakWithBrowserFallback(question, proceedToAnswer));
    } else {
      speakWithBrowserFallback(question, proceedToAnswer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [question, questionAudioB64, started, interviewFinished]);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript]);

  // Anti-cheating Proctoring Listeners
  useEffect(() => {
    if (!started || interviewFinished) return;

    const handleVisibilityChange = () => {
      if (document.hidden) sendCheatEvent("tab_switch");
    };
    const handleCopy = () => sendCheatEvent("copy_detected");
    const handlePaste = () => sendCheatEvent("paste_detected");
    const handleFullscreenChange = () => {
      if (!document.fullscreenElement) sendCheatEvent("fullscreen_exit");
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    document.addEventListener("copy", handleCopy);
    document.addEventListener("paste", handlePaste);
    document.addEventListener("fullscreenchange", handleFullscreenChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      document.removeEventListener("copy", handleCopy);
      document.removeEventListener("paste", handlePaste);
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, [started, interviewFinished]);

  const toggleMic = () => {
    const nextState = !micEnabled;
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getAudioTracks().forEach((track) => {
        track.enabled = nextState;
      });
    }
    if (audioRecordingStreamRef.current) {
      audioRecordingStreamRef.current.getAudioTracks().forEach((track) => {
        track.enabled = nextState;
      });
    }
    setMicEnabled(nextState);
  };

  const toggleCam = () => {
    const nextState = !camEnabled;
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getVideoTracks().forEach((track) => {
        track.enabled = nextState;
      });
    }
    setCamEnabled(nextState);
  };

  const handleResumeChange = (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      setResumeFile(null);
      return;
    }
    if (file.type !== "application/pdf") {
      setError("Please upload a PDF resume.");
      setResumeFile(null);
      return;
    }
    setError("");
    setResumeFile(file);
    setResumeText("");
  };

  const startCamera = async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("This browser does not support camera/microphone access.");
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1, sampleRate: 48000 },
      });

      const audioTracks = stream.getAudioTracks();
      const videoTracks = stream.getVideoTracks();

      if (!audioTracks.length) {
        stream.getTracks().forEach((track) => track.stop());
        throw new Error("Microphone was not detected.");
      }
      if (!videoTracks.length) {
        stream.getTracks().forEach((track) => track.stop());
        throw new Error("Camera was not detected.");
      }

      audioTracks[0].enabled = true;
      videoTracks[0].enabled = true;

      mediaStreamRef.current = stream;
      setMicEnabled(true);
      setCamEnabled(true);

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.muted = true;
        try { await videoRef.current.play(); } catch (_) {}
      }

      return stream;
    } catch (err) {
      console.warn("Camera/microphone warning:", err);
      return null;
    }
  };

  useEffect(() => {
    if (started && videoRef.current && mediaStreamRef.current && videoRef.current.srcObject !== mediaStreamRef.current) {
      videoRef.current.srcObject = mediaStreamRef.current;
      videoRef.current.play().catch((err) => {
        console.error("⚠️ Camera video element failed to play:", err);
      });
    }
  }, [started]);

  const connectWebSocket = () => {
    return new Promise((resolve, reject) => {
      if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
        try { wsRef.current.close(); } catch (_) {}
      }

      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        setStatus("Backend connected");
        resolve(ws);
      };

      ws.onerror = () => {
        setConnected(false);
        setStatus("Connection error");
        reject(new Error("WebSocket connection failed."));
      };

      ws.onclose = (event) => {
        setConnected(false);
        if (!interviewFinished) {
          setStatus("Disconnected");
        }
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          handleBackendMessage(data);
        } catch (err) {
          console.error("Invalid backend message:", err);
        }
      };
    });
  };

  const acceptQuestion = (rawQuestion, suppliedNumber, audioB64, audioMime) => {
    if (finishRequestedRef.current || interviewFinished) return;
    const nextQuestion = String(rawQuestion || "").trim();
    if (!nextQuestion) return;

    const nextNumber = Number(suppliedNumber) > 0 ? Number(suppliedNumber) : askedQuestionsRef.current.length + 1;
    const alreadyAcceptedThisNumber = nextNumber <= lastAcceptedQuestionNumberRef.current;
    const exactTextDuplicate = askedQuestionsRef.current.some((q) => q.text.trim().toLowerCase() === nextQuestion.toLowerCase());

    if (alreadyAcceptedThisNumber || exactTextDuplicate) return;

    askedQuestionsRef.current.push({ number: nextNumber, text: nextQuestion });
    lastAcceptedQuestionNumberRef.current = nextNumber;
    answerSubmitLockRef.current = false;
    interviewPhaseRef.current = "AI_SPEAKING";
    setInterviewPhase("AI_SPEAKING");
    setQuestion(nextQuestion);
    setQuestionAudioB64(audioB64 || "");
    setQuestionAudioMime(audioMime || "audio/mpeg");
    setQuestionNumber(nextNumber);
    setAnswer("");
    setIsProcessing(false);
    answerFramesRef.current = [];
    setStatus("AI is asking a question");

    setTranscript((prev) => [...prev, { sender: "AI Interviewer", text: nextQuestion }]);
  };

  const handleBackendMessage = (data) => {
    switch (data.type) {
      case "question":
        acceptQuestion(data.question, data.question_number, data.audio_b64, data.audio_mime_type);
        break;
      case "recording_start":
        setRecording(true);
        setIsProcessing(false);
        setStatus("Listening...");
        break;
      case "transcript":
        if (data.text) setAnswer(data.text);
        break;
      case "answer_received":
        setIsProcessing(true);
        interviewPhaseRef.current = "PROCESSING_ANSWER";
        setInterviewPhase("PROCESSING_ANSWER");
        setStatus("Evaluating answer...");
        break;
      case "processing":
        setStatus(
          data.elapsed_seconds
            ? `Still processing your answer... (${data.elapsed_seconds}s)`
            : "Still processing your answer..."
        );
        break;
      case "score_update":
        updateScores(data);
        updateCheatStats(data);
        setHasScore(true);
        if (data.feedback) setFeedback(data.feedback);
        break;
      case "transcript_update":
        if (Array.isArray(data.transcript)) setBackendTranscript(data.transcript);
        break;
      case "answer_result":
        if (data.feedback) setFeedback(data.feedback);
        if (data.scores) {
          updateScores(data.scores);
          updateCheatStats(data.scores);
        } else {
          updateScores(data);
          updateCheatStats(data);
        }
        setHasScore(true);
        if (Array.isArray(data.transcript)) setBackendTranscript(data.transcript);
        setRecording(false);
        setIsProcessing(true);
        interviewPhaseRef.current = "PROCESSING_ANSWER";
        setInterviewPhase("PROCESSING_ANSWER");

        if (lastAcceptedQuestionNumberRef.current >= maxQuestions && !finishRequestedRef.current) {
          finishInterview();
        }
        break;
      case "final_report":
      case "interview_complete":
        setFinalReport(data.report || data.final_report || "");
        if (data.scores) {
          updateScores(data.scores);
          updateCheatStats(data.scores);
        } else {
          updateScores(data);
          updateCheatStats(data);
        }
        finishInterviewLocally();
        break;
      case "cheat_event_ack":
        if (data.counts) updateCheatStats(data.counts);
        break;
      case "ended":
        finishInterviewLocally();
        break;
      case "error":
        answerSubmitLockRef.current = false;
        setError(data.message || "Backend error");
        setRecording(false);
        setIsProcessing(false);
        break;
      default:
        break;
    }
  };

  const finishInterviewLocally = () => {
    if (finishFallbackTimerRef.current) {
      clearTimeout(finishFallbackTimerRef.current);
      finishFallbackTimerRef.current = null;
    }
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    setIsSpeakingAI(false);
    stopVideoFrameCapture();
    stopSilenceDetection();
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      try { mediaRecorderRef.current.stop(); } catch (_) {}
    }
    stopFullSessionRecording();
    if (mediaStreamRef.current) mediaStreamRef.current.getTracks().forEach((track) => track.stop());
    setRecording(false);
    setEndedEarly(manualExitRef.current);
    setInterviewFinished(true);
    if (document.fullscreenElement) {
      const exit =
        document.exitFullscreen ||
        document.webkitExitFullscreen ||
        document.mozCancelFullScreen ||
        document.msExitFullscreen;
      if (exit) {
        try { exit.call(document); } catch (_) {}
      }
    }
  };

  const updateScores = (data = {}) => {
    setScores((previous) => ({
      ...previous,
      technical: safeRound(data.technical ?? data.technical_score, previous.technical),
      relevance: safeRound(data.relevance ?? data.relevance_score, previous.relevance),
      communication: safeRound(data.communication ?? data.communication_score, previous.communication),
      video: safeRound(data.video ?? data.video_score, previous.video),
      confidence: safeRound(data.confidence ?? data.confidence_score, previous.confidence),
      overall: safeRound(data.overall ?? data.overall_score, previous.overall),
      integrity: safeRound(data.integrity_score ?? data.integrity, previous.integrity),
    }));
  };

  const updateCheatStats = (data = {}) => {
    setCheatStats((previous) => ({
      tabSwitches: data.tab_switches ?? previous.tabSwitches,
      copyEvents: data.copy_events ?? previous.copyEvents,
      pasteEvents: data.paste_events ?? previous.pasteEvents,
      fullscreenExits: data.fullscreen_exits ?? previous.fullscreenExits,
      multipleFaces: data.multiple_faces_events ?? previous.multipleFaces,
    }));
  };

  const sendCheatEvent = (type) => {
    if (!started || interviewFinished) return;
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type }));
    }
    const labels = {
      tab_switch: "⚠️ Tab switch detected — please stay on this tab.",
      copy_detected: "⚠️ Copy detected.",
      paste_detected: "⚠️ Paste detected.",
      fullscreen_exit: "⚠️ You exited fullscreen — please return to fullscreen.",
    };
    setCheatWarning(labels[type] || "⚠️ Suspicious activity detected.");
    if (cheatWarningTimerRef.current) clearTimeout(cheatWarningTimerRef.current);
    cheatWarningTimerRef.current = setTimeout(() => setCheatWarning(""), 4000);
  };

  const setupAudioMixGraph = () => {
    const stream = mediaStreamRef.current;
    if (!stream) return;

    if (sessionAudioCtxRef.current) {
      try { sessionAudioCtxRef.current.close(); } catch (_) {}
      sessionAudioCtxRef.current = null;
      sessionMixDestRef.current = null;
    }

    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const audioCtx = new AudioCtx();
      if (audioCtx.state === "suspended") {
        audioCtx.resume().catch(() => {});
      }
      const dest = audioCtx.createMediaStreamDestination();

      const micTrack = stream.getAudioTracks()[0];
      if (micTrack) {
        const micSource = audioCtx.createMediaStreamSource(new MediaStream([micTrack]));
        micSource.connect(dest);
      }

      if (!ttsAudioElRef.current) {
        ttsAudioElRef.current = new Audio();
      }
      const ttsSource = audioCtx.createMediaElementSource(ttsAudioElRef.current);
      ttsSource.connect(dest);
      ttsSource.connect(audioCtx.destination);

      sessionAudioCtxRef.current = audioCtx;
      sessionMixDestRef.current = dest;
    } catch (err) {
      console.warn("⚠️ Could not set up audio mix graph, AI voice won't be in the recording:", err);
    }
  };

  const startFullSessionRecording = () => {
    const stream = mediaStreamRef.current;
    if (!stream) return;

    const videoTracks = stream.getVideoTracks();
    const mixedAudioTracks = sessionMixDestRef.current
      ? sessionMixDestRef.current.stream.getAudioTracks()
      : stream.getAudioTracks();

    const combinedStream = new MediaStream([...videoTracks, ...mixedAudioTracks]);

    const candidates = [
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm",
    ];
    const mimeType = candidates.find((type) => MediaRecorder.isTypeSupported(type)) || "video/webm";

    try {
      sessionChunksRef.current = [];
      const recorder = new MediaRecorder(combinedStream, { mimeType, videoBitsPerSecond: 800000 });
      recorder.ondataavailable = (e) => {
        if (e.data?.size > 0) sessionChunksRef.current.push(e.data);
      };
      recorder.start(1000);
      sessionRecorderRef.current = recorder;
    } catch (err) {
      console.error("⚠️ Could not start full-session recording:", err);
    }
  };

  const stopFullSessionRecording = () => {
    const recorder = sessionRecorderRef.current;
    if (!recorder) return;
    sessionRecorderRef.current = null;

    const finalize = () => {
      try {
        const blob = new Blob(sessionChunksRef.current, { type: recorder.mimeType || "video/webm" });
        if (blob.size > 0) {
          const url = URL.createObjectURL(blob);
          setFullSessionUrl(url);
        }
      } catch (err) {
        console.error("⚠️ Could not finalize full-session recording:", err);
      }
    };

    if (recorder.state !== "inactive") {
      recorder.onstop = finalize;
      try { recorder.stop(); } catch (_) { finalize(); }
    } else {
      finalize();
    }
  };

  const startInterview = async () => {
    if (startingInterviewRef.current || started || isStarting) return;
    startingInterviewRef.current = true;
    setIsStarting(true);

    const stream = await startCamera();

    try {
      const requestFs =
        document.documentElement.requestFullscreen ||
        document.documentElement.webkitRequestFullscreen ||
        document.documentElement.mozRequestFullScreen ||
        document.documentElement.msRequestFullscreen;
      if (requestFs) {
        await requestFs.call(document.documentElement);
      }
    } catch (_) {
      console.warn("Could not enter fullscreen; continuing without it.");
    }

    try {
      setError("");
      askedQuestionsRef.current = [];
      lastAcceptedQuestionNumberRef.current = 0;
      answerSubmitLockRef.current = false;
      finishRequestedRef.current = false;
      manualExitRef.current = false;
      interviewPhaseRef.current = "IDLE";
      setInterviewPhase("IDLE");
      setQuestion("");
      setQuestionNumber(0);
      setTranscript([]);
      setBackendTranscript([]);
      setElapsedSeconds(0);
      setEndedEarly(false);
      setHasScore(false);
      setFeedback("");
      setCheatWarning("");
      setCheatStats({ tabSwitches: 0, copyEvents: 0, pasteEvents: 0, fullscreenExits: 0, multipleFaces: 0 });
      if (fullSessionUrl) URL.revokeObjectURL(fullSessionUrl);
      setFullSessionUrl("");

      let extractedResume = "";
      if (resumeFile) {
        try {
          extractedResume = await uploadResumeApi(resumeFile);
          setResumeText(extractedResume);
        } catch (e) {
          console.warn("Backend resume upload unavailable, proceeding in frontend session mode.");
          extractedResume = "Resume extracted content";
        }
      }

      setStarted(true);

      try {
        const ws = await connectWebSocket();
        const selectedLanguageName =
          INTERVIEW_LANGUAGES.find((l) => l.code === interviewLanguage)?.name || "English";

        ws.send(JSON.stringify({
          type: "start_interview",
          resume_text: extractedResume,
          job_description: jobDescription,
          max_questions: maxQuestions,
          max_duration_seconds: INTERVIEW_MAX_SECONDS,
          language_code: interviewLanguage,
          language_name: selectedLanguageName,
        }));
      } catch (wsErr) {
        console.warn("Backend WebSocket offline, initializing frontend assessment session mode.");
        acceptQuestion(
          "Can you describe how you architect high-performance, maintainable React web applications?",
          1
        );
      }

      startVideoFrameCapture();
      setupAudioMixGraph();
      startFullSessionRecording();
    } catch (err) {
      console.warn("Direct start session:", err);
      setStarted(true);
      acceptQuestion(
        "Can you describe how you architect high-performance, maintainable React web applications?",
        1
      );
    } finally {
      startingInterviewRef.current = false;
      setIsStarting(false);
    }
  };

  const captureVideoFrame = () => {
    if (!videoRef.current) return;
    const video = videoRef.current;
    if (video.videoWidth === 0 || video.videoHeight === 0) return;

    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = Math.round((video.videoHeight / video.videoWidth) * 320);
    const context = canvas.getContext("2d");
    if (!context) return;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const image = canvas.toDataURL("image/jpeg", 0.55).split(",")[1];
    answerFramesRef.current.push(image);
    if (answerFramesRef.current.length > 20) answerFramesRef.current = answerFramesRef.current.slice(-20);

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "video_frame", frame_b64: image }));
    }
  };

  const startVideoFrameCapture = () => {
    if (frameTimerRef.current) clearInterval(frameTimerRef.current);
    frameTimerRef.current = setInterval(captureVideoFrame, 1000);
  };

  const stopVideoFrameCapture = () => {
    if (frameTimerRef.current) {
      clearInterval(frameTimerRef.current);
      frameTimerRef.current = null;
    }
  };

  const startSpeechRecognition = () => {
    const SpeechRecognitionImpl = window.SpeechRecognition || window.webkitSpeechRecognition;
    finalTranscriptRef.current = "";
    if (!SpeechRecognitionImpl) return;

    try {
      const recognition = new SpeechRecognitionImpl();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = interviewLanguage;
      recognition.onresult = (event) => {
        let interim = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const piece = event.results[i][0].transcript;
          if (event.results[i].isFinal) finalTranscriptRef.current = (finalTranscriptRef.current + " " + piece).trim();
          else interim += piece;
        }
        setAnswer((finalTranscriptRef.current + " " + interim).trim());
      };
      recognition.onend = () => {
        if (recognitionRef.current === recognition) {
          try { recognition.start(); } catch (_) {}
        }
      };
      recognitionRef.current = recognition;
      recognition.start();
    } catch (err) {
      recognitionRef.current = null;
    }
  };

  const stopSpeechRecognition = () => {
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    if (recognition) {
      try {
        recognition.onend = null;
        recognition.stop();
      } catch (_) {}
    }
  };

  const startSilenceDetection = (audioStream) => {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const audioCtx = new AudioCtx();
      if (audioCtx.state === "suspended") {
        audioCtx.resume().catch((err) => {
          console.warn("⚠️ Could not resume AudioContext for silence detection:", err);
        });
      }
      const source = audioCtx.createMediaStreamSource(audioStream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      silenceAudioCtxRef.current = audioCtx;
      silenceStartedAtRef.current = null;
      speechDetectedRef.current = false;

      silenceIntervalRef.current = setInterval(() => {
        analyser.getByteFrequencyData(dataArray);
        const avg = dataArray.reduce((sum, v) => sum + v, 0) / dataArray.length;
        const elapsed = Date.now() - recordingStartedAtRef.current;

        if (avg > SILENCE_THRESHOLD) {
          speechDetectedRef.current = true;
          silenceStartedAtRef.current = null;
          return;
        }

        if (!speechDetectedRef.current || elapsed < MIN_ANSWER_DURATION_MS) return;

        if (!silenceStartedAtRef.current) {
          silenceStartedAtRef.current = Date.now();
        } else if (Date.now() - silenceStartedAtRef.current >= SILENCE_DURATION_MS) {
          stopRecording();
        }
      }, 200);

      maxAnswerTimeoutRef.current = setTimeout(() => {
        stopRecording();
      }, MAX_ANSWER_DURATION_MS);
    } catch (err) {
      console.warn("⚠️ Silence detection unavailable, falling back to manual/timeout stop:", err);
    }
  };

  const startRecording = () => {
    if (startingRecordingRef.current || answerSubmitLockRef.current || isProcessing || isSpeakingAI || recording) return;

    startingRecordingRef.current = true;
    const sourceStream = mediaStreamRef.current;
    if (!sourceStream) {
      startingRecordingRef.current = false;
      return;
    }

    const sourceAudioTrack = sourceStream.getAudioTracks()[0];
    let audioStream = new MediaStream([sourceAudioTrack.clone()]);
    audioRecordingStreamRef.current = audioStream;

    chunksRef.current = [];
    answerFramesRef.current = [];

    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm";
    let recorder = new MediaRecorder(audioStream, { mimeType, audioBitsPerSecond: 128000 });
    mediaRecorderRef.current = recorder;
    const questionNumberAtRecordStart = questionNumber;
    recordingStartedAtRef.current = Date.now();

    recorder.ondataavailable = (e) => { if (e.data?.size > 0) chunksRef.current.push(e.data); };
    recorder.onstop = async () => {
      try {
        const blob = new Blob(chunksRef.current, { type: mimeType });
        const base64 = await blobToBase64(blob);
        const frames = [...answerFramesRef.current];
        const spokenText = finalTranscriptRef.current.trim();

        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({
            type: "answer",
            audio_b64: base64,
            text: spokenText,
            frames_b64: frames,
            question_number: questionNumberAtRecordStart,
            audio_mime_type: mimeType,
          }));
        }

        setTranscript((prev) => [...prev, { sender: "Candidate", text: spokenText || "[Voice Answer]" }]);
        setAnswer("");
        finalTranscriptRef.current = "";
        setRecording(false);
        setIsProcessing(true);
      } catch (err) {
        setRecording(false);
        setIsProcessing(false);
      } finally {
        stopSpeechRecognition();
        stopSilenceDetection();
        if (audioRecordingStreamRef.current) {
          audioRecordingStreamRef.current.getTracks().forEach((t) => t.stop());
          audioRecordingStreamRef.current = null;
        }
        mediaRecorderRef.current = null;
      }
    };

    try { recorder.start(250); } catch (err) {
      startingRecordingRef.current = false;
      return;
    }

    startSpeechRecognition();
    startSilenceDetection(audioStream);
    answerSubmitLockRef.current = true;
    setRecording(true);
    setStatus("Listening to your answer...");
    startingRecordingRef.current = false;
  };

  const stopRecording = () => {
    return new Promise((resolve) => {
      const recorder = mediaRecorderRef.current;
      if (!recorder || recorder.state !== "recording") {
        resolve();
        return;
      }
      const originalOnStop = recorder.onstop;
      recorder.onstop = async (e) => {
        if (originalOnStop) await originalOnStop.call(recorder, e);
        resolve();
      };
      stopSpeechRecognition();
      stopSilenceDetection();
      recorder.stop();
    });
  };

  const sendTextAnswer = () => {
    if (answerSubmitLockRef.current || !answer.trim()) return;
    const currentAnswerText = answer.trim();

    answerSubmitLockRef.current = true;
    setIsProcessing(true);

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: "answer",
        audio_b64: "",
        text: currentAnswerText,
        frames_b64: [...answerFramesRef.current],
        question_number: questionNumber,
      }));
    }

    setTranscript((prev) => [...prev, { sender: "Candidate", text: currentAnswerText }]);
    setAnswer("");
  };

  const finishInterview = () => {
    if (finishRequestedRef.current) return;
    finishRequestedRef.current = true;

    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    setIsSpeakingAI(false);
    stopVideoFrameCapture();

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "finish_interview" }));
    } else {
      finishInterviewLocally();
      return;
    }

    finishFallbackTimerRef.current = setTimeout(() => {
      if (!interviewFinished) finishInterviewLocally();
    }, 10000);
  };

  const handleCompleteInterview = async () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      await stopRecording();
    }
    finishInterview();
    setShowExitModal(false);
  };

  const previewDashboard = () => {
    setStarted(true);
    setInterviewFinished(true);
    setAppliedRole(appliedRole || "Senior Frontend Engineer");
    setScores({
      technical: 88,
      relevance: 92,
      communication: 85,
      video: 80,
      confidence: 86,
      overall: 87,
      resumeMatch: 90,
      problemSolving: 85,
      leadership: 82,
      domainKnowledge: 89,
      integrity: 100,
    });
  };

  const resetToSetup = () => {
    setStarted(false);
    setInterviewFinished(false);
    setIsStarting(false);
  };

  // ----------------------------------------------------
  // VIEW 1: Candidate Assessment Setup
  // ----------------------------------------------------
  if (!started) {
    return (
      <AssessmentSetup
        candidateName={candidateName}
        setCandidateName={setCandidateName}
        appliedRole={appliedRole}
        setAppliedRole={setAppliedRole}
        handleResumeChange={handleResumeChange}
        jobDescription={jobDescription}
        setJobDescription={setJobDescription}
        interviewLanguage={interviewLanguage}
        setInterviewLanguage={setInterviewLanguage}
        startInterview={startInterview}
        isStarting={isStarting}
        error={error}
        previewDashboard={previewDashboard}
      />
    );
  }

  // ----------------------------------------------------
  // VIEW 2: Enterprise Recruiter Results Dashboard
  // ----------------------------------------------------
  if (interviewFinished) {
    return (
      <div className="stage-page-shell">
        <main className="stage-main-content" style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          <DashboardHeader 
            candidateName={candidateName || "Candidate"} 
            appliedRole={appliedRole || "Senior Developer"} 
            interviewDate={interviewDate} 
            elapsedSeconds={elapsedSeconds} 
            resetToSetup={resetToSetup}
            finalReport={finalReport}
          />

          <div className="form-row-dual">
            <FullSessionRecordingCard fullSessionUrl={fullSessionUrl} candidateName={candidateName} />
            <SkillMetricsSection scores={scores} />
          </div>

          <AnalyticsSection 
            videoAnalytics={videoAnalytics} 
            voiceAnalytics={voiceAnalytics} 
            confidenceTimeline={confidenceTimeline} 
          />

          <QuestionBreakdown 
            backendTranscript={backendTranscript} 
            expandedIndex={expandedIndex} 
            setExpandedIndex={setExpandedIndex} 
          />

          <ProctoringSummary cheatStats={cheatStats} />
        </main>
      </div>
    );
  }

  // ----------------------------------------------------
  // VIEW 3: Live Assessment Session View (2-Column Stage)
  // ----------------------------------------------------
  return (
    <div className="stage-page-shell">
      <InterviewHeader 
        elapsedSeconds={elapsedSeconds} 
        candidateName={candidateName} 
        appliedRole={appliedRole} 
      />

      <main className="stage-main-content">
        {error && (
          <div className="alert-box alert-error-style" style={{ marginBottom: "1rem" }}>
            {error}
          </div>
        )}
        {cheatWarning && (
          <div className="alert-box alert-warning-style" style={{ marginBottom: "1rem" }}>
            {cheatWarning}
          </div>
        )}

        <div className="interview-grid-layout">
          {/* Left Panel: Video Camera Stage */}
          <div>
            <CandidateFeedSection 
              videoRef={videoRef}
              recording={recording}
              toggleMic={toggleMic}
              toggleCam={toggleCam}
              micEnabled={micEnabled}
              camEnabled={camEnabled}
              stopRecording={stopRecording}
              interviewPhase={interviewPhase}
              showTextAnswer={showTextAnswer}
            />
          </div>

          {/* Right Panel: AI Interview Assistant Persona & Question Card */}
          <div className="assistant-panel-card" style={{ minHeight: "auto" }}>
            <AIAvatarSection 
              isSpeakingAI={isSpeakingAI}
              status={status}
              questionNumber={questionNumber}
              maxQuestions={maxQuestions}
              question={question}
              isProcessing={isProcessing}
              repeatQuestion={repeatQuestion}
              setShowExitModal={setShowExitModal}
              showTextAnswer={showTextAnswer}
              setShowTextAnswer={setShowTextAnswer}
              answer={answer}
              setAnswer={setAnswer}
              sendTextAnswer={sendTextAnswer}
            />
          </div>
        </div>

        {/* Full-Width Bottom Panel: Pure Live Session Transcript History Stream */}
        <TranscriptSection 
          transcript={transcript}
          transcriptEndRef={transcriptEndRef}
        />

        <ExitModal 
          showExitModal={showExitModal}
          setShowExitModal={setShowExitModal}
          handleCompleteInterview={handleCompleteInterview}
        />
      </main>
    </div>
  );
}

export default App;