
import React, { useEffect, useRef, useState, useMemo } from "react";
import { 
  Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, 
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip 
} from "recharts";
import { 
  CheckCircle, AlertTriangle, Download, Share2, Eye, 
  Volume2, ArrowUpRight, ChevronDown, ChevronUp, Briefcase, Clock, Calendar 
} from "lucide-react";
import "./App.css";


const API_URL = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";
const WS_URL = import.meta.env.VITE_WS_URL || "ws://127.0.0.1:8000/ws/interview";

const INTERVIEW_MAX_SECONDS = 600; 
const DEFAULT_MAX_QUESTIONS = 10;

// Coerce a value to a number and round it; only falls back when the value
// is genuinely missing/NaN. Using `Math.round(x) || fallback` is a bug --
// it silently discards real scores of 0.
const safeRound = (val, fallback) => {
  const n = Number(val);
  return Number.isFinite(n) ? Math.round(n) : fallback;
};

function App() {
  const videoRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioRecordingStreamRef = useRef(null);
  const chunksRef = useRef([]);
  const wsRef = useRef(null);

  const answerFramesRef = useRef([]);
  const frameTimerRef = useRef(null);
  const transcriptEndRef = useRef(null);
  const lastSpokenQuestionRef = useRef(""); 
  const askedQuestionsRef = useRef([]); 
  const lastAcceptedQuestionNumberRef = useRef(0);
  const answerSubmitLockRef = useRef(false);
  const interviewPhaseRef = useRef("IDLE");

  const recognitionRef = useRef(null);
  const finalTranscriptRef = useRef("");

  const startingInterviewRef = useRef(false);
  const startingRecordingRef = useRef(false);
  const finishRequestedRef = useRef(false);
  const manualExitRef = useRef(false); 
  const finishFallbackTimerRef = useRef(null); 

  // NEW: anti-cheating warning banner auto-hide timer
  const cheatWarningTimerRef = useRef(null);

  // Setup State
  const [resumeFile, setResumeFile] = useState(null);
  const [resumeText, setResumeText] = useState("");
  const [jobDescription, setJobDescription] = useState("");
  const [maxQuestions, setMaxQuestions] = useState(DEFAULT_MAX_QUESTIONS);

  // Candidate Metadata State
  const [candidateName, setCandidateName] = useState(" ");
  const [appliedRole, setAppliedRole] = useState(" ");
  const [interviewDate] = useState(" ");
  const [interviewDuration] = useState(" ");

  // Interview Running State
  const [started, setStarted] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [connected, setConnected] = useState(false);
  const [recording, setRecording] = useState(false);
  const [interviewFinished, setInterviewFinished] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  const [question, setQuestion] = useState("");
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

  const [expandedIndex, setExpandedIndex] = useState(null);

  // Real backend scores (0-100 scale, sent by /ws/interview "score_update"
  // and "final_report" / "interview_complete" messages). Seed values here
  // are only ever shown before the first real score_update arrives.
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
    integrity: 100, // NEW: anti-cheating integrity score, 0-100
  });
  
  const [transcript, setTranscript] = useState([]);
  const [backendTranscript, setBackendTranscript] = useState([]);

  const [feedback, setFeedback] = useState("");
  const [hasScore, setHasScore] = useState(false); 
  const [finalReport, setFinalReport] = useState("");
  const [status, setStatus] = useState("Ready");
  const [error, setError] = useState("");

  const [recruiterNotes, setRecruiterNotes] = useState("");

  // NEW: anti-cheating state -- live warning banner + running counters,
  // both driven by "score_update" / "final_report" / "interview_complete"
  // backend messages that now also carry proctoring counts.
  const [cheatWarning, setCheatWarning] = useState("");
  const [cheatStats, setCheatStats] = useState({
    tabSwitches: 0,
    copyEvents: 0,
    pasteEvents: 0,
    fullscreenExits: 0,
    multipleFaces: 0,
  });

  const videoAnalytics = useMemo(() => {
    const withVisual = backendTranscript.filter((t) => t.delivery_detail?.visual);
    if (!withVisual.length) return null;
    const avg = (key) => {
      const vals = withVisual
        .map((t) => t.delivery_detail.visual[key])
        .filter((v) => typeof v === "number");
      if (!vals.length) return null;
      return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
    };
    return {
      eyeContact: avg("eye_contact_score"),
      engagement: avg("body_posture_score"),
      expression: avg("facial_expression_score"),
    };
  }, [backendTranscript]);

  const voiceAnalytics = useMemo(() => {
    const withAudio = backendTranscript.filter((t) => t.delivery_detail?.audio);
    if (!withAudio.length) return null;
    const avg = (key) => {
      const vals = withAudio
        .map((t) => t.delivery_detail.audio[key])
        .filter((v) => typeof v === "number");
      if (!vals.length) return null;
      return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
    };
    return {
      fillerWords: avg("filler_words"),
      clarity: avg("clarity") ?? avg("grammar"),
      pace: avg("pace"),
    };
  }, [backendTranscript]);

  // Confidence progression across real answered questions.
  const confidenceTimeline = useMemo(() => {
    return backendTranscript.map((t, i) => ({
      time: `Q${i + 1}`,
      confidence: Math.round((t.confidence_score ?? 0) * 100),
    }));
  }, [backendTranscript]);

  useEffect(() => {
    return () => {
      cleanupAllMedia();
      if (wsRef.current) wsRef.current.close();
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
      if (finishFallbackTimerRef.current) clearTimeout(finishFallbackTimerRef.current);
      if (cheatWarningTimerRef.current) clearTimeout(cheatWarningTimerRef.current);
    };
  }, []);

  const cleanupAllMedia = () => {
    stopSpeechRecognition();
    stopVideoFrameCapture();
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      try { mediaRecorderRef.current.stop(); } catch (_) {}
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

  useEffect(() => {
    if (question && started && question !== lastSpokenQuestionRef.current) {
      lastSpokenQuestionRef.current = question;
      if ("speechSynthesis" in window) {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(question);
        utterance.onstart = () => {
          setIsSpeakingAI(true);
          interviewPhaseRef.current = "AI_SPEAKING";
          setInterviewPhase("AI_SPEAKING");
          setStatus("AI is speaking...");
        };
        utterance.onend = () => {
          setIsSpeakingAI(false);
          if (!interviewFinished && !finishRequestedRef.current) {
            interviewPhaseRef.current = "WAITING_FOR_ANSWER";
            setInterviewPhase("WAITING_FOR_ANSWER");
            setStatus("Your turn — answer the question");
          }
        };
        utterance.onerror = () => {
          setIsSpeakingAI(false);
          if (!interviewFinished && !finishRequestedRef.current) {
            interviewPhaseRef.current = "WAITING_FOR_ANSWER";
            setInterviewPhase("WAITING_FOR_ANSWER");
            setStatus("Your turn — answer the question");
          }
        };
        window.speechSynthesis.speak(utterance);
      }
    }
  }, [question, started, interviewFinished]);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript]);

  // NEW: anti-cheating listeners -- tab switch (Page Visibility API),
  // copy/paste, and fullscreen-exit detection. Active only while the
  // interview is actually running, so it never interferes with the setup
  // screen or the results dashboard. Each detected event is sent to the
  // backend over the existing WebSocket connection; nothing here touches
  // interview flow, scoring, or the UI beyond the warning banner.
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

  const formatTime = (secs) => {
    const mins = Math.floor(secs / 60);
    const remaining = secs % 60;
    return `${mins.toString().padStart(2, "0")}:${remaining.toString().padStart(2, "0")}`;
  };

  const toggleMic = () => {
    if (mediaStreamRef.current) {
      const audioTrack = mediaStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !micEnabled;
        setMicEnabled(!micEnabled);
      }
    }
  };

  const toggleCam = () => {
    if (mediaStreamRef.current) {
      const videoTrack = mediaStreamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !camEnabled;
        setCamEnabled(!camEnabled);
      }
    }
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

  const uploadResume = async () => {
    if (!resumeFile) throw new Error("Please select a PDF resume.");
    setStatus("Extracting resume text...");
    const formData = new FormData();
    formData.append("file", resumeFile);

    const response = await fetch(`${API_URL}/interview/upload-resume`, {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || "Resume upload failed.");
    }

    const data = await response.json();
    const extractedText = data.resume_text || data.text || data.extracted_text || "";
    if (!extractedText.trim()) throw new Error("Backend could not extract text from the PDF.");

    setResumeText(extractedText);
    return extractedText;
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
      console.error("Camera/microphone error:", err);
      let message = err?.message || "Camera and microphone permission is required.";
      setError(message);
      setStatus("Camera/microphone unavailable");
      return null;
    }
  };

  useEffect(() => {
    if (started && videoRef.current && mediaStreamRef.current && videoRef.current.srcObject !== mediaStreamRef.current) {
      videoRef.current.srcObject = mediaStreamRef.current;
      // FIX: `autoPlay` alone isn't reliable across browsers once srcObject
      // is (re)assigned after the element mounts -- if this doesn't
      // actually start playing, videoWidth/videoHeight stay 0 forever and
      // captureVideoFrame() silently no-ops every single call, so no
      // frames ever reach the backend (this is the root cause of "no
      // video delivery data recorded" / vision_agent falling back to a
      // default 50% confidence with current_visual_metrics: None).
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
          setError(`Connection lost (code ${event.code}). Please restart.`);
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

  const acceptQuestion = (rawQuestion, suppliedNumber) => {
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
        acceptQuestion(data.question, data.question_number);
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
        // NEW: backend heartbeat sent every ~8s during a long
        // graph.invoke() (e.g. Whisper transcription can take 40-50s+).
        // Just proves the connection is still alive; also updates status
        // text so a long wait doesn't look stuck. No score/state changes.
        setStatus(
          data.elapsed_seconds
            ? `Still processing your answer... (${data.elapsed_seconds}s)`
            : "Still processing your answer..."
        );
        break;
      case "score_update":
        updateScores(data);
        updateCheatStats(data); // NEW
        setHasScore(true);
        if (data.feedback) setFeedback(data.feedback);
        break;
      case "transcript_update":
        // Real backend QAItem transcript -- source of truth for the
        // question breakdown table and derived analytics.
        if (Array.isArray(data.transcript)) setBackendTranscript(data.transcript);
        break;
      case "answer_result":
        if (data.feedback) setFeedback(data.feedback);
        if (data.scores) {
          updateScores(data.scores);
          updateCheatStats(data.scores); // NEW
        } else {
          updateScores(data);
          updateCheatStats(data); // NEW
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
          updateCheatStats(data.scores); // NEW
        } else {
          updateScores(data);
          updateCheatStats(data); // NEW
        }
        finishInterviewLocally();
        break;
      case "cheat_event_ack":
        // NEW: lightweight ack from the backend after a proctoring event;
        // score_update / final messages remain the source of truth for the
        // dashboard, this just keeps the running counters fresh sooner.
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
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      try { mediaRecorderRef.current.stop(); } catch (_) {}
    }
    if (mediaStreamRef.current) mediaStreamRef.current.getTracks().forEach((track) => track.stop());
    setRecording(false);
    setEndedEarly(manualExitRef.current);
    // Mark finished BEFORE leaving fullscreen so our own programmatic exit
    // isn't picked up by the fullscreenchange listener as a cheat event.
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
      integrity: safeRound(data.integrity_score ?? data.integrity, previous.integrity), // NEW
    }));
  };

  // NEW: mirrors updateScores for the proctoring counters -- reads
  // whichever shape the backend message happens to carry them in
  // (score_update / cheat_event_ack use snake_case keys directly).
  const updateCheatStats = (data = {}) => {
    setCheatStats((previous) => ({
      tabSwitches: data.tab_switches ?? previous.tabSwitches,
      copyEvents: data.copy_events ?? previous.copyEvents,
      pasteEvents: data.paste_events ?? previous.pasteEvents,
      fullscreenExits: data.fullscreen_exits ?? previous.fullscreenExits,
      multipleFaces: data.multiple_faces_events ?? previous.multipleFaces,
    }));
  };

  // NEW: sends a proctoring event to the backend over the existing
  // WebSocket connection and flashes a short on-screen warning. Never
  // touches interview flow/state beyond the warning banner + counters.
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

  const startInterview = async () => {
    if (startingInterviewRef.current || started || isStarting) return;
    startingInterviewRef.current = true;
    setIsStarting(true);

    // FIX: startCamera() -- specifically the video.play() call inside it --
    // used to run AFTER requestFullscreen() and AFTER uploadResume() (a
    // network round-trip). On mobile Safari/Chrome, <video>.play() must
    // fire very close to the actual tap or it's silently blocked as
    // "autoplay" once the gesture window has lapsed. A fullscreen request
    // + a PDF-parsing network call was easily enough delay to lose that
    // window every time, so on mobile video.play() failed silently,
    // videoWidth/videoHeight stayed 0 forever, and captureVideoFrame()'s
    // own early-return for that case meant NO frames ever left the phone
    // -- nothing (single-face, multi-face, everything) could detect.
    // Desktop browsers are much more lenient here, which is why this only
    // showed up on mobile. Camera/mic now start FIRST, as close to the
    // raw tap as possible; fullscreen and resume upload happen after.
    const stream = await startCamera();
    if (!stream) {
      setError(error || "Could not access camera/microphone.");
      startingInterviewRef.current = false;
      setIsStarting(false);
      return;
    }

    // NEW: request fullscreen immediately, while still inside the click
    // handler's user-gesture context, so browsers don't silently block it.
    // Not fatal if it fails -- the interview still runs, just without the
    // fullscreen-exit signal until/unless the user enters fullscreen later.
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
      setCheatWarning(""); // NEW
      setCheatStats({ tabSwitches: 0, copyEvents: 0, pasteEvents: 0, fullscreenExits: 0, multipleFaces: 0 }); // NEW

      if (!resumeFile) throw new Error("Please upload your resume PDF.");
      if (!jobDescription.trim()) throw new Error("Please enter the job description.");

      const extractedResume = await uploadResume();

      // FIX: on mobile, video.play() resolving successfully doesn't
      // always mean the element is actually decoding frames yet -- give
      // it a brief moment and retry play() once if videoWidth/videoHeight
      // are still 0, instead of silently capturing nothing for the whole
      // interview.
      if (videoRef.current && (videoRef.current.videoWidth === 0 || videoRef.current.videoHeight === 0)) {
        await new Promise((resolve) => setTimeout(resolve, 400));
        if (videoRef.current && videoRef.current.videoWidth === 0) {
          try { await videoRef.current.play(); } catch (_) {}
        }
      }

      const ws = await connectWebSocket();
      ws.send(JSON.stringify({
        type: "start_interview",
        resume_text: extractedResume,
        job_description: jobDescription,
        max_questions: maxQuestions,
        max_duration_seconds: INTERVIEW_MAX_SECONDS,
      }));

      setStarted(true);
      startVideoFrameCapture();
    } catch (err) {
      setError(err.message || "Could not start interview.");
      cleanupAllMedia();
      if (wsRef.current) try { wsRef.current.close(); } catch (_) {}
    } finally {
      startingInterviewRef.current = false;
      setIsStarting(false);
    }
  };

  const captureVideoFrame = () => {
    if (!videoRef.current) {
      console.warn("⚠️ captureVideoFrame: videoRef not mounted yet, skipping frame");
      return;
    }
    const video = videoRef.current;
    if (video.videoWidth === 0 || video.videoHeight === 0) {
      // FIX: this used to fail silently, which is why "no frames reaching
      // the backend" was invisible from the browser console. If this logs
      // repeatedly, the video element never actually started playing (see
      // the play() fix in the srcObject-assignment useEffect above).
      console.warn("⚠️ captureVideoFrame: video has no dimensions yet (not playing?), skipping frame");
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = Math.round((video.videoHeight / video.videoWidth) * 320);
    const context = canvas.getContext("2d");
    if (!context) return;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const image = canvas.toDataURL("image/jpeg", 0.55).split(",")[1];
    answerFramesRef.current.push(image);
    if (answerFramesRef.current.length > 20) answerFramesRef.current = answerFramesRef.current.slice(-20);

    // FIX: the backend accumulates frames server-side into
    // video_frames[session_id] from individual {"type": "video_frame",
    // "frame_b64": ...} messages -- it does NOT read the frames_b64 array
    // bundled into the final "answer" message. Without sending this,
    // video_frames[session_id] stays empty for the whole session no
    // matter how well frame capture works client-side, which is why
    // vision_agent always fell back to its "no frames" default (confidence
    // 50%, current_visual_metrics: None) and the report showed "No video
    // delivery data was recorded for this session."
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
      recognition.lang = "en-US";
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

  const startRecording = () => {
    if (startingRecordingRef.current || answerSubmitLockRef.current || isProcessing || isSpeakingAI || recording) return;
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      setError("Backend connection is not active.");
      return;
    }

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
    let recorder = new MediaRecorder(audioStream, { mimeType });
    mediaRecorderRef.current = recorder;
    const questionNumberAtRecordStart = questionNumber;

    recorder.ondataavailable = (e) => { if (e.data?.size > 0) chunksRef.current.push(e.data); };
    recorder.onstop = async () => {
      try {
        const blob = new Blob(chunksRef.current, { type: mimeType });
        const base64 = await blobToBase64(blob);
        const frames = [...answerFramesRef.current];
        const spokenText = finalTranscriptRef.current.trim();

        wsRef.current.send(JSON.stringify({
          type: "answer",
          audio_b64: base64,
          text: spokenText,
          frames_b64: frames,
          question_number: questionNumberAtRecordStart,
          audio_mime_type: mimeType,
        }));

        setTranscript((prev) => [...prev, { sender: "Candidate", text: spokenText || "[Voice Answer]" }]);
        setAnswer("");
        finalTranscriptRef.current = "";
        setRecording(false);
        setIsProcessing(true);
      } catch (err) {
        setError("Could not send voice answer.");
        setRecording(false);
        setIsProcessing(false);
      } finally {
        stopSpeechRecognition();
        if (audioRecordingStreamRef.current) {
          audioRecordingStreamRef.current.getTracks().forEach((t) => t.stop());
          audioRecordingStreamRef.current = null;
        }
        mediaRecorderRef.current = null;
      }
    };

    try { recorder.start(250); } catch (err) {
      startingRecordingRef.current = false;
      setError("Recorder failed to start.");
      return;
    }

    startSpeechRecognition();
    answerSubmitLockRef.current = true;
    setRecording(true);
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
      recorder.stop();
    });
  };

  const sendTextAnswer = () => {
    if (answerSubmitLockRef.current || !answer.trim()) return;
    const currentAnswerText = answer.trim();
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    answerSubmitLockRef.current = true;
    setIsProcessing(true);

    wsRef.current.send(JSON.stringify({
      type: "answer",
      audio_b64: "",
      text: currentAnswerText,
      frames_b64: [...answerFramesRef.current],
      question_number: questionNumber,
    }));

    setTranscript((prev) => [...prev, { sender: "Candidate", text: currentAnswerText }]);
    setAnswer("");
  };

  const blobToBase64 = (blob) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result.split(",")[1]);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
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

  // --- RENDER VIEWS ---

  if (!started) {
    return (
      <div className="app-root flex-center">
        <div className="card setup-card animate-fade-in">
          <div className="setup-header">
            <h1 className="title-gradient">⚡  AI Mock Interview </h1>
            <span className="badge badge-indigo">SECURE RECRUITER PORTAL</span>
          </div>

          {error && <div className="alert alert-error">{error}</div>}

          <div className="form-group-container">
            <div className="input-group">
              <label className="input-label">Candidate Name</label>
              <input 
                type="text" 
                value={candidateName} 
                onChange={(e) => setCandidateName(e.target.value)} 
                className="input-field" 
              />
            </div>
            <div className="input-group">
              <label className="input-label">Target Job Title</label>
              <input 
                type="text" 
                value={appliedRole} 
                onChange={(e) => setAppliedRole(e.target.value)} 
                className="input-field" 
              />
            </div>
            <div className="input-group">
              <label className="input-label">Upload PDF Resume</label>
              <input 
                type="file" 
                accept="application/pdf" 
                onChange={handleResumeChange} 
                disabled={isStarting}
                className="file-input"
              />
            </div>
            <div className="input-group">
              <label className="input-label">Job Description Requirements</label>
              <textarea 
                rows={4} 
                placeholder="Paste role requirements..." 
                value={jobDescription} 
                onChange={(e) => setJobDescription(e.target.value)} 
                className="input-field textarea-field"
              />
            </div>
            <div className="input-group">
              <label className="input-label">Questions Count</label>
              <input 
                type="number" 
                min={1} 
                max={20} 
                value={maxQuestions} 
                onChange={(e) => setMaxQuestions(Math.max(1, Number(e.target.value) || 1))} 
                className="input-field"
              />
            </div>

            <button 
              onClick={startInterview} 
              disabled={isStarting} 
              className="btn btn-primary btn-full mt-4"
            >
              {isStarting ? `Initializing Session...` : "Launch Assessment Session"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // --- ENTERPRISE RECRUITER RESULTS DASHBOARD ---
  if (interviewFinished) {
    const radarData = [
      { subject: 'Technical', A: scores.technical, fullMark: 100 },
      { subject: 'Communication', A: scores.communication, fullMark: 100 },
      { subject: 'Relevance', A: scores.relevance, fullMark: 100 },
      { subject: 'Confidence', A: scores.confidence, fullMark: 100 },
      { subject: 'Delivery', A: scores.video, fullMark: 100 },
    ];

    return (
      <div className="dashboard-container animate-fade-in">
        
        {/* Top Header */}
        <div className="card dashboard-header">
          <div className="header-info">
            <div className="flex-row-center gap-3">
              <h1 className="text-2xl font-bold text-white">{candidateName}</h1>
              <span className="badge badge-emerald flex-row-center gap-1">
                <CheckCircle size={14} /> Completed & Verified
              </span>
            </div>
            <div className="meta-info-row">
              <span className="flex-row-center gap-1.5"><Briefcase size={15} /> {appliedRole}</span>
              <span className="flex-row-center gap-1.5"><Calendar size={15} /> {interviewDate}</span>
              <span className="flex-row-center gap-1.5"><Clock size={15} /> {formatTime(elapsedSeconds)}</span>
            </div>
          </div>
          <div className="header-actions">
           
  
             <button onClick={() => window.print()} className="btn btn-primary flex-row-center gap-2">
              <Download size={16} /> Download Full Report
            </button>
          </div>
        </div>

        {/* KPI Cards Grid */}
        <div className="kpi-grid">
          <div className="card kpi-card">
            <div className="kpi-title">Overall Score</div>
            <div className="kpi-flex">
              <span className="kpi-value">{scores.overall}</span>
            </div>
            <div className="progress-track">
              <div className="progress-fill bg-indigo" style={{ width: `${scores.overall}%` }}></div>
            </div>
          </div>

          <div className="card kpi-card">
            <div className="kpi-title">Relevance Score</div>
            <div className="kpi-flex">
              <span className="kpi-value">{scores.relevance}%</span>
            </div>
            <div className="progress-track">
              <div className="progress-fill bg-emerald" style={{ width: `${scores.relevance}%` }}></div>
            </div>
          </div>

          <div className="card kpi-card">
            <div className="kpi-title">Communication Score</div>
            <div className="kpi-flex">
              <span className="kpi-value">{scores.communication}%</span>
            </div>
            <div className="progress-track">
              <div className="progress-fill bg-indigo" style={{ width: `${scores.communication}%` }}></div>
            </div>
          </div>

          <div className="card kpi-card">
            <div className="kpi-title">Technical Score</div>
            <div className="kpi-flex">
              <span className="kpi-value">{scores.technical}%</span>
            </div>
            <div className="progress-track">
              <div className="progress-fill bg-amber" style={{ width: `${scores.technical}%` }}></div>
            </div>
          </div>

          {/* NEW: Integrity / anti-cheating KPI card */}
          <div className="card kpi-card">
            <div className="kpi-title">Integrity Score</div>
            <div className="kpi-flex">
              <span className="kpi-value">{scores.integrity}</span>
            </div>
            <div className="progress-track">
              <div
                className={scores.integrity >= 80 ? "progress-fill bg-emerald" : "progress-fill bg-amber"}
                style={{ width: `${scores.integrity}%` }}
              ></div>
            </div>
          </div>
        </div>

        {/* AI Recommendation Banner */}
        <div className="card banner-card">
          <div className="space-y-2">
            <p className="banner-text">
              {finalReport || "No final report was returned by the backend for this session."}
            </p>
          </div>
        </div>

        {/* Skills Assessment & Radar Section */}
        <div className="grid-2-cols">
          <div className="card flex flex-col items-center justify-center">
            <h3 className="section-title w-full mb-4">Competency Radar Map</h3>
            <div className="w-full h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart cx="50%" cy="50%" outerRadius="80%" data={radarData}>
                  <PolarGrid stroke="#334155" />
                  <PolarAngleAxis dataKey="subject" stroke="#94a3b8" tick={{ fill: '#94a3b8', fontSize: 12 }} />
                  <PolarRadiusAxis angle={30} domain={[0, 100]} stroke="#334155" />
                  <Radar name="Candidate" dataKey="A" stroke="#6366f1" fill="#6366f1" fillOpacity={0.4} />
                </RadarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="card space-y-4">
            <h3 className="section-title mb-2">Core Skill Metrics</h3>
            {[
              { label: "Technical Knowledge", val: scores.technical },
              { label: "Communication Clarity", val: scores.communication },
              { label: "Relevance", val: scores.relevance },
              { label: "Confidence", val: scores.confidence },
              { label: "Delivery (video/audio)", val: scores.video },
            ].map((skill, i) => (
              <div key={i} className="skill-bar-wrapper">
                <div className="skill-bar-label">
                  <span>{skill.label}</span>
                  <span>{skill.val}/100</span>
                </div>
                <div className="progress-track">
                  <div className="progress-fill bg-indigo" style={{ width: `${skill.val}%` }}></div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Video & Voice Analytics Section */}
        <div className="grid-2-cols">
          {/* Video Analytics */}
          <div className="card space-y-6">
            <div className="flex-between">
              <h3 className="section-title flex-row-center gap-2"><Eye size={20} className="text-indigo-400" /> Video & Behavioral Analytics</h3>
              <span className="badge badge-indigo">From recorded frames</span>
            </div>

            {videoAnalytics ? (
              <>
                <div className="grid-3-cols">
                  <div className="analytics-box">
                    <div className="analytics-label">Eye Contact</div>
                    <div className="analytics-val">{videoAnalytics.eyeContact ?? "--"}%</div>
                  </div>
                  <div className="analytics-box">
                    <div className="analytics-label">Posture / Engagement</div>
                    <div className="analytics-val">{videoAnalytics.engagement ?? "--"}%</div>
                  </div>
                  <div className="analytics-box">
                    <div className="analytics-label">Expression</div>
                    <div className="analytics-val">{videoAnalytics.expression ?? "--"}%</div>
                  </div>
                </div>

                <div>
                  <div className="input-label mb-2">Confidence Progression Timeline</div>
                  <div className="h-[140px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={confidenceTimeline}>
                        <XAxis dataKey="time" stroke="#94a3b8" fontSize={10} />
                        <YAxis domain={[0, 100]} stroke="#94a3b8" fontSize={10} />
                        <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px' }} />
                        <Line type="monotone" dataKey="confidence" stroke="#6366f1" strokeWidth={3} dot={{ fill: '#6366f1' }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </>
            ) : (
              <p className="text-sm text-slate-400">No video delivery data was recorded for this session.</p>
            )}
          </div>

          {/* Voice Analytics */}
          <div className="card space-y-6">
            <div className="flex-between">
              <h3 className="section-title flex-row-center gap-2"><Volume2 size={20} className="text-indigo-400" /> Voice & Speech Analytics</h3>
              <span className="badge badge-indigo">From recorded audio</span>
            </div>

            {voiceAnalytics ? (
              <div className="grid-3-cols">
                <div className="analytics-box">
                  <div className="analytics-label">Filler Words</div>
                  <div className="analytics-val text-amber">{voiceAnalytics.fillerWords ?? "--"}</div>
                </div>
                <div className="analytics-box">
                  <div className="analytics-label">Clarity Score</div>
                  <div className="analytics-val">{voiceAnalytics.clarity ?? "--"}%</div>
                </div>
                <div className="analytics-box">
                  <div className="analytics-label">Pace</div>
                  <div className="analytics-val">{voiceAnalytics.pace ?? "--"}</div>
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-400">No audio delivery data was recorded for this session.</p>
            )}
          </div>
        </div>

        {/* Question by Question Table -- real backend transcript */}
        <div className="card space-y-4">
          <h3 className="section-title">Question Breakdown & Evaluation</h3>
          <div className="space-y-3">
            {backendTranscript.length === 0 && (
              <p className="text-sm text-slate-400">No completed answers were recorded for this session.</p>
            )}
            {backendTranscript.map((q, idx) => {
              const contentAvg = Math.round(
                (((q.eval_score ?? 0) + (q.relevance_score ?? 0) + (q.communication_score ?? 0)) / 3) * 10
              );
              return (
                <div key={idx} className="accordion-item">
                  <div
                    onClick={() => setExpandedIndex(expandedIndex === idx ? null : idx)}
                    className="accordion-header flex-between"
                  >
                    <div className="flex-row-center gap-3">
                      <span className="badge badge-indigo">Q{idx + 1}</span>
                      <span className="text-sm font-medium text-white">{q.question}</span>
                      {q.multiple_faces_detected && (
                        <span className="badge badge-amber flex-row-center gap-1">
                          <AlertTriangle size={12} /> Multiple faces
                        </span>
                      )}
                    </div>
                    <div className="flex-row-center gap-4">
                      <span className="badge badge-emerald">Score: {contentAvg}/100</span>
                      {expandedIndex === idx ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </div>
                  </div>
                  {expandedIndex === idx && (
                    <div className="accordion-body space-y-3">
                      <div className="grid grid-cols-3 gap-2 text-xs text-slate-400">
                        <div>Technical: {q.eval_score ?? 0}/10</div>
                        <div>Relevance: {q.relevance_score ?? 0}/10</div>
                        <div>Communication: {q.communication_score ?? 0}/10</div>
                      </div>
                      {(q.visual_score > 0 || q.audio_delivery_score > 0) && (
                        <div className="grid grid-cols-2 gap-2 text-xs text-slate-400">
                          {q.visual_score > 0 && <div>Visual delivery: {q.visual_score.toFixed(0)}/100</div>}
                          {q.audio_delivery_score > 0 && <div>Audio delivery: {q.audio_delivery_score.toFixed(0)}/100</div>}
                        </div>
                      )}
                      <div>
                        <strong className="text-slate-400 uppercase text-xs block mb-1">AI Feedback & Analysis:</strong>
                        <p>{q.feedback || "No feedback recorded for this answer."}</p>
                      </div>
                      <div>
                        <strong className="text-slate-400 uppercase text-xs block mb-1">Candidate Answer:</strong>
                        <p className="text-slate-300">{q.answer || "(no answer text captured)"}</p>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* NEW: Proctoring / anti-cheating summary */}
        <div className="card space-y-3">
          <h3 className="section-title">Proctoring Summary</h3>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm text-slate-300">
            <div>Tab switches: <strong>{cheatStats.tabSwitches}</strong></div>
            <div>Copy events: <strong>{cheatStats.copyEvents}</strong></div>
            <div>Paste events: <strong>{cheatStats.pasteEvents}</strong></div>
            <div>Fullscreen exits: <strong>{cheatStats.fullscreenExits}</strong></div>
            <div>Multiple faces flagged: <strong>{cheatStats.multipleFaces}</strong></div>
          </div>
        </div>

      </div>
    );
  }

  // --- LIVE INTERVIEW SESSION VIEW ---
  return (
    <div className="dashboard-container animate-fade-in">
      <div className="card flex-between p-4">
        <div className="flex-row-center gap-3">
          <span className="font-bold text-white text-lg">AI Candidate Evaluation Portal</span>
          <span className="badge badge-indigo">LIVE SESSION</span>
        </div>
        <div className="timer-badge">
          ⏱️ {formatTime(elapsedSeconds)} / {formatTime(INTERVIEW_MAX_SECONDS)}
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {/* NEW: anti-cheating warning banner, auto-hides after a few seconds */}
      {cheatWarning && <div className="alert alert-warning">{cheatWarning}</div>}

      <div className="grid-2-cols">
        <div className="card flex flex-col justify-between space-y-6">
          <div className="flex-between">
            <h3 className="font-bold text-white">AI Interviewer</h3>
            <span className="status-indicator">
              <span className={`dot ${isSpeakingAI ? 'bg-indigo animate-pulse' : 'bg-emerald'}`}></span>
              {isSpeakingAI ? "AI Speaking..." : status}
            </span>
          </div>

          <div className="flex-center py-10">
            <div className={`ai-avatar ${isSpeakingAI ? 'animate-bounce' : ''}`}>
              🤖
            </div>
          </div>

          <div className="question-box">
            <div className="text-xs font-bold text-indigo-400 uppercase">Question {questionNumber || 1} of {maxQuestions}</div>
            <div className="text-base font-medium text-white leading-relaxed mt-1">
              {isProcessing ? "Evaluating response..." : question || "Initializing first question..."}
            </div>
          </div>
        </div>

        <div className="card flex flex-col justify-between space-y-6">
          <div className="flex-between">
            <h3 className="font-bold text-white">Candidate Camera Feed</h3>
            <span className="status-indicator">
              <span className={`dot ${recording ? 'bg-red animate-ping' : 'bg-slate'}`}></span>
              {recording ? "Recording Active" : "Standby"}
            </span>
          </div>

          <div className="video-container">
            <video ref={videoRef} autoPlay playsInline muted className="video-feed" />
            {recording && (
              <div className="rec-badge flex-row-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-white animate-pulse"></span> REC
              </div>
            )}
          </div>

          <div className="flex-between pt-2">
            <div className="flex-row-center gap-2">
              <button onClick={toggleMic} className="btn btn-secondary text-xs">
                {micEnabled ? "🎙️ Mute" : "🔇 Unmute"}
              </button>
              <button onClick={toggleCam} className="btn btn-secondary text-xs">
                {camEnabled ? "📹 Disable Cam" : "📷 Enable Cam"}
              </button>
            </div>

            {!recording ? (
              <button 
                onClick={startRecording} 
                disabled={isProcessing || isSpeakingAI || interviewPhase !== "WAITING_FOR_ANSWER"}
                className="btn btn-primary flex-row-center gap-2"
              >
                🎙️ Start Voice Answer
              </button>
            ) : (
              <button 
                onClick={stopRecording}
                className="btn btn-danger flex-row-center gap-2"
              >
                ⏹️ Stop & Submit Voice
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="card space-y-4">
        <div className="flex-between">
          <h3 className="font-bold text-white">Live Conversation Transcript</h3>
          <button onClick={() => setShowTextAnswer(!showTextAnswer)} className="btn btn-secondary text-xs">
            {showTextAnswer ? "Hide Text Mode" : "✏️ Type Response Instead"}
          </button>
        </div>

        {showTextAnswer && (
          <div className="space-y-3 pt-2">
            <textarea 
              rows={3} 
              placeholder="Type your response here..." 
              value={answer} 
              onChange={(e) => setAnswer(e.target.value)} 
              className="input-field textarea-field"
            />
            <button onClick={sendTextAnswer} className="btn btn-primary text-xs">
              Submit Text Answer
            </button>
          </div>
        )}

        <div className="transcript-box space-y-3">
          {transcript.map((msg, idx) => (
            <div key={idx} className={`transcript-bubble ${msg.sender === "AI Interviewer" ? 'ai-bubble' : 'candidate-bubble'}`}>
              <div className="text-[10px] font-bold text-slate-400 uppercase mb-1">{msg.sender}</div>
              <div>{msg.text}</div>
            </div>
          ))}
          <div ref={transcriptEndRef} />
        </div>

        <div className="flex justify-end pt-2">
          <button onClick={() => setShowExitModal(true)} className="btn btn-danger text-xs">
            Finish Interview Early
          </button>
        </div>
      </div>

      {showExitModal && (
        <div className="modal-backdrop flex-center">
          <div className="card modal-card space-y-4">
            <h3 className="text-lg font-bold text-white">End Interview Early?</h3>
            <p className="text-sm text-slate-400">Your performance report will be generated immediately based on the completed questions.</p>
            <div className="flex justify-end gap-3 pt-2">
              <button onClick={() => setShowExitModal(false)} className="btn btn-secondary text-xs">
                Continue Interview
              </button>
              <button onClick={handleCompleteInterview} className="btn btn-danger text-xs">
                Finish & View Results
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;














// import React, { useEffect, useRef, useState, useMemo } from "react";
// import { 
//   Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, 
//   ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip 
// } from "recharts";
// import { 
//   CheckCircle, AlertTriangle, Download, Share2, Eye, 
//   Volume2, ArrowUpRight, ChevronDown, ChevronUp, Briefcase, Clock, Calendar 
// } from "lucide-react";
// import "./App.css";


// const API_URL = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";
// const WS_URL = import.meta.env.VITE_WS_URL || "ws://127.0.0.1:8000/ws/interview";

// const INTERVIEW_MAX_SECONDS = 600; 
// const DEFAULT_MAX_QUESTIONS = 10;

// // NEW: minimum recording duration (ms) before we'll actually send an
// // answer to the backend. Sub-second clips are a major trigger for Whisper
// // hallucinating unrelated-language tokens (e.g. random Chinese characters
// // mixed into an English transcript) instead of failing cleanly -- better
// // to ask the candidate to re-record than send near-silent audio to the
// // backend and have it silently scored as a 0.
// const MIN_RECORDING_MS = 800;

// // Coerce a value to a number and round it; only falls back when the value
// // is genuinely missing/NaN. Using `Math.round(x) || fallback` is a bug --
// // it silently discards real scores of 0.
// const safeRound = (val, fallback) => {
//   const n = Number(val);
//   return Number.isFinite(n) ? Math.round(n) : fallback;
// };

// function App() {
//   const videoRef = useRef(null);
//   const mediaStreamRef = useRef(null);
//   const mediaRecorderRef = useRef(null);
//   const audioRecordingStreamRef = useRef(null);
//   const chunksRef = useRef([]);
//   const wsRef = useRef(null);

//   const answerFramesRef = useRef([]);
//   const frameTimerRef = useRef(null);
//   const transcriptEndRef = useRef(null);
//   const lastSpokenQuestionRef = useRef(""); 
//   const askedQuestionsRef = useRef([]); 
//   const lastAcceptedQuestionNumberRef = useRef(0);
//   const answerSubmitLockRef = useRef(false);
//   const interviewPhaseRef = useRef("IDLE");

//   const recognitionRef = useRef(null);
//   const finalTranscriptRef = useRef("");

//   const startingInterviewRef = useRef(false);
//   const startingRecordingRef = useRef(false);
//   const finishRequestedRef = useRef(false);
//   const manualExitRef = useRef(false); 
//   const finishFallbackTimerRef = useRef(null); 

//   // NEW: anti-cheating warning banner auto-hide timer
//   const cheatWarningTimerRef = useRef(null);

//   // NEW: timestamp of when the current recording actually started, used
//   // to reject/ warn on too-short recordings before sending them.
//   const recordStartTimeRef = useRef(0);

//   // Setup State
//   const [resumeFile, setResumeFile] = useState(null);
//   const [resumeText, setResumeText] = useState("");
//   const [jobDescription, setJobDescription] = useState("");
//   const [maxQuestions, setMaxQuestions] = useState(DEFAULT_MAX_QUESTIONS);

//   // Candidate Metadata State
//   const [candidateName, setCandidateName] = useState(" ");
//   const [appliedRole, setAppliedRole] = useState(" ");
//   const [interviewDate] = useState(" ");
//   const [interviewDuration] = useState(" ");

//   // Interview Running State
//   const [started, setStarted] = useState(false);
//   const [isStarting, setIsStarting] = useState(false);
//   const [connected, setConnected] = useState(false);
//   const [recording, setRecording] = useState(false);
//   const [interviewFinished, setInterviewFinished] = useState(false);
//   const [isProcessing, setIsProcessing] = useState(false);

//   const [question, setQuestion] = useState("");
//   const [questionNumber, setQuestionNumber] = useState(0);
//   const [answer, setAnswer] = useState("");
//   const [isSpeakingAI, setIsSpeakingAI] = useState(false);
//   const [interviewPhase, setInterviewPhase] = useState("IDLE");
//   const [showTextAnswer, setShowTextAnswer] = useState(false);
//   const [showExitModal, setShowExitModal] = useState(false);
//   const [endedEarly, setEndedEarly] = useState(false);

//   const [elapsedSeconds, setElapsedSeconds] = useState(0);

//   const [micEnabled, setMicEnabled] = useState(true);
//   const [camEnabled, setCamEnabled] = useState(true);

//   const [expandedIndex, setExpandedIndex] = useState(null);

//   // Real backend scores (0-100 scale, sent by /ws/interview "score_update"
//   // and "final_report" / "interview_complete" messages). Seed values here
//   // are only ever shown before the first real score_update arrives.
//   const [scores, setScores] = useState({
//     technical: 0,
//     relevance: 0,
//     communication: 0,
//     video: 0,
//     confidence: 0,
//     overall: 0,
//     resumeMatch: 0,
//     problemSolving: 0,
//     leadership: 0,
//     domainKnowledge: 0,
//     integrity: 100, // NEW: anti-cheating integrity score, 0-100
//   });
  
//   const [transcript, setTranscript] = useState([]);
//   const [backendTranscript, setBackendTranscript] = useState([]);

//   const [feedback, setFeedback] = useState("");
//   const [hasScore, setHasScore] = useState(false); 
//   const [finalReport, setFinalReport] = useState("");
//   const [status, setStatus] = useState("Ready");
//   const [error, setError] = useState("");

//   const [recruiterNotes, setRecruiterNotes] = useState("");

//   // NEW: anti-cheating state -- live warning banner + running counters,
//   // both driven by "score_update" / "final_report" / "interview_complete"
//   // backend messages that now also carry proctoring counts.
//   const [cheatWarning, setCheatWarning] = useState("");
//   const [cheatStats, setCheatStats] = useState({
//     tabSwitches: 0,
//     copyEvents: 0,
//     pasteEvents: 0,
//     fullscreenExits: 0,
//     multipleFaces: 0,
//   });

//   const videoAnalytics = useMemo(() => {
//     const withVisual = backendTranscript.filter((t) => t.delivery_detail?.visual);
//     if (!withVisual.length) return null;
//     const avg = (key) => {
//       const vals = withVisual
//         .map((t) => t.delivery_detail.visual[key])
//         .filter((v) => typeof v === "number");
//       if (!vals.length) return null;
//       return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
//     };
//     return {
//       eyeContact: avg("eye_contact_score"),
//       engagement: avg("body_posture_score"),
//       expression: avg("facial_expression_score"),
//     };
//   }, [backendTranscript]);

//   const voiceAnalytics = useMemo(() => {
//     const withAudio = backendTranscript.filter((t) => t.delivery_detail?.audio);
//     if (!withAudio.length) return null;
//     const avg = (key) => {
//       const vals = withAudio
//         .map((t) => t.delivery_detail.audio[key])
//         .filter((v) => typeof v === "number");
//       if (!vals.length) return null;
//       return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
//     };
//     return {
//       fillerWords: avg("filler_words"),
//       clarity: avg("clarity") ?? avg("grammar"),
//       pace: avg("pace"),
//     };
//   }, [backendTranscript]);

//   // Confidence progression across real answered questions.
//   const confidenceTimeline = useMemo(() => {
//     return backendTranscript.map((t, i) => ({
//       time: `Q${i + 1}`,
//       confidence: Math.round((t.confidence_score ?? 0) * 100),
//     }));
//   }, [backendTranscript]);

//   useEffect(() => {
//     return () => {
//       cleanupAllMedia();
//       if (wsRef.current) wsRef.current.close();
//       if ("speechSynthesis" in window) window.speechSynthesis.cancel();
//       if (finishFallbackTimerRef.current) clearTimeout(finishFallbackTimerRef.current);
//       if (cheatWarningTimerRef.current) clearTimeout(cheatWarningTimerRef.current);
//     };
//   }, []);

//   const cleanupAllMedia = () => {
//     stopSpeechRecognition();
//     stopVideoFrameCapture();
//     if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
//       try { mediaRecorderRef.current.stop(); } catch (_) {}
//     }
//     if (audioRecordingStreamRef.current) {
//       audioRecordingStreamRef.current.getTracks().forEach((track) => track.stop());
//       audioRecordingStreamRef.current = null;
//     }
//     if (mediaStreamRef.current) {
//       mediaStreamRef.current.getTracks().forEach((track) => track.stop());
//       mediaStreamRef.current = null;
//     }
//   };

//   useEffect(() => {
//     let interval = null;
//     if (started && !interviewFinished) {
//       interval = setInterval(() => {
//         setElapsedSeconds((prev) => {
//           if (prev >= INTERVIEW_MAX_SECONDS - 1) {
//             manualExitRef.current = true;
//             handleCompleteInterview();
//             return INTERVIEW_MAX_SECONDS;
//           }
//           return prev + 1;
//         });
//       }, 1000);
//     }
//     return () => clearInterval(interval);
//   }, [started, interviewFinished]);

//   useEffect(() => {
//     if (question && started && question !== lastSpokenQuestionRef.current) {
//       lastSpokenQuestionRef.current = question;
//       if ("speechSynthesis" in window) {
//         window.speechSynthesis.cancel();
//         const utterance = new SpeechSynthesisUtterance(question);
//         utterance.onstart = () => {
//           setIsSpeakingAI(true);
//           interviewPhaseRef.current = "AI_SPEAKING";
//           setInterviewPhase("AI_SPEAKING");
//           setStatus("AI is speaking...");
//         };
//         utterance.onend = () => {
//           setIsSpeakingAI(false);
//           if (!interviewFinished && !finishRequestedRef.current) {
//             interviewPhaseRef.current = "WAITING_FOR_ANSWER";
//             setInterviewPhase("WAITING_FOR_ANSWER");
//             setStatus("Your turn — answer the question");
//           }
//         };
//         utterance.onerror = () => {
//           setIsSpeakingAI(false);
//           if (!interviewFinished && !finishRequestedRef.current) {
//             interviewPhaseRef.current = "WAITING_FOR_ANSWER";
//             setInterviewPhase("WAITING_FOR_ANSWER");
//             setStatus("Your turn — answer the question");
//           }
//         };
//         window.speechSynthesis.speak(utterance);
//       }
//     }
//   }, [question, started, interviewFinished]);

//   useEffect(() => {
//     transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
//   }, [transcript]);

//   // NEW: anti-cheating listeners -- tab switch (Page Visibility API),
//   // copy/paste, and fullscreen-exit detection. Active only while the
//   // interview is actually running, so it never interferes with the setup
//   // screen or the results dashboard. Each detected event is sent to the
//   // backend over the existing WebSocket connection; nothing here touches
//   // interview flow, scoring, or the UI beyond the warning banner.
//   useEffect(() => {
//     if (!started || interviewFinished) return;

//     const handleVisibilityChange = () => {
//       if (document.hidden) sendCheatEvent("tab_switch");
//     };
//     const handleCopy = () => sendCheatEvent("copy_detected");
//     const handlePaste = () => sendCheatEvent("paste_detected");
//     const handleFullscreenChange = () => {
//       if (!document.fullscreenElement) sendCheatEvent("fullscreen_exit");
//     };

//     document.addEventListener("visibilitychange", handleVisibilityChange);
//     document.addEventListener("copy", handleCopy);
//     document.addEventListener("paste", handlePaste);
//     document.addEventListener("fullscreenchange", handleFullscreenChange);

//     return () => {
//       document.removeEventListener("visibilitychange", handleVisibilityChange);
//       document.removeEventListener("copy", handleCopy);
//       document.removeEventListener("paste", handlePaste);
//       document.removeEventListener("fullscreenchange", handleFullscreenChange);
//     };
//   }, [started, interviewFinished]);

//   const formatTime = (secs) => {
//     const mins = Math.floor(secs / 60);
//     const remaining = secs % 60;
//     return `${mins.toString().padStart(2, "0")}:${remaining.toString().padStart(2, "0")}`;
//   };

//   const toggleMic = () => {
//     if (mediaStreamRef.current) {
//       const audioTrack = mediaStreamRef.current.getAudioTracks()[0];
//       if (audioTrack) {
//         audioTrack.enabled = !micEnabled;
//         setMicEnabled(!micEnabled);
//       }
//     }
//   };

//   const toggleCam = () => {
//     if (mediaStreamRef.current) {
//       const videoTrack = mediaStreamRef.current.getVideoTracks()[0];
//       if (videoTrack) {
//         videoTrack.enabled = !camEnabled;
//         setCamEnabled(!camEnabled);
//       }
//     }
//   };

//   const handleResumeChange = (event) => {
//     const file = event.target.files?.[0];
//     if (!file) {
//       setResumeFile(null);
//       return;
//     }
//     if (file.type !== "application/pdf") {
//       setError("Please upload a PDF resume.");
//       setResumeFile(null);
//       return;
//     }
//     setError("");
//     setResumeFile(file);
//     setResumeText("");
//   };

//   const uploadResume = async () => {
//     if (!resumeFile) throw new Error("Please select a PDF resume.");
//     setStatus("Extracting resume text...");
//     const formData = new FormData();
//     formData.append("file", resumeFile);

//     const response = await fetch(`${API_URL}/interview/upload-resume`, {
//       method: "POST",
//       body: formData,
//     });

//     if (!response.ok) {
//       const text = await response.text();
//       throw new Error(text || "Resume upload failed.");
//     }

//     const data = await response.json();
//     const extractedText = data.resume_text || data.text || data.extracted_text || "";
//     if (!extractedText.trim()) throw new Error("Backend could not extract text from the PDF.");

//     setResumeText(extractedText);
//     return extractedText;
//   };

//   const startCamera = async () => {
//     try {
//       if (!navigator.mediaDevices?.getUserMedia) {
//         throw new Error("This browser does not support camera/microphone access.");
//       }

//       const stream = await navigator.mediaDevices.getUserMedia({
//         video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
//         audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1, sampleRate: 48000 },
//       });

//       const audioTracks = stream.getAudioTracks();
//       const videoTracks = stream.getVideoTracks();

//       if (!audioTracks.length) {
//         stream.getTracks().forEach((track) => track.stop());
//         throw new Error("Microphone was not detected.");
//       }
//       if (!videoTracks.length) {
//         stream.getTracks().forEach((track) => track.stop());
//         throw new Error("Camera was not detected.");
//       }

//       audioTracks[0].enabled = true;
//       videoTracks[0].enabled = true;

//       mediaStreamRef.current = stream;
//       setMicEnabled(true);
//       setCamEnabled(true);

//       if (videoRef.current) {
//         videoRef.current.srcObject = stream;
//         videoRef.current.muted = true;
//         try { await videoRef.current.play(); } catch (_) {}
//       }

//       return stream;
//     } catch (err) {
//       console.error("Camera/microphone error:", err);
//       let message = err?.message || "Camera and microphone permission is required.";
//       setError(message);
//       setStatus("Camera/microphone unavailable");
//       return null;
//     }
//   };

//   useEffect(() => {
//     if (started && videoRef.current && mediaStreamRef.current && videoRef.current.srcObject !== mediaStreamRef.current) {
//       videoRef.current.srcObject = mediaStreamRef.current;
//       // FIX: `autoPlay` alone isn't reliable across browsers once srcObject
//       // is (re)assigned after the element mounts -- if this doesn't
//       // actually start playing, videoWidth/videoHeight stay 0 forever and
//       // captureVideoFrame() silently no-ops every single call, so no
//       // frames ever reach the backend (this is the root cause of "no
//       // video delivery data recorded" / vision_agent falling back to a
//       // default 50% confidence with current_visual_metrics: None).
//       videoRef.current.play().catch((err) => {
//         console.error("⚠️ Camera video element failed to play:", err);
//       });
//     }
//   }, [started]);

//   const connectWebSocket = () => {
//     return new Promise((resolve, reject) => {
//       if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
//         try { wsRef.current.close(); } catch (_) {}
//       }

//       const ws = new WebSocket(WS_URL);
//       wsRef.current = ws;

//       ws.onopen = () => {
//         setConnected(true);
//         setStatus("Backend connected");
//         resolve(ws);
//       };

//       ws.onerror = () => {
//         setConnected(false);
//         setStatus("Connection error");
//         reject(new Error("WebSocket connection failed."));
//       };

//       ws.onclose = (event) => {
//         setConnected(false);
//         if (!interviewFinished) {
//           setStatus("Disconnected");
//           setError(`Connection lost (code ${event.code}). Please restart.`);
//         }
//       };

//       ws.onmessage = (event) => {
//         try {
//           const data = JSON.parse(event.data);
//           handleBackendMessage(data);
//         } catch (err) {
//           console.error("Invalid backend message:", err);
//         }
//       };
//     });
//   };

//   const acceptQuestion = (rawQuestion, suppliedNumber) => {
//     if (finishRequestedRef.current || interviewFinished) return;
//     const nextQuestion = String(rawQuestion || "").trim();
//     if (!nextQuestion) return;

//     const nextNumber = Number(suppliedNumber) > 0 ? Number(suppliedNumber) : askedQuestionsRef.current.length + 1;
//     const alreadyAcceptedThisNumber = nextNumber <= lastAcceptedQuestionNumberRef.current;
//     const exactTextDuplicate = askedQuestionsRef.current.some((q) => q.text.trim().toLowerCase() === nextQuestion.toLowerCase());

//     if (alreadyAcceptedThisNumber || exactTextDuplicate) return;

//     askedQuestionsRef.current.push({ number: nextNumber, text: nextQuestion });
//     lastAcceptedQuestionNumberRef.current = nextNumber;
//     answerSubmitLockRef.current = false;
//     interviewPhaseRef.current = "AI_SPEAKING";
//     setInterviewPhase("AI_SPEAKING");
//     setQuestion(nextQuestion);
//     setQuestionNumber(nextNumber);
//     setAnswer("");
//     setIsProcessing(false);
//     answerFramesRef.current = [];
//     setStatus("AI is asking a question");

//     setTranscript((prev) => [...prev, { sender: "AI Interviewer", text: nextQuestion }]);
//   };

//   const handleBackendMessage = (data) => {
//     switch (data.type) {
//       case "question":
//         acceptQuestion(data.question, data.question_number);
//         break;
//       case "recording_start":
//         setRecording(true);
//         setIsProcessing(false);
//         setStatus("Listening...");
//         break;
//       case "transcript":
//         if (data.text) setAnswer(data.text);
//         break;
//       case "answer_received":
//         setIsProcessing(true);
//         interviewPhaseRef.current = "PROCESSING_ANSWER";
//         setInterviewPhase("PROCESSING_ANSWER");
//         setStatus("Evaluating answer...");
//         break;
//       case "processing":
//         // Backend heartbeat sent every few seconds during a long
//         // graph.invoke() (e.g. Whisper transcription can take 40-50s+, or
//         // an LLM call can retry after a slow/failed attempt). Just proves
//         // the connection is still alive; also updates status text so a
//         // long wait doesn't look stuck. No score/state changes.
//         setStatus(
//           data.elapsed_seconds
//             ? `Still processing your answer... (${data.elapsed_seconds}s)`
//             : "Still processing your answer..."
//         );
//         break;
//       case "score_update":
//         updateScores(data);
//         updateCheatStats(data); // NEW
//         setHasScore(true);
//         if (data.feedback) setFeedback(data.feedback);
//         break;
//       case "transcript_update":
//         // Real backend QAItem transcript -- source of truth for the
//         // question breakdown table and derived analytics.
//         if (Array.isArray(data.transcript)) setBackendTranscript(data.transcript);
//         break;
//       case "answer_result":
//         if (data.feedback) setFeedback(data.feedback);
//         if (data.scores) {
//           updateScores(data.scores);
//           updateCheatStats(data.scores); // NEW
//         } else {
//           updateScores(data);
//           updateCheatStats(data); // NEW
//         }
//         setHasScore(true);
//         if (Array.isArray(data.transcript)) setBackendTranscript(data.transcript);
//         setRecording(false);
//         setIsProcessing(true);
//         interviewPhaseRef.current = "PROCESSING_ANSWER";
//         setInterviewPhase("PROCESSING_ANSWER");

//         if (lastAcceptedQuestionNumberRef.current >= maxQuestions && !finishRequestedRef.current) {
//           finishInterview();
//         }
//         break;
//       case "final_report":
//       case "interview_complete":
//         setFinalReport(data.report || data.final_report || "");
//         if (data.scores) {
//           updateScores(data.scores);
//           updateCheatStats(data.scores); // NEW
//         } else {
//           updateScores(data);
//           updateCheatStats(data); // NEW
//         }
//         finishInterviewLocally();
//         break;
//       case "cheat_event_ack":
//         // Lightweight ack from the backend after a proctoring event;
//         // score_update / final messages remain the source of truth for the
//         // dashboard, this just keeps the running counters fresh sooner.
//         if (data.counts) updateCheatStats(data.counts);
//         break;
//       case "ended":
//         finishInterviewLocally();
//         break;
//       case "error":
//         answerSubmitLockRef.current = false;
//         setError(data.message || "Backend error");
//         setRecording(false);
//         setIsProcessing(false);
//         break;
//       default:
//         break;
//     }
//   };

//   const finishInterviewLocally = () => {
//     if (finishFallbackTimerRef.current) {
//       clearTimeout(finishFallbackTimerRef.current);
//       finishFallbackTimerRef.current = null;
//     }
//     if ("speechSynthesis" in window) window.speechSynthesis.cancel();
//     setIsSpeakingAI(false);
//     stopVideoFrameCapture();
//     if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
//       try { mediaRecorderRef.current.stop(); } catch (_) {}
//     }
//     if (mediaStreamRef.current) mediaStreamRef.current.getTracks().forEach((track) => track.stop());
//     setRecording(false);
//     setEndedEarly(manualExitRef.current);
//     // Mark finished BEFORE leaving fullscreen so our own programmatic exit
//     // isn't picked up by the fullscreenchange listener as a cheat event.
//     setInterviewFinished(true);
//     if (document.fullscreenElement) {
//       const exit =
//         document.exitFullscreen ||
//         document.webkitExitFullscreen ||
//         document.mozCancelFullScreen ||
//         document.msExitFullscreen;
//       if (exit) {
//         try { exit.call(document); } catch (_) {}
//       }
//     }
//   };

//   const updateScores = (data = {}) => {
//     setScores((previous) => ({
//       ...previous,
//       technical: safeRound(data.technical ?? data.technical_score, previous.technical),
//       relevance: safeRound(data.relevance ?? data.relevance_score, previous.relevance),
//       communication: safeRound(data.communication ?? data.communication_score, previous.communication),
//       video: safeRound(data.video ?? data.video_score, previous.video),
//       confidence: safeRound(data.confidence ?? data.confidence_score, previous.confidence),
//       overall: safeRound(data.overall ?? data.overall_score, previous.overall),
//       integrity: safeRound(data.integrity_score ?? data.integrity, previous.integrity), // NEW
//     }));
//   };

//   // NEW: mirrors updateScores for the proctoring counters -- reads
//   // whichever shape the backend message happens to carry them in
//   // (score_update / cheat_event_ack use snake_case keys directly).
//   const updateCheatStats = (data = {}) => {
//     setCheatStats((previous) => ({
//       tabSwitches: data.tab_switches ?? previous.tabSwitches,
//       copyEvents: data.copy_events ?? previous.copyEvents,
//       pasteEvents: data.paste_events ?? previous.pasteEvents,
//       fullscreenExits: data.fullscreen_exits ?? previous.fullscreenExits,
//       multipleFaces: data.multiple_faces_events ?? previous.multipleFaces,
//     }));
//   };

//   // NEW: sends a proctoring event to the backend over the existing
//   // WebSocket connection and flashes a short on-screen warning. Never
//   // touches interview flow/state beyond the warning banner + counters.
//   const sendCheatEvent = (type) => {
//     if (!started || interviewFinished) return;
//     if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
//       wsRef.current.send(JSON.stringify({ type }));
//     }
//     const labels = {
//       tab_switch: "⚠️ Tab switch detected — please stay on this tab.",
//       copy_detected: "⚠️ Copy detected.",
//       paste_detected: "⚠️ Paste detected.",
//       fullscreen_exit: "⚠️ You exited fullscreen — please return to fullscreen.",
//     };
//     setCheatWarning(labels[type] || "⚠️ Suspicious activity detected.");
//     if (cheatWarningTimerRef.current) clearTimeout(cheatWarningTimerRef.current);
//     cheatWarningTimerRef.current = setTimeout(() => setCheatWarning(""), 4000);
//   };

//   const startInterview = async () => {
//     if (startingInterviewRef.current || started || isStarting) return;
//     startingInterviewRef.current = true;
//     setIsStarting(true);

//     // Camera/mic must start FIRST, as close to the raw click/tap as
//     // possible -- fullscreen and resume upload happen after. (On mobile,
//     // <video>.play() must fire close to the gesture or it's silently
//     // blocked as autoplay once the gesture window has lapsed.)
//     const stream = await startCamera();
//     if (!stream) {
//       setError(error || "Could not access camera/microphone.");
//       startingInterviewRef.current = false;
//       setIsStarting(false);
//       return;
//     }

//     // Request fullscreen immediately, while still inside the click
//     // handler's user-gesture context, so browsers don't silently block it.
//     // Not fatal if it fails -- the interview still runs, just without the
//     // fullscreen-exit signal until/unless the user enters fullscreen later.
//     try {
//       const requestFs =
//         document.documentElement.requestFullscreen ||
//         document.documentElement.webkitRequestFullscreen ||
//         document.documentElement.mozRequestFullScreen ||
//         document.documentElement.msRequestFullscreen;
//       if (requestFs) {
//         await requestFs.call(document.documentElement);
//       }
//     } catch (_) {
//       console.warn("Could not enter fullscreen; continuing without it.");
//     }

//     try {
//       setError("");
//       askedQuestionsRef.current = [];
//       lastAcceptedQuestionNumberRef.current = 0;
//       answerSubmitLockRef.current = false;
//       finishRequestedRef.current = false;
//       manualExitRef.current = false;
//       interviewPhaseRef.current = "IDLE";
//       setInterviewPhase("IDLE");
//       setQuestion("");
//       setQuestionNumber(0);
//       setTranscript([]);
//       setBackendTranscript([]);
//       setElapsedSeconds(0);
//       setEndedEarly(false);
//       setHasScore(false);
//       setFeedback("");
//       setCheatWarning(""); // NEW
//       setCheatStats({ tabSwitches: 0, copyEvents: 0, pasteEvents: 0, fullscreenExits: 0, multipleFaces: 0 }); // NEW

//       if (!resumeFile) throw new Error("Please upload your resume PDF.");
//       if (!jobDescription.trim()) throw new Error("Please enter the job description.");

//       const extractedResume = await uploadResume();

//       // On mobile, video.play() resolving successfully doesn't always mean
//       // the element is actually decoding frames yet -- give it a brief
//       // moment and retry play() once if videoWidth/videoHeight are still
//       // 0, instead of silently capturing nothing for the whole interview.
//       if (videoRef.current && (videoRef.current.videoWidth === 0 || videoRef.current.videoHeight === 0)) {
//         await new Promise((resolve) => setTimeout(resolve, 400));
//         if (videoRef.current && videoRef.current.videoWidth === 0) {
//           try { await videoRef.current.play(); } catch (_) {}
//         }
//       }

//       const ws = await connectWebSocket();
//       ws.send(JSON.stringify({
//         type: "start_interview",
//         resume_text: extractedResume,
//         job_description: jobDescription,
//         max_questions: maxQuestions,
//         max_duration_seconds: INTERVIEW_MAX_SECONDS,
//       }));

//       setStarted(true);
//       startVideoFrameCapture();
//     } catch (err) {
//       setError(err.message || "Could not start interview.");
//       cleanupAllMedia();
//       if (wsRef.current) try { wsRef.current.close(); } catch (_) {}
//     } finally {
//       startingInterviewRef.current = false;
//       setIsStarting(false);
//     }
//   };

//   const captureVideoFrame = () => {
//     if (!videoRef.current) {
//       console.warn("⚠️ captureVideoFrame: videoRef not mounted yet, skipping frame");
//       return;
//     }
//     const video = videoRef.current;
//     if (video.videoWidth === 0 || video.videoHeight === 0) {
//       // If this logs repeatedly, the video element never actually started
//       // playing (see the play() fix in the srcObject-assignment useEffect
//       // above).
//       console.warn("⚠️ captureVideoFrame: video has no dimensions yet (not playing?), skipping frame");
//       return;
//     }
//     const canvas = document.createElement("canvas");
//     canvas.width = 320;
//     canvas.height = Math.round((video.videoHeight / video.videoWidth) * 320);
//     const context = canvas.getContext("2d");
//     if (!context) return;
//     context.drawImage(video, 0, 0, canvas.width, canvas.height);
//     const image = canvas.toDataURL("image/jpeg", 0.55).split(",")[1];
//     answerFramesRef.current.push(image);
//     if (answerFramesRef.current.length > 20) answerFramesRef.current = answerFramesRef.current.slice(-20);

//     // The backend accumulates frames server-side into
//     // video_frames[session_id] from individual {"type": "video_frame",
//     // "frame_b64": ...} messages -- it does NOT read the frames_b64 array
//     // bundled into the final "answer" message.
//     if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
//       wsRef.current.send(JSON.stringify({ type: "video_frame", frame_b64: image }));
//     }
//   };

//   const startVideoFrameCapture = () => {
//     if (frameTimerRef.current) clearInterval(frameTimerRef.current);
//     frameTimerRef.current = setInterval(captureVideoFrame, 1000);
//   };

//   const stopVideoFrameCapture = () => {
//     if (frameTimerRef.current) {
//       clearInterval(frameTimerRef.current);
//       frameTimerRef.current = null;
//     }
//   };

//   const startSpeechRecognition = () => {
//     const SpeechRecognitionImpl = window.SpeechRecognition || window.webkitSpeechRecognition;
//     finalTranscriptRef.current = "";
//     if (!SpeechRecognitionImpl) return;

//     try {
//       const recognition = new SpeechRecognitionImpl();
//       recognition.continuous = true;
//       recognition.interimResults = true;
//       recognition.lang = "en-US";
//       recognition.onresult = (event) => {
//         let interim = "";
//         for (let i = event.resultIndex; i < event.results.length; i++) {
//           const piece = event.results[i][0].transcript;
//           if (event.results[i].isFinal) finalTranscriptRef.current = (finalTranscriptRef.current + " " + piece).trim();
//           else interim += piece;
//         }
//         setAnswer((finalTranscriptRef.current + " " + interim).trim());
//       };
//       recognition.onend = () => {
//         if (recognitionRef.current === recognition) {
//           try { recognition.start(); } catch (_) {}
//         }
//       };
//       recognitionRef.current = recognition;
//       recognition.start();
//     } catch (err) {
//       recognitionRef.current = null;
//     }
//   };

//   const stopSpeechRecognition = () => {
//     const recognition = recognitionRef.current;
//     recognitionRef.current = null;
//     if (recognition) {
//       try {
//         recognition.onend = null;
//         recognition.stop();
//       } catch (_) {}
//     }
//   };

//   const startRecording = () => {
//     if (startingRecordingRef.current || answerSubmitLockRef.current || isProcessing || isSpeakingAI || recording) return;
//     if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
//       setError("Backend connection is not active.");
//       return;
//     }

//     startingRecordingRef.current = true;
//     const sourceStream = mediaStreamRef.current;
//     if (!sourceStream) {
//       startingRecordingRef.current = false;
//       return;
//     }

//     const sourceAudioTrack = sourceStream.getAudioTracks()[0];
//     let audioStream = new MediaStream([sourceAudioTrack.clone()]);
//     audioRecordingStreamRef.current = audioStream;

//     chunksRef.current = [];
//     answerFramesRef.current = [];

//     const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm";

//     // FIX: explicit audioBitsPerSecond. The browser's default bitrate for
//     // MediaRecorder can be quite low, and low-bitrate/noisy audio is a
//     // known trigger for Whisper "hallucinating" unrelated-language tokens
//     // into the transcript (e.g. random Chinese characters mixed into
//     // otherwise-English output) instead of failing cleanly.
//     let recorder = new MediaRecorder(audioStream, {
//       mimeType,
//       audioBitsPerSecond: 128000,
//     });
//     mediaRecorderRef.current = recorder;
//     const questionNumberAtRecordStart = questionNumber;

//     // NEW: track when this recording actually started so onstop can
//     // reject/guard against near-instant recordings.
//     recordStartTimeRef.current = Date.now();

//     recorder.ondataavailable = (e) => { if (e.data?.size > 0) chunksRef.current.push(e.data); };
//     recorder.onstop = async () => {
//       try {
//         // NEW: guard against too-short recordings (candidate barely
//         // spoke, or double-clicked start/stop). Sub-second clips are
//         // exactly what triggers Whisper hallucination -- better to ask
//         // the candidate to re-record than send near-silent audio to the
//         // backend and have it silently scored as a 0.
//         const recordedMs = Date.now() - recordStartTimeRef.current;
//         if (recordedMs < MIN_RECORDING_MS) {
//           setError("Recording was too short — please answer for at least a second before stopping.");
//           setRecording(false);
//           setIsProcessing(false);
//           return;
//         }

//         const blob = new Blob(chunksRef.current, { type: mimeType });
//         const base64 = await blobToBase64(blob);
//         const frames = [...answerFramesRef.current];
//         const spokenText = finalTranscriptRef.current.trim();

//         wsRef.current.send(JSON.stringify({
//           type: "answer",
//           audio_b64: base64,
//           text: spokenText,
//           frames_b64: frames,
//           question_number: questionNumberAtRecordStart,
//           audio_mime_type: mimeType,
//         }));

//         setTranscript((prev) => [...prev, { sender: "Candidate", text: spokenText || "[Voice Answer]" }]);
//         setAnswer("");
//         finalTranscriptRef.current = "";
//         setRecording(false);
//         setIsProcessing(true);
//       } catch (err) {
//         setError("Could not send voice answer.");
//         setRecording(false);
//         setIsProcessing(false);
//       } finally {
//         stopSpeechRecognition();
//         if (audioRecordingStreamRef.current) {
//           audioRecordingStreamRef.current.getTracks().forEach((t) => t.stop());
//           audioRecordingStreamRef.current = null;
//         }
//         mediaRecorderRef.current = null;
//       }
//     };

//     try { recorder.start(250); } catch (err) {
//       startingRecordingRef.current = false;
//       setError("Recorder failed to start.");
//       return;
//     }

//     startSpeechRecognition();
//     answerSubmitLockRef.current = true;
//     setRecording(true);
//     startingRecordingRef.current = false;
//   };

//   const stopRecording = () => {
//     return new Promise((resolve) => {
//       const recorder = mediaRecorderRef.current;
//       if (!recorder || recorder.state !== "recording") {
//         resolve();
//         return;
//       }
//       const originalOnStop = recorder.onstop;
//       recorder.onstop = async (e) => {
//         if (originalOnStop) await originalOnStop.call(recorder, e);
//         resolve();
//       };
//       stopSpeechRecognition();
//       recorder.stop();
//     });
//   };

//   const sendTextAnswer = () => {
//     if (answerSubmitLockRef.current || !answer.trim()) return;
//     const currentAnswerText = answer.trim();
//     if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

//     answerSubmitLockRef.current = true;
//     setIsProcessing(true);

//     wsRef.current.send(JSON.stringify({
//       type: "answer",
//       audio_b64: "",
//       text: currentAnswerText,
//       frames_b64: [...answerFramesRef.current],
//       question_number: questionNumber,
//     }));

//     setTranscript((prev) => [...prev, { sender: "Candidate", text: currentAnswerText }]);
//     setAnswer("");
//   };

//   const blobToBase64 = (blob) => {
//     return new Promise((resolve, reject) => {
//       const reader = new FileReader();
//       reader.onloadend = () => resolve(reader.result.split(",")[1]);
//       reader.onerror = reject;
//       reader.readAsDataURL(blob);
//     });
//   };

//   const finishInterview = () => {
//     if (finishRequestedRef.current) return;
//     finishRequestedRef.current = true;

//     if ("speechSynthesis" in window) window.speechSynthesis.cancel();
//     setIsSpeakingAI(false);
//     stopVideoFrameCapture();

//     if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
//       wsRef.current.send(JSON.stringify({ type: "finish_interview" }));
//     } else {
//       finishInterviewLocally();
//       return;
//     }

//     finishFallbackTimerRef.current = setTimeout(() => {
//       if (!interviewFinished) finishInterviewLocally();
//     }, 10000);
//   };

//   const handleCompleteInterview = async () => {
//     if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
//       await stopRecording();
//     }
//     finishInterview();
//     setShowExitModal(false);
//   };

//   // --- RENDER VIEWS ---

//   if (!started) {
//     return (
//       <div className="app-root flex-center">
//         <div className="card setup-card animate-fade-in">
//           <div className="setup-header">
//             <h1 className="title-gradient">⚡  AI Mock Interview </h1>
//             <span className="badge badge-indigo">SECURE RECRUITER PORTAL</span>
//           </div>

//           {error && <div className="alert alert-error">{error}</div>}

//           <div className="form-group-container">
//             <div className="input-group">
//               <label className="input-label">Candidate Name</label>
//               <input 
//                 type="text" 
//                 value={candidateName} 
//                 onChange={(e) => setCandidateName(e.target.value)} 
//                 className="input-field" 
//               />
//             </div>
//             <div className="input-group">
//               <label className="input-label">Target Job Title</label>
//               <input 
//                 type="text" 
//                 value={appliedRole} 
//                 onChange={(e) => setAppliedRole(e.target.value)} 
//                 className="input-field" 
//               />
//             </div>
//             <div className="input-group">
//               <label className="input-label">Upload PDF Resume</label>
//               <input 
//                 type="file" 
//                 accept="application/pdf" 
//                 onChange={handleResumeChange} 
//                 disabled={isStarting}
//                 className="file-input"
//               />
//             </div>
//             <div className="input-group">
//               <label className="input-label">Job Description Requirements</label>
//               <textarea 
//                 rows={4} 
//                 placeholder="Paste role requirements..." 
//                 value={jobDescription} 
//                 onChange={(e) => setJobDescription(e.target.value)} 
//                 className="input-field textarea-field"
//               />
//             </div>
//             <div className="input-group">
//               <label className="input-label">Questions Count</label>
//               <input 
//                 type="number" 
//                 min={1} 
//                 max={20} 
//                 value={maxQuestions} 
//                 onChange={(e) => setMaxQuestions(Math.max(1, Number(e.target.value) || 1))} 
//                 className="input-field"
//               />
//             </div>

//             <button 
//               onClick={startInterview} 
//               disabled={isStarting} 
//               className="btn btn-primary btn-full mt-4"
//             >
//               {isStarting ? `Initializing Session...` : "Launch Assessment Session"}
//             </button>
//           </div>
//         </div>
//       </div>
//     );
//   }

//   // --- ENTERPRISE RECRUITER RESULTS DASHBOARD ---
//   if (interviewFinished) {
//     const radarData = [
//       { subject: 'Technical', A: scores.technical, fullMark: 100 },
//       { subject: 'Communication', A: scores.communication, fullMark: 100 },
//       { subject: 'Relevance', A: scores.relevance, fullMark: 100 },
//       { subject: 'Confidence', A: scores.confidence, fullMark: 100 },
//       { subject: 'Delivery', A: scores.video, fullMark: 100 },
//     ];

//     return (
//       <div className="dashboard-container animate-fade-in">
        
//         {/* Top Header */}
//         <div className="card dashboard-header">
//           <div className="header-info">
//             <div className="flex-row-center gap-3">
//               <h1 className="text-2xl font-bold text-white">{candidateName}</h1>
//               <span className="badge badge-emerald flex-row-center gap-1">
//                 <CheckCircle size={14} /> Completed & Verified
//               </span>
//             </div>
//             <div className="meta-info-row">
//               <span className="flex-row-center gap-1.5"><Briefcase size={15} /> {appliedRole}</span>
//               <span className="flex-row-center gap-1.5"><Calendar size={15} /> {interviewDate}</span>
//               <span className="flex-row-center gap-1.5"><Clock size={15} /> {formatTime(elapsedSeconds)}</span>
//             </div>
//           </div>
//           <div className="header-actions">
//              <button onClick={() => window.print()} className="btn btn-primary flex-row-center gap-2">
//               <Download size={16} /> Download Full Report
//             </button>
//           </div>
//         </div>

//         {/* KPI Cards Grid */}
//         <div className="kpi-grid">
//           <div className="card kpi-card">
//             <div className="kpi-title">Overall Score</div>
//             <div className="kpi-flex">
//               <span className="kpi-value">{scores.overall}</span>
//             </div>
//             <div className="progress-track">
//               <div className="progress-fill bg-indigo" style={{ width: `${scores.overall}%` }}></div>
//             </div>
//           </div>

//           <div className="card kpi-card">
//             <div className="kpi-title">Relevance Score</div>
//             <div className="kpi-flex">
//               <span className="kpi-value">{scores.relevance}%</span>
//             </div>
//             <div className="progress-track">
//               <div className="progress-fill bg-emerald" style={{ width: `${scores.relevance}%` }}></div>
//             </div>
//           </div>

//           <div className="card kpi-card">
//             <div className="kpi-title">Communication Score</div>
//             <div className="kpi-flex">
//               <span className="kpi-value">{scores.communication}%</span>
//             </div>
//             <div className="progress-track">
//               <div className="progress-fill bg-indigo" style={{ width: `${scores.communication}%` }}></div>
//             </div>
//           </div>

//           <div className="card kpi-card">
//             <div className="kpi-title">Technical Score</div>
//             <div className="kpi-flex">
//               <span className="kpi-value">{scores.technical}%</span>
//             </div>
//             <div className="progress-track">
//               <div className="progress-fill bg-amber" style={{ width: `${scores.technical}%` }}></div>
//             </div>
//           </div>

//           {/* Integrity / anti-cheating KPI card */}
//           <div className="card kpi-card">
//             <div className="kpi-title">Integrity Score</div>
//             <div className="kpi-flex">
//               <span className="kpi-value">{scores.integrity}</span>
//             </div>
//             <div className="progress-track">
//               <div
//                 className={scores.integrity >= 80 ? "progress-fill bg-emerald" : "progress-fill bg-amber"}
//                 style={{ width: `${scores.integrity}%` }}
//               ></div>
//             </div>
//           </div>
//         </div>

//         {/* AI Recommendation Banner */}
//         <div className="card banner-card">
//           <div className="space-y-2">
//             <p className="banner-text">
//               {finalReport || "No final report was returned by the backend for this session."}
//             </p>
//           </div>
//         </div>

//         {/* Skills Assessment & Radar Section */}
//         <div className="grid-2-cols">
//           <div className="card flex flex-col items-center justify-center">
//             <h3 className="section-title w-full mb-4">Competency Radar Map</h3>
//             <div className="w-full h-[300px]">
//               <ResponsiveContainer width="100%" height="100%">
//                 <RadarChart cx="50%" cy="50%" outerRadius="80%" data={radarData}>
//                   <PolarGrid stroke="#334155" />
//                   <PolarAngleAxis dataKey="subject" stroke="#94a3b8" tick={{ fill: '#94a3b8', fontSize: 12 }} />
//                   <PolarRadiusAxis angle={30} domain={[0, 100]} stroke="#334155" />
//                   <Radar name="Candidate" dataKey="A" stroke="#6366f1" fill="#6366f1" fillOpacity={0.4} />
//                 </RadarChart>
//               </ResponsiveContainer>
//             </div>
//           </div>

//           <div className="card space-y-4">
//             <h3 className="section-title mb-2">Core Skill Metrics</h3>
//             {[
//               { label: "Technical Knowledge", val: scores.technical },
//               { label: "Communication Clarity", val: scores.communication },
//               { label: "Relevance", val: scores.relevance },
//               { label: "Confidence", val: scores.confidence },
//               { label: "Delivery (video/audio)", val: scores.video },
//             ].map((skill, i) => (
//               <div key={i} className="skill-bar-wrapper">
//                 <div className="skill-bar-label">
//                   <span>{skill.label}</span>
//                   <span>{skill.val}/100</span>
//                 </div>
//                 <div className="progress-track">
//                   <div className="progress-fill bg-indigo" style={{ width: `${skill.val}%` }}></div>
//                 </div>
//               </div>
//             ))}
//           </div>
//         </div>

//         {/* Video & Voice Analytics Section */}
//         <div className="grid-2-cols">
//           {/* Video Analytics */}
//           <div className="card space-y-6">
//             <div className="flex-between">
//               <h3 className="section-title flex-row-center gap-2"><Eye size={20} className="text-indigo-400" /> Video & Behavioral Analytics</h3>
//               <span className="badge badge-indigo">From recorded frames</span>
//             </div>

//             {videoAnalytics ? (
//               <>
//                 <div className="grid-3-cols">
//                   <div className="analytics-box">
//                     <div className="analytics-label">Eye Contact</div>
//                     <div className="analytics-val">{videoAnalytics.eyeContact ?? "--"}%</div>
//                   </div>
//                   <div className="analytics-box">
//                     <div className="analytics-label">Posture / Engagement</div>
//                     <div className="analytics-val">{videoAnalytics.engagement ?? "--"}%</div>
//                   </div>
//                   <div className="analytics-box">
//                     <div className="analytics-label">Expression</div>
//                     <div className="analytics-val">{videoAnalytics.expression ?? "--"}%</div>
//                   </div>
//                 </div>

//                 <div>
//                   <div className="input-label mb-2">Confidence Progression Timeline</div>
//                   <div className="h-[140px] w-full">
//                     <ResponsiveContainer width="100%" height="100%">
//                       <LineChart data={confidenceTimeline}>
//                         <XAxis dataKey="time" stroke="#94a3b8" fontSize={10} />
//                         <YAxis domain={[0, 100]} stroke="#94a3b8" fontSize={10} />
//                         <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px' }} />
//                         <Line type="monotone" dataKey="confidence" stroke="#6366f1" strokeWidth={3} dot={{ fill: '#6366f1' }} />
//                       </LineChart>
//                     </ResponsiveContainer>
//                   </div>
//                 </div>
//               </>
//             ) : (
//               <p className="text-sm text-slate-400">No video delivery data was recorded for this session.</p>
//             )}
//           </div>

//           {/* Voice Analytics */}
//           <div className="card space-y-6">
//             <div className="flex-between">
//               <h3 className="section-title flex-row-center gap-2"><Volume2 size={20} className="text-indigo-400" /> Voice & Speech Analytics</h3>
//               <span className="badge badge-indigo">From recorded audio</span>
//             </div>

//             {voiceAnalytics ? (
//               <div className="grid-3-cols">
//                 <div className="analytics-box">
//                   <div className="analytics-label">Filler Words</div>
//                   <div className="analytics-val text-amber">{voiceAnalytics.fillerWords ?? "--"}</div>
//                 </div>
//                 <div className="analytics-box">
//                   <div className="analytics-label">Clarity Score</div>
//                   <div className="analytics-val">{voiceAnalytics.clarity ?? "--"}%</div>
//                 </div>
//                 <div className="analytics-box">
//                   <div className="analytics-label">Pace</div>
//                   <div className="analytics-val">{voiceAnalytics.pace ?? "--"}</div>
//                 </div>
//               </div>
//             ) : (
//               <p className="text-sm text-slate-400">No audio delivery data was recorded for this session.</p>
//             )}
//           </div>
//         </div>

//         {/* Question by Question Table -- real backend transcript */}
//         <div className="card space-y-4">
//           <h3 className="section-title">Question Breakdown & Evaluation</h3>
//           <div className="space-y-3">
//             {backendTranscript.length === 0 && (
//               <p className="text-sm text-slate-400">No completed answers were recorded for this session.</p>
//             )}
//             {backendTranscript.map((q, idx) => {
//               const contentAvg = Math.round(
//                 (((q.eval_score ?? 0) + (q.relevance_score ?? 0) + (q.communication_score ?? 0)) / 3) * 10
//               );
//               return (
//                 <div key={idx} className="accordion-item">
//                   <div
//                     onClick={() => setExpandedIndex(expandedIndex === idx ? null : idx)}
//                     className="accordion-header flex-between"
//                   >
//                     <div className="flex-row-center gap-3">
//                       <span className="badge badge-indigo">Q{idx + 1}</span>
//                       <span className="text-sm font-medium text-white">{q.question}</span>
//                       {q.multiple_faces_detected && (
//                         <span className="badge badge-amber flex-row-center gap-1">
//                           <AlertTriangle size={12} /> Multiple faces
//                         </span>
//                       )}
//                     </div>
//                     <div className="flex-row-center gap-4">
//                       <span className="badge badge-emerald">Score: {contentAvg}/100</span>
//                       {expandedIndex === idx ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
//                     </div>
//                   </div>
//                   {expandedIndex === idx && (
//                     <div className="accordion-body space-y-3">
//                       <div className="grid grid-cols-3 gap-2 text-xs text-slate-400">
//                         <div>Technical: {q.eval_score ?? 0}/10</div>
//                         <div>Relevance: {q.relevance_score ?? 0}/10</div>
//                         <div>Communication: {q.communication_score ?? 0}/10</div>
//                       </div>
//                       {(q.visual_score > 0 || q.audio_delivery_score > 0) && (
//                         <div className="grid grid-cols-2 gap-2 text-xs text-slate-400">
//                           {q.visual_score > 0 && <div>Visual delivery: {q.visual_score.toFixed(0)}/100</div>}
//                           {q.audio_delivery_score > 0 && <div>Audio delivery: {q.audio_delivery_score.toFixed(0)}/100</div>}
//                         </div>
//                       )}
//                       <div>
//                         <strong className="text-slate-400 uppercase text-xs block mb-1">AI Feedback & Analysis:</strong>
//                         <p>{q.feedback || "No feedback recorded for this answer."}</p>
//                       </div>
//                       <div>
//                         <strong className="text-slate-400 uppercase text-xs block mb-1">Candidate Answer:</strong>
//                         <p className="text-slate-300">{q.answer || "(no answer text captured)"}</p>
//                       </div>
//                     </div>
//                   )}
//                 </div>
//               );
//             })}
//           </div>
//         </div>

//         {/* Proctoring / anti-cheating summary */}
//         <div className="card space-y-3">
//           <h3 className="section-title">Proctoring Summary</h3>
//           <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm text-slate-300">
//             <div>Tab switches: <strong>{cheatStats.tabSwitches}</strong></div>
//             <div>Copy events: <strong>{cheatStats.copyEvents}</strong></div>
//             <div>Paste events: <strong>{cheatStats.pasteEvents}</strong></div>
//             <div>Fullscreen exits: <strong>{cheatStats.fullscreenExits}</strong></div>
//             <div>Multiple faces flagged: <strong>{cheatStats.multipleFaces}</strong></div>
//           </div>
//         </div>

//       </div>
//     );
//   }

//   // --- LIVE INTERVIEW SESSION VIEW ---
//   return (
//     <div className="dashboard-container animate-fade-in">
//       <div className="card flex-between p-4">
//         <div className="flex-row-center gap-3">
//           <span className="font-bold text-white text-lg">AI Candidate Evaluation Portal</span>
//           <span className="badge badge-indigo">LIVE SESSION</span>
//         </div>
//         <div className="timer-badge">
//           ⏱️ {formatTime(elapsedSeconds)} / {formatTime(INTERVIEW_MAX_SECONDS)}
//         </div>
//       </div>

//       {error && <div className="alert alert-error">{error}</div>}
//       {cheatWarning && <div className="alert alert-warning">{cheatWarning}</div>}

//       <div className="grid-2-cols">
//         <div className="card flex flex-col justify-between space-y-6">
//           <div className="flex-between">
//             <h3 className="font-bold text-white">AI Interviewer</h3>
//             <span className="status-indicator">
//               <span className={`dot ${isSpeakingAI ? 'bg-indigo animate-pulse' : 'bg-emerald'}`}></span>
//               {isSpeakingAI ? "AI Speaking..." : status}
//             </span>
//           </div>

//           <div className="flex-center py-10">
//             <div className={`ai-avatar ${isSpeakingAI ? 'animate-bounce' : ''}`}>
//               🤖
//             </div>
//           </div>

//           <div className="question-box">
//             <div className="text-xs font-bold text-indigo-400 uppercase">Question {questionNumber || 1} of {maxQuestions}</div>
//             <div className="text-base font-medium text-white leading-relaxed mt-1">
//               {isProcessing ? "Evaluating response..." : question || "Initializing first question..."}
//             </div>
//           </div>
//         </div>

//         <div className="card flex flex-col justify-between space-y-6">
//           <div className="flex-between">
//             <h3 className="font-bold text-white">Candidate Camera Feed</h3>
//             <span className="status-indicator">
//               <span className={`dot ${recording ? 'bg-red animate-ping' : 'bg-slate'}`}></span>
//               {recording ? "Recording Active" : "Standby"}
//             </span>
//           </div>

//           <div className="video-container">
//             <video ref={videoRef} autoPlay playsInline muted className="video-feed" />
//             {recording && (
//               <div className="rec-badge flex-row-center gap-1.5">
//                 <span className="w-2 h-2 rounded-full bg-white animate-pulse"></span> REC
//               </div>
//             )}
//           </div>

//           <div className="flex-between pt-2">
//             <div className="flex-row-center gap-2">
//               <button onClick={toggleMic} className="btn btn-secondary text-xs">
//                 {micEnabled ? "🎙️ Mute" : "🔇 Unmute"}
//               </button>
//               <button onClick={toggleCam} className="btn btn-secondary text-xs">
//                 {camEnabled ? "📹 Disable Cam" : "📷 Enable Cam"}
//               </button>
//             </div>

//             {!recording ? (
//               <button 
//                 onClick={startRecording} 
//                 disabled={isProcessing || isSpeakingAI || interviewPhase !== "WAITING_FOR_ANSWER"}
//                 className="btn btn-primary flex-row-center gap-2"
//               >
//                 🎙️ Start Voice Answer
//               </button>
//             ) : (
//               <button 
//                 onClick={stopRecording}
//                 className="btn btn-danger flex-row-center gap-2"
//               >
//                 ⏹️ Stop & Submit Voice
//               </button>
//             )}
//           </div>
//         </div>
//       </div>

//       <div className="card space-y-4">
//         <div className="flex-between">
//           <h3 className="font-bold text-white">Live Conversation Transcript</h3>
//           <button onClick={() => setShowTextAnswer(!showTextAnswer)} className="btn btn-secondary text-xs">
//             {showTextAnswer ? "Hide Text Mode" : "✏️ Type Response Instead"}
//           </button>
//         </div>

//         {showTextAnswer && (
//           <div className="space-y-3 pt-2">
//             <textarea 
//               rows={3} 
//               placeholder="Type your response here..." 
//               value={answer} 
//               onChange={(e) => setAnswer(e.target.value)} 
//               className="input-field textarea-field"
//             />
//             <button onClick={sendTextAnswer} className="btn btn-primary text-xs">
//               Submit Text Answer
//             </button>
//           </div>
//         )}

//         <div className="transcript-box space-y-3">
//           {transcript.map((msg, idx) => (
//             <div key={idx} className={`transcript-bubble ${msg.sender === "AI Interviewer" ? 'ai-bubble' : 'candidate-bubble'}`}>
//               <div className="text-[10px] font-bold text-slate-400 uppercase mb-1">{msg.sender}</div>
//               <div>{msg.text}</div>
//             </div>
//           ))}
//           <div ref={transcriptEndRef} />
//         </div>

//         <div className="flex justify-end pt-2">
//           <button onClick={() => setShowExitModal(true)} className="btn btn-danger text-xs">
//             Finish Interview Early
//           </button>
//         </div>
//       </div>

//       {showExitModal && (
//         <div className="modal-backdrop flex-center">
//           <div className="card modal-card space-y-4">
//             <h3 className="text-lg font-bold text-white">End Interview Early?</h3>
//             <p className="text-sm text-slate-400">Your performance report will be generated immediately based on the completed questions.</p>
//             <div className="flex justify-end gap-3 pt-2">
//               <button onClick={() => setShowExitModal(false)} className="btn btn-secondary text-xs">
//                 Continue Interview
//               </button>
//               <button onClick={handleCompleteInterview} className="btn btn-danger text-xs">
//                 Finish & View Results
//               </button>
//             </div>
//           </div>
//         </div>
//       )}
//     </div>
//   );
// }

// export default App;