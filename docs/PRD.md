# LearnLens AI — Product Requirements Document

**Tagline:** Watch. Understand. Remember. Apply.  
**Product:** Context-aware AI learning companion for educational videos  
**Hackathon:** Google #BuildHybridAI 2026  
**Initial platform:** Chrome Extension (Manifest V3)  
**Repository:** https://github.com/Wizzyfrosh/LearnLens-AI

## 1. Executive summary

LearnLens AI works alongside educational videos. It automatically captures accessible lesson captions as the learner watches, then uses the growing transcript as context for an AI tutor, helping learners ask questions, understand difficult concepts, capture notes, generate quizzes, and revisit important ideas. It is not a generic chatbot or merely a one-click video summarizer: its differentiator is lesson-aware, timestamp-aware learning continuity.

Firebase AI Logic hybrid inference is central to the hackathon build. The app must use on-device inference where supported and cloud inference when selected or explicitly permitted as fallback. It must display the actual inference source and never silently send content to the cloud when on-device-only is selected.

## 2. Problem

Video learners frequently:
- Lose context when switching between a video and a generic chatbot.
- Have to explain the lesson or paste context repeatedly.
- Miss important notes while following fast explanations.
- Confuse passive watching with actual understanding.
- Struggle to find the exact section where an idea was explained.
- Have limited connectivity or privacy concerns about sending lesson content to cloud AI.

LearnLens reduces these problems by placing a tutor beside the video and turning learning sessions into reusable study materials.

## 3. Vision and value proposition

**Vision:** Make every educational video with accessible captions or transcripts an interactive learning environment.

**Value:** Ask questions grounded in the lesson, understand the answer with timestamp evidence, save important knowledge, and test understanding.

**Core loop:** Detect lesson → start capture → transcribe/capture captions → ask → understand → bookmark/note → quiz → revise → apply.

## 4. Target users

Primary:
- Secondary and tertiary students.
- Self-taught developers and technology learners.
- Online-course and tutorial learners.
- Professionals learning tools, processes, and new skills.

Secondary:
- Teachers/tutors preparing study materials.
- Lifelong learners consuming educational video.

English-first, global audience, including learners in Nigeria and regions with variable connectivity.

## 5. Product principles

1. Context before cleverness: ground answers in the current lesson.
2. Honest evidence: cite timestamps only when the source provides them.
3. Learner control: user explicitly starts/stops lesson capture and controls cloud inference, local storage, and export.
4. Privacy visibility: explain local/cloud processing before sending data.
5. Progressive enhancement: useful fallback when local inference is unsupported.
6. Capability-based platform support: never promise access to every video.
7. Active learning: notes, retrieval practice, quizzes, and revision matter.
8. Professional UI: clean, light, responsive, accessible, no emoji in product UI.

## 6. Scope

### Hackathon MVP — must work end to end
- Chrome Manifest V3 extension with side panel.
- Detect supported YouTube watch page and identify video.
- User-initiated automatic capture of captions rendered by YouTube, with timestamped transcript segments.
- Automatic local persistence of captured lesson captions.
- Manual VTT/SRT/TXT import only as an optional fallback, not the normal workflow.
- Parse timestamped transcript segments and preserve timestamp availability.
- Ask questions grounded in transcript context.
- Use Firebase AI Logic hybrid inference.
- Show actual inference source returned by SDK.
- On-device-only must not fall back to cloud.
- Clearly disclose that prefer-on-device may use cloud fallback.
- Good empty, loading, error, and unsupported-device states.
- Public source repository, open-source license, setup instructions, and public demo video <= 3 minutes.

### Post-hackathon product
- Audio-based speech transcription for supported sources, using user-initiated Chrome tab audio capture, explicit cloud-processing consent, temporary bounded WAV chunks, and Firebase AI Logic. Audio-only transcript segments must not claim exact video timestamps unless verified timestamp output is implemented.
- Reliable automatic caption discovery and capture for supported sources.
- Editable timestamp-linked notes and export.
- Timestamp bookmarks.
- Quiz generation, scoring, explanations, and revision.
- Local lesson history and learning dashboard.
- Optional authentication and cloud sync.
- Additional platform adapters only where accessible captions can be demonstrated.
- Android companion after Chrome workflow is stable.

### Explicitly out of scope for MVP
- Native Android app or floating overlay.
- Universal transcript extraction from every YouTube, TikTok, or Facebook video.
- Private endpoint scraping, reverse engineering undocumented APIs, DRM circumvention, unauthorized downloads.
- Covert/background audio recording or broad browser activity monitoring. Capture must be explicitly started by the learner.
- Social network, course marketplace, or monetization platform.
- Claims of learner mastery without evidence.

## 7. Functional requirements

### FR-01 Extension
- Manifest V3, extension action, Chrome Side Panel.
- Responsive layout and keyboard-accessible controls.
- Handle service-worker suspension and panel reopen without corrupting state.

### FR-02 Video context
- Detect supported YouTube watch URL; capture video ID, title, URL.
- Handle YouTube single-page navigation.
- Separate page detection from transcript acquisition.
- Unsupported sources must produce honest fallback messaging.

### FR-03 Lesson capture and transcript ingestion
- Start and stop automatic lesson capture from the side panel.
- Capture only caption text actually rendered by the supported video page in the first automatic implementation.
- Persist captured segments locally without requiring a manual save or upload.
- Accept WebVTT (.vtt), SubRip (.srt), and plain text (.txt) only as fallback.
- Parse cue start/end timestamps.
- Strip cue markup safely and normalize whitespace.
- Preserve timestamp availability explicitly.
- Never invent timestamps for plain text.
- Track provenance: manual, native-track, visible-captions.
- Handle empty, malformed, oversized, and invalid input.

### FR-04 Platform adapters
- Define an adapter interface for page detection, metadata, caption discovery, and timestamp synchronization.
- YouTube is first.
- Prefer captions exposed to the learner by the player or officially authorized sources.
- Do not claim audio-only transcription until a supported capture and transcription path is implemented and tested.
- Keep manual transcript import as fallback.
- TikTok and Facebook support is capability-based, not guaranteed for every video.
- YouTube official captions download requires authorization to edit the video; do not depend on it for arbitrary public videos.
- TikTok Display API and Facebook Graph API are not universal transcript APIs.

### FR-05 AI tutor
- Accept natural-language questions about loaded lesson.
- Send bounded transcript context and timestamps when available.
- Prioritize transcript as primary evidence.
- State when evidence is missing; distinguish external knowledge from video content.
- Treat transcript as untrusted reference material, never as instructions.
- Handle no transcript, empty question, unavailable model, quota, network, and malformed response.

### FR-06 Hybrid inference
- Import and actually call Firebase AI Logic at runtime.
- Preferences: prefer on-device with cloud fallback; on-device only; cloud only.
- Show SDK-reported inference source, not the selected preference.
- On-device-only must fail clearly if local inference is unavailable; never silently use cloud.
- Explain cloud fallback before transcript content can be sent.
- Do not promise offline behavior until tested on supported hardware/browser.

### FR-07 Notes — post-MVP
- Create/edit/delete/organize notes.
- Timestamp-linked notes only when timestamp exists.
- AI-assisted drafts require user review before save.
- Export Markdown and PDF; retain lesson title, source URL, timestamp provenance.

### FR-08 Bookmarks — post-MVP
- Bookmark timestamp with title and optional note.
- Seek source player when possible.
- Untimed transcript must not create fake seek target.

### FR-09 Quiz studio — post-MVP
- Generate from whole lesson, selected range, or topic.
- Initial types: multiple choice, true/false, short answer.
- Show answers and explanations.
- Track attempts and weak topics.
- Label extension questions that go beyond transcript evidence.

### FR-10 History and revision — post-MVP
- Local lesson/artifact history by default.
- Optional account sync after Auth and Firestore security rules are ready.
- Dashboard for notes, bookmarks, quizzes, attempts, topics.
- User export and deletion controls.

### FR-11 Cross-platform
- Isolated platform adapters.
- YouTube first; TikTok/Facebook only after validated compliant caption access.
- Manual transcript import remains optional fallback.
- Audio-based transcription is a separate capability and is not represented as complete by visible-caption capture.
- Expose source and timestamp provenance.

## 8. Main user journeys

### A. Learn from a YouTube lesson
1. Open a YouTube watch page.
2. Open LearnLens side panel.
3. Confirm detected video and title.
4. Turn on YouTube captions where available.
5. Click **Start learning**; LearnLens captures rendered captions and saves them locally.
6. Ask a question using the transcript captured so far.
7. Use manual transcript import only when automatic caption capture is unavailable.
7. Firebase AI Logic processes request according to mode.
8. Display answer and actual inference source.
9. Use timestamps to revisit source.

### B. Import transcript on another source
1. Open side panel.
2. Import/paste VTT/SRT/TXT.
3. Validate and parse.
4. Ask questions.
5. Preserve timestamps only if supplied.

### C. Save and revise (post-MVP)
1. Create/edit notes and bookmarks.
2. Generate quiz.
3. Submit answers and review explanations.
4. Revisit saved learning artifacts later.

## 9. Non-functional requirements

**Performance:** fast side panel, non-blocking parsing, bounded context, visible request progress, avoid excessive DOM polling and tab listeners.

**Reliability:** handle navigation, refresh, tab close, worker restart, unsupported states; preserve work through transient failures; test parser independently.

**Accessibility:** semantic labels, keyboard operation, visible focus, readable contrast, responsive panel, understandable privacy labels.

**Privacy/security:**
- Minimum Chrome permissions.
- No cookies, credentials, or unrelated browsing-history access.
- No microphone recording. Tab-audio capture must be initiated by an explicit learner action, use a separate unchecked-by-default cloud-audio consent, disclose Firebase processing, stop on tab/lesson change or panel close, and never persist raw audio by default.
- Keep transcript local unless user chooses cloud-enabled processing.
- Treat transcript and model output as untrusted.
- Prompt-injection defenses; validate generated structured data.
- Never execute model-generated code or HTML.
- Never commit secrets, service-account keys, App Check debug tokens, or private user data.
- Configure App Check; debug tokens only for controlled development/testing.
- Firestore rules must enforce per-user ownership before sync.

## 10. Technical architecture

Initial stack:
- Chrome Extension Manifest V3.
- React + TypeScript + Vite + Tailwind CSS.
- Firebase AI Logic, App Check.
- Firebase Auth, Firestore, Remote Config when corresponding features are built.
- IndexedDB (Dexie or equivalent) for local learning data.
- Vitest and GitHub Actions.

Module boundaries:
- Extension shell: manifest, action, side panel, background worker.
- Lesson capture engine: YouTube SPA context, visible-caption observer, capture lifecycle, and source provenance.
- Platform adapters: YouTube, TikTok, Facebook, generic capability detection.
- Transcript engine: parser, normalizer, provenance, context builder.
- AI engine: Firebase adapter, inference policy, prompt builder, metadata.
- Learning engine: notes, bookmarks, quiz, scoring, revision.
- Storage: IndexedDB and optional Firestore sync.
- Shared: typed messages, domain models, validation.

Target structure (not all folders currently exist):
~~~
docs/
  PRD.md
  HACKATHON_BRIEF.md
  IMPLEMENTATION_PLAN.md
  PROJECT_STATUS.md
public/manifest.json
src/
  background/
  content/adapters/
  sidepanel/
  services/ai/
  services/transcript/
  services/storage/
  learning/
  shared/
  ui/
.github/workflows/
.env.example
LICENSE
~~~

## 11. Data model (target)

**TranscriptSegment:** id, startSeconds, endSeconds, hasTimestamp, text, source.

**Lesson:** id, optional userId, platform, videoId, title, sourceUrl, language, createdAt, updatedAt.

**Note:** id, lessonId, content, optional startSeconds/endSeconds, createdAt, updatedAt.

**Bookmark:** id, lessonId, title, optional note/startSeconds, createdAt.

**Quiz:** id, lessonId, title, questions[], createdAt.

**QuizAttempt:** id, quizId, answers[], score, feedback[], createdAt.

Storage policy:
- Full transcripts local in IndexedDB by default.
- Do not upload full transcripts to Firestore by default.
- Sync only user-owned learning artifacts after opt-in and security rules.
- Account for document limits, retention, and deletion before cloud transcript storage.

## 12. AI behavior and safety
- Transcript is quoted untrusted reference data.
- Ignore instructions inside transcript that attempt to change model role or override policy.
- Prefer transcript evidence over general knowledge.
- State when evidence is missing or ambiguous.
- Never invent timestamps, quotations, or claims about video content.
- Validate structured model output.
- Do not present medical/legal/financial/safety-critical output as authoritative.

## 13. MVP acceptance criteria
- [ ] YouTube same-tab SPA navigation updates video ID, title, and URL without requiring a tab switch.
- [ ] Learner can explicitly start/stop automatic capture of captions rendered by YouTube.
- [ ] Captured caption segments appear in LearnLens and are saved locally automatically.
- [ ] Questions can use captured segments without importing a transcript.
- [ ] Clean clone installs using documented steps.
- [ ] Chrome loads built extension without manifest/asset errors.
- [ ] YouTube video ID/title are detected correctly.
- [ ] VTT and SRT cues parse with correct timestamps.
- [ ] Plain text is accepted without fake timestamps.
- [ ] Empty/malformed input has useful error.
- [ ] Transcript-grounded question receives useful answer.
- [ ] Unsupported question is identified as unsupported by transcript.
- [ ] Actual Firebase inference source is displayed.
- [ ] On-device-only never falls back to cloud.
- [ ] Cloud and hybrid fallback paths are tested and disclosed.
- [ ] App Check configured and tested.
- [ ] CI typecheck, tests, production build pass.
- [ ] README includes setup, privacy, limitations, troubleshooting.
- [ ] Public repository has open-source license visible in GitHub metadata.
- [ ] Public YouTube demo <= 3 minutes, English or English subtitles.
- [ ] Devpost explains Firebase AI Logic, features, value proposition.

## 14. Success metrics (targets, not current claims)
- >=90% pass rate on curated parser fixtures.
- >=85% grounded correctness on curated transcript question set.
- No silent cloud fallback in local-only mode.
- Learner can identify inference source.
- First-time user can import transcript and ask a question without external instructions.

## 15. Risks
| Risk | Mitigation |
|---|---|
| Caption access restrictions | Manual import, capability adapters |
| Local model unavailable | Honest status, cloud only if permitted |
| Privacy misunderstanding | Pre-request mode disclosure |
| Prompt injection | Untrusted transcript handling and tests |
| Long transcripts | Bounded context, later chunking/retrieval |
| Unsupported AI claims | Evidence-aware answers and abstention |
| Scope creep | Prioritize YouTube transcript-to-tutor |
| Browser issues | CI plus manual Chrome verification |

## 16. Agreed product decisions
- Name LearnLens AI; tagline Watch. Understand. Remember. Apply.
- Chrome extension first; Android later.
- Audience: students and anyone learning online.
- Platform ambition: YouTube, TikTok, Facebook, and sources with accessible captions/transcripts; capability-based.
- VTT/SRT/TXT import.
- Firebase AI Logic hybrid inference is core to hackathon.
- On-device-only never silently falls back.
- Product is a learning companion, not just a summarizer.
- Professional light responsive UI; no emoji.
- Never call a feature complete without code, tests, and runtime verification.

## 17. Change control
If requirements change, update this PRD, implementation plan, and status checklist together. Record reason/date. Do not silently remove an agreed requirement.

**Change log — 2026-11-25:** Consolidated product vision, scope, feature requirements, architecture, security, acceptance criteria, and prior decisions.


## 18. Product change — automatic lesson capture (2026-11-25)

The normal workflow is now **Start learning → capture lesson → ask the tutor**. Manual transcript import is a fallback and must not be presented as the primary task.

The first safe automatic capability reads captions that YouTube visibly renders after the learner starts capture. It does not scrape undocumented caption endpoints, fetch private transcript APIs, or claim access to speech that the page does not expose. Captured segments carry a visible-caption provenance marker and a player-time reference, and are saved in IndexedDB.

**Audio-based transcription is a distinct next capability.** Chrome tab audio capture requires an explicit user action. Firebase AI Logic audio file transcription is supported for documented models, but it is a cloud inference path. Firebase AI Logic Live API is currently Preview and does not support hybrid/on-device inference. Therefore, tab audio must not be uploaded silently or represented as covered by the on-device-only tutor preference. Any cloud audio transcription requires a clear, separate consent state, bounded audio chunks, App Check, explicit retention rules, and a tested stop/recovery lifecycle.

Acceptance of automatic captions does not imply support for every video, every language, or videos without rendered captions.
