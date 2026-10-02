'use client';

/**
 * Browser-side liveness capture (scope §5, paired with
 * `completeIdentityVerification` in ./actions.ts).
 *
 * Runs Google MediaPipe Tasks (`@mediapipe/tasks-vision`, FaceLandmarker)
 * ENTIRELY ON DEVICE: the camera frames never leave this tab — only the
 * coarse evidence below is sent to the server (challenge outcomes + timing,
 * no frames, no landmarks, no templates).
 *
 * Liveness is CHALLENGE-RESPONSE, not blink-only: the server picks the
 * challenges (`prepareCapture`), the engine below drives the taker through
 * each one from landmarks/blendshapes and enforces per-challenge and
 * session time windows. Face-presence is tracked for the whole session.
 *
 * Direction note: detection runs on raw (unmirrored) frames while the
 * preview is mirrored for the taker, so "turn your head to your left"
 * corresponds to the nose moving toward larger raw x.
 */

import { useEffect, useRef, useState, type JSX } from 'react';
import type { FaceLandmarker } from '@mediapipe/tasks-vision';
import Button from '@/components/ui/Button';

export interface EvidencePayload {
  passed: true;
  model: 'face_landmarker';
  totalDurationMs: number;
  facePresenceMs: number;
  challengeResults: Array<{ challenge: string; ok: true; durationMs: number }>;
}

interface CaptureStageProps {
  /** Server-minted session token from `startIdentityVerification`. */
  token: string;
  /** Server-chosen challenges, in issue order. */
  challenges: string[];
  /** All challenges passed — parent settles the session server-side. */
  onCaptured: (evidence: EvidencePayload) => void;
  /** Abort: parent tears this component down (camera stops on unmount). */
  onCancel: () => void;
}

/** Keep in sync with the installed @mediapipe/tasks-vision version. */
const WASM_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

/** Per-challenge and whole-session windows (server mirrors these bounds). */
const CHALLENGE_WINDOW_MS = 15_000;
const SESSION_WINDOW_MS = 60_000;
/** Never submit a session shorter than the server's 3 s floor. */
const MIN_SESSION_MS = 3_500;

/** Blendshape / hold thresholds. */
const BLINK_CLOSED = 0.5;
const BLINK_OPEN = 0.4;
const BLINK_HELD_MS = 120;
const MOUTH_OPEN = 0.45;
const MOUTH_CLOSED = 0.3;
const MOUTH_HELD_MS = 150;
const TURN_MARGIN_RATIO = 0.15;
const TURN_HELD_MS = 300;

const CHALLENGE_LABELS: Record<string, string> = {
  blink: 'Blink both eyes',
  mouth_open: 'Open your mouth, then close it',
  turn_left: 'Turn your head to your left',
  turn_right: 'Turn your head to your right',
};

/** Landmark indices (MediaPipe FaceMesh canonical topology). */
const NOSE_TIP = 1;
const CHEEK_A = 234;
const CHEEK_B = 454;

type Stage = 'camera' | 'model' | 'running' | 'stopped';

interface Engine {
  running: boolean;
  finished: boolean;
  sessionStart: number;
  presenceTs: number;
  presenceMs: number;
  lastVideoTime: number;
  challengeStart: number;
  blinkHighSince: number | null;
  mouthHighSince: number | null;
  turnSince: number | null;
  index: number;
  results: Array<{ challenge: string; ok: true; durationMs: number }>;
}

function blendshapeScore(
  categories: Array<{ categoryName: string; score: number }> | undefined,
  name: string
): number {
  if (!categories) return 0;
  for (const c of categories) if (c.categoryName === name) return c.score;
  return 0;
}

export default function CaptureStage({
  token,
  challenges,
  onCaptured,
  onCancel,
}: CaptureStageProps): JSX.Element {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const landmarkerRef = useRef<FaceLandmarker | null>(null);
  const rafRef = useRef<number | null>(null);
  const engineRef = useRef<Engine | null>(null);
  const onCapturedRef = useRef(onCaptured);
  useEffect(() => {
    onCapturedRef.current = onCaptured;
  }, [onCaptured]);

  const [stage, setStage] = useState<Stage>('camera');
  const [index, setIndex] = useState(0);
  const [facePresent, setFacePresent] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;

    const engine: Engine = {
      running: false,
      finished: false,
      sessionStart: 0,
      presenceTs: 0,
      presenceMs: 0,
      lastVideoTime: -1,
      challengeStart: 0,
      blinkHighSince: null,
      mouthHighSince: null,
      turnSince: null,
      index: 0,
      results: [],
    };
    engineRef.current = engine;

    const teardown = (): void => {
      engine.running = false;
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      landmarkerRef.current?.close();
      landmarkerRef.current = null;
      setFacePresent(false);
    };

    const fail = (message: string): void => {
      teardown();
      setFailed(message);
    };

    const finish = (): void => {
      if (engine.finished) return;
      engine.finished = true;
      const total = Math.round(performance.now() - engine.sessionStart);
      teardown();
      onCapturedRef.current({
        passed: true,
        model: 'face_landmarker',
        totalDurationMs: total,
        facePresenceMs: Math.round(Math.min(engine.presenceMs, total)),
        challengeResults: engine.results,
      });
    };

    const completeChallenge = (now: number): void => {
      engine.results.push({
        challenge: challenges[engine.index],
        ok: true,
        durationMs: Math.round(now - engine.challengeStart),
      });
      engine.index += 1;
      engine.challengeStart = now;
      engine.blinkHighSince = null;
      engine.mouthHighSince = null;
      engine.turnSince = null;
      setIndex(engine.index);
    };

    const processFrame = (now: number): void => {
      const video = videoRef.current;
      const landmarker = landmarkerRef.current;
      if (!video || !landmarker) return;
      if (video.readyState < 2 || video.currentTime === engine.lastVideoTime) return;
      engine.lastVideoTime = video.currentTime;

      let result: ReturnType<FaceLandmarker['detectForVideo']> | null = null;
      try {
        result = landmarker.detectForVideo(video, now);
      } catch {
        result = null; // transient model error — skip the frame
      }

      const dt = engine.presenceTs ? now - engine.presenceTs : 0;
      engine.presenceTs = now;

      const landmarks = result?.faceLandmarks;
      const present = !!landmarks && landmarks.length > 0;
      setFacePresent(present);
      if (present) engine.presenceMs += Math.min(dt, 250);

      if (!engine.running) return;

      // Session / challenge windows apply once the challenges start; the
      // face only needs to APPEAR (a slow camera or model must not fail
      // the student — absence beyond the challenge window fails them).
      if (engine.challengeStart > 0) {
        if (now - engine.challengeStart > CHALLENGE_WINDOW_MS) {
          fail('A challenge timed out. Please try again.');
          return;
        }
        if (now - engine.sessionStart > SESSION_WINDOW_MS) {
          fail('Verification took too long. Please try again.');
          return;
        }
      }

      if (engine.index >= challenges.length) {
        // All challenges done: let the session reach the minimum length so
        // the server-side duration floor is satisfied honestly.
        if (now - engine.sessionStart >= MIN_SESSION_MS) finish();
        return;
      }

      if (!present || !landmarks || landmarks.length === 0) return;
      const points = landmarks[0];
      const categories = result?.faceBlendshapes?.[0]?.categories;
      const current = challenges[engine.index];

      if (current === 'blink') {
        const closed =
          blendshapeScore(categories, 'eyeBlinkLeft') > BLINK_CLOSED &&
          blendshapeScore(categories, 'eyeBlinkRight') > BLINK_CLOSED;
        const open =
          blendshapeScore(categories, 'eyeBlinkLeft') < BLINK_OPEN &&
          blendshapeScore(categories, 'eyeBlinkRight') < BLINK_OPEN;
        if (engine.blinkHighSince === null) {
          if (closed) engine.blinkHighSince = now;
        } else if (open) {
          if (now - engine.blinkHighSince >= BLINK_HELD_MS) completeChallenge(now);
          else engine.blinkHighSince = null;
        }
      } else if (current === 'mouth_open') {
        const jaw = blendshapeScore(categories, 'jawOpen');
        if (engine.mouthHighSince === null) {
          if (jaw > MOUTH_OPEN) engine.mouthHighSince = now;
        } else if (jaw < MOUTH_CLOSED) {
          if (now - engine.mouthHighSince >= MOUTH_HELD_MS) completeChallenge(now);
          else engine.mouthHighSince = null;
        }
      } else if (current === 'turn_left' || current === 'turn_right') {
        if (points.length > CHEEK_B) {
          const nose = points[NOSE_TIP];
          const a = points[CHEEK_A];
          const b = points[CHEEK_B];
          const width = Math.abs(a.x - b.x);
          const center = (a.x + b.x) / 2;
          const margin = TURN_MARGIN_RATIO * width;
          const towardLeft = nose.x > center + margin;
          const towardRight = nose.x < center - margin;
          const wanted = current === 'turn_left' ? towardLeft : towardRight;
          if (wanted) {
            if (engine.turnSince === null) engine.turnSince = now;
            else if (now - engine.turnSince >= TURN_HELD_MS) completeChallenge(now);
          } else {
            engine.turnSince = null;
          }
        }
      }
    };

    const loop = (): void => {
      if (!engine.running) return;
      processFrame(performance.now());
      rafRef.current = requestAnimationFrame(loop);
    };

    (async () => {
      try {
        setStage('camera');
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        });
        if (disposed) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play().catch(() => undefined);
        }

        setStage('model');
        const vision = await import('@mediapipe/tasks-vision');
        const fileset = await vision.FilesetResolver.forVisionTasks(WASM_BASE);
        const options = {
          baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' as const },
          runningMode: 'VIDEO' as const,
          numFaces: 1,
          outputFaceBlendshapes: true,
          minFaceDetectionConfidence: 0.5,
          minFacePresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        };
        let landmarker: FaceLandmarker;
        try {
          landmarker = await vision.FaceLandmarker.createFromOptions(fileset, options);
        } catch {
          // Some devices have no usable WebGL — retry on CPU.
          landmarker = await vision.FaceLandmarker.createFromOptions(fileset, {
            ...options,
            baseOptions: { ...options.baseOptions, delegate: 'CPU' as const },
          });
        }
        if (disposed) {
          landmarker.close();
          return;
        }
        landmarkerRef.current = landmarker;

        engine.sessionStart = performance.now();
        engine.presenceTs = engine.sessionStart;
        engine.challengeStart = engine.sessionStart;
        engine.running = true;
        setStage('running');
        rafRef.current = requestAnimationFrame(loop);
      } catch (err) {
        if (disposed) return;
        const name = err instanceof Error ? `${err.name} ${err.message}` : '';
        if (/Permission|NotAllowed|NotFoundError/i.test(name)) {
          fail(
            /NotFound/i.test(name)
              ? 'No camera was found. Use a device with a camera, or ask your instructor to verify you manually.'
              : 'Camera access was denied. Allow camera access and try again, or ask your instructor to verify you manually.'
          );
        } else {
          fail('Could not load the face-tracking model. Check your connection and try again.');
        }
      }
    })();

    return () => {
      disposed = true;
      teardown();
    };
  }, [token, challenges]);

  return (
    <div className="space-y-4">
      <div className="relative aspect-[4/3] max-w-xl overflow-hidden rounded-lg border border-[var(--color-border)] bg-black">
        <video
          ref={videoRef}
          muted
          playsInline
          autoPlay
          className="h-full w-full object-cover scale-x-[-1]"
        />
        {stage !== 'running' && !failed && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-sm text-white/90">
            {stage === 'camera' ? 'Starting camera…' : 'Loading face detection…'}
          </div>
        )}
        {stage === 'running' && (
          <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-black/60 px-3 py-2 text-xs text-white">
            <span className="flex items-center gap-2">
              <span
                className={`inline-block h-2 w-2 rounded-full ${facePresent ? 'bg-[var(--color-success)]' : 'bg-[var(--color-warning)]'}`}
              />
              {facePresent ? 'Face detected' : 'Looking for your face…'}
            </span>
            <span>
              Step {Math.min(index + 1, challenges.length)} of {challenges.length}
            </span>
          </div>
        )}
      </div>

      <div className="max-w-xl space-y-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        {failed ? (
          <p className="text-sm text-[var(--color-danger)]">{failed}</p>
        ) : (
          <>
            <p className="text-xs uppercase tracking-wide text-[var(--color-muted)]">
              Challenge {Math.min(index + 1, challenges.length)} of {challenges.length}
            </p>
            <p className="text-lg font-semibold">
              {CHALLENGE_LABELS[challenges[Math.min(index, challenges.length - 1)]] ?? 'Follow the instruction'}
            </p>
            <ul className="space-y-1 text-sm">
              {challenges.map((c, i) => (
                <li
                  key={c}
                  className={
                    i < index
                      ? 'text-[var(--color-success)]'
                      : i === index
                        ? 'text-[var(--color-foreground)]'
                        : 'text-[var(--color-muted)]'
                  }
                >
                  {i < index ? '✓ ' : `${i + 1}. `}
                  {CHALLENGE_LABELS[c] ?? c}
                </li>
              ))}
            </ul>
          </>
        )}
        <Button variant="secondary" onClick={onCancel}>
          {failed ? 'Close' : 'Cancel'}
        </Button>
      </div>
    </div>
  );
}
