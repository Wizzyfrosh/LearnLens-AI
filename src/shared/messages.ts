import type { TranscriptSegment, VideoContext } from "./types";

export type CaptionCaptureStatus = "idle" | "waiting_for_captions" | "capturing" | "unsupported" | "error";

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
  | { type: "LEARNLENS_CONTENT_START_CAPTION_CAPTURE" }
  | { type: "LEARNLENS_CONTENT_STOP_CAPTION_CAPTURE" }
  | { type: "LEARNLENS_CAPTURE_STATUS"; payload: CaptionCaptureStatusPayload }
  | { type: "LEARNLENS_CAPTION_SEGMENT"; payload: TranscriptSegment };

export interface ActiveContextResponse {
  context: VideoContext | null;
}