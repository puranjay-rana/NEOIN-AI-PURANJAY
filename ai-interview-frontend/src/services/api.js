import { API_URL } from "../config/constants";

/**
 * Upload candidate resume PDF to the backend for text extraction.
 * @param {File} resumeFile 
 * @returns {Promise<string>} extracted resume text
 */
export const uploadResumeApi = async (resumeFile) => {
  if (!resumeFile) throw new Error("Please select a PDF resume.");

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

  return extractedText;
};
