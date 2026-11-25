import type { VideoContext } from "./types";

export type ExtensionMessage =
  | { type: "LEARNLENS_VIDEO_CONTEXT"; payload: VideoContext }
  | { type: "LEARNLENS_GET_ACTIVE_CONTEXT" };

export interface ActiveContextResponse {
  context: VideoContext | null;
}