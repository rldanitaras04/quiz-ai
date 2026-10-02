/**
 * Side-effect module: registers every provider that ships with the app.
 *
 * Import this (alias path `@/lib/identity/register`) anywhere the adapter
 * registry must be populated — the exam gate (src/lib/exam.ts) and the
 * student verification actions. Registration happens once per process via
 * module caching; the factories themselves only run when `IDENTITY_ADAPTER`
 * actually selects them, so an unselected provider costs nothing.
 *
 * The core registry (src/lib/identity-verification.ts) stays dependency-free
 * so tests can import it directly — provider wiring lives here instead.
 */
import { registerIdentityVerificationAdapter } from '../identity-verification';
import { createMediaPipeIdentityAdapter } from './mediapipe';

registerIdentityVerificationAdapter('mediapipe', createMediaPipeIdentityAdapter);
