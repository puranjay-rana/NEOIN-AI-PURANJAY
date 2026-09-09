/**
 * Coerce a value to a number and round it; only falls back when the value is genuinely missing/NaN.
 */
export const safeRound = (val, fallback) => {
  const n = Number(val);
  return Number.isFinite(n) ? Math.round(n) : fallback;
};

/**
 * Format total seconds into MM:SS format.
 */
export const formatTime = (secs) => {
  const mins = Math.floor(secs / 60);
  const remaining = secs % 60;
  return `${mins.toString().padStart(2, "0")}:${remaining.toString().padStart(2, "0")}`;
};

/**
 * Convert a File/Blob to a base64 encoded string.
 */
export const blobToBase64 = (blob) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result.split(",")[1]);
      } else {
        reject(new Error("Failed to convert blob to base64 string"));
      }
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};
