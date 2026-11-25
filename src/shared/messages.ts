import type { VideoContext } from "./types";

export type ExtensionMessage =
  | { type: "LEARNLENS_VIDEO_CONTEXT"; payload: VideoContext }
  | { type: "LEARNLENS_GET_ACTIVE_CONTEXT" }
  | { type: "LEARNLENS_ACTIVE_CONTEXT_CHANGED"; payload: VideoContext | null };

export interface ActiveContextResponse {
  context: VideoContext | null;
}