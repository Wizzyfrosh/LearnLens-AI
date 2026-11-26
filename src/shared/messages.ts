import type { TranscriptSegment, VideoContext } from "./types";

export type CaptionCaptureStatus = "idle" | "waiting_for_captions" | "capturing" | "unsupported" | "error";

export type AudioCaptureStatus = "idle" | "capturing" | "error";

export interface AudioCaptureStatusPayload {
  status: AudioCaptureStatus;
  message: string;
}

export interface AudioChunkPayload {
  videoId: string;
  sequence: number;
  mimeType: "audio/wav";
  dataBase64: string;
  captureElapsedSeconds: number;
  durationSeconds: number;
}

export interface CaptionCaptureStatusPayload {
  status: CaptionCaptureStatus;
  message: string;
}

export type ExtensionMessage =
  | { type: "LEARNLENS_VIDEO_CONTEXT"; payload: VideoContext | null }
  | { type: "LEARNLENS_GET_ACTIVE_CONTEXT" }
  | { type: "LEARNLENS_ACTIVE_CONTEXT_CHANGED"; payload: VideoContext | null }
  | { type: "LEARNLENS_START_CAPTION_CAPTURE"; tabId: number }
  | { type: "LEARNLENS_STOP_CAPTION_CAPTURE"; tabId: number }
  | { type: "LEARNLENS_START_AUDIO_CAPTURE"; tabId: number; videoId: string; streamId: string }
  | { type: "LEARNLENS_STOP_AUDIO_CAPTURE"; tabId: number }
  | { type: "LEARNLENS_OFFSCREEN_START_AUDIO_CAPTURE"; tabId: number; videoId: string; streamId: string }
  | { type: "LEARNLENS_OFFSCREEN_STOP_AUDIO_CAPTURE" }
  | { type: "LEARNLENS_AUDIO_CAPTURE_STATUS"; payload: AudioCaptureStatusPayload }
  | { type: "LEARNLENS_AUDIO_CHUNK"; payload: AudioChunkPayload }
  | { type: "LEARNLENS_CONTENT_START_CAPTION_CAPTURE" }
  | { type: "LEARNLENS_CONTENT_STOP_CAPTION_CAPTURE" }
  | { type: "LEARNLENS_OPEN_QUIZ_OVERLAY" }
  | { type: "LEARNLENS_CAPTURE_STATUS"; payload: CaptionCaptureStatusPayload }
  | { type: "LEARNLENS_CAPTION_SEGMENT"; payload: TranscriptSegment };

export interface ActiveContextResponse {
  context: VideoContext | null;
}