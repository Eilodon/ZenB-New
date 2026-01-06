
import React, { useEffect, useMemo, useRef } from 'react';
import { useSessionStore } from '../stores/sessionStore';
import { useSettingsStore } from '../stores/settingsStore';
import { BreathPhase, UserSettings } from '../types';
import { playCue } from '../services/audio';
import { hapticPhase } from '../services/haptics';
import { kernel, RuntimeState } from '../services/ZenBKernel';

type EngineRefs = {
  progressRef: React.MutableRefObject<number>;
  entropyRef: React.MutableRefObject<number>;
};

function phaseToCueType(phase: BreathPhase): 'inhale' | 'exhale' | 'hold' {
  if (phase === 'holdIn' || phase === 'holdOut') return 'hold';
  return phase;
}

/**
 * 🜂 ENGINE BRIDGE (DRIVER)
 * Connects the UI (React) to the Kernel (ZenBRuntime).
 * Acts as a translation layer between Biological States and Visual/Audio outputs.
 */
export function useBreathEngine(): EngineRefs {
  const isActive = useSessionStore((s) => s.isActive);
  const isPaused = useSessionStore((s) => s.isPaused);
  const currentPattern = useSessionStore((s) => s.currentPattern);
  const stopSession = useSessionStore((s) => s.stopSession);
  const syncState = useSessionStore((s) => s.syncState);
  
  const storeUserSettings = useSettingsStore((s) => s.userSettings);
  const settingsRef = useRef<UserSettings>(storeUserSettings);
  
  // Visual Interpolation
  const progressRef = useRef<number>(0);
  const entropyRef = useRef<number>(0); 
  
  const rafIdRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number>(0);
  const prevPhaseRef = useRef<BreathPhase>('inhale');

  // Sync Settings for Drivers
  useEffect(() => {
    settingsRef.current = storeUserSettings;
  }, [storeUserSettings]);

  // --- KERNEL COMMAND BUS ---
  
  // 1. Handle START / STOP
  useEffect(() => {
    if (isActive) {
        // Only load protocol on FRESH start
        kernel.dispatch({ type: 'LOAD_PROTOCOL', patternId: currentPattern.id, timestamp: Date.now() });
        kernel.dispatch({ type: 'START_SESSION', timestamp: Date.now() });
    } else {
        // Reset visual state
        progressRef.current = 0;
        prevPhaseRef.current = 'inhale';
        kernel.dispatch({ type: 'HALT', reason: 'cleanup', timestamp: Date.now() });
    }
  }, [isActive, currentPattern.id]);

  // 2. Handle PAUSE / RESUME (Separately to avoid resetting protocol)
  useEffect(() => {
    if (!isActive) return;

    if (isPaused) {
       kernel.dispatch({ type: 'USER_INTERRUPTION', kind: 'pause', timestamp: Date.now() });
    } else {
       kernel.dispatch({ type: 'RESUME_SESSION', timestamp: Date.now() });
    }
  }, [isPaused, isActive]);

  // --- KERNEL EVENT LISTENER (READ BUS) ---
  useEffect(() => {
      // Subscribe directly to the Kernel state stream
      const unsub = kernel.subscribe((state: RuntimeState) => {
          // Safety Lockout Driver
          if (state.status === 'SAFETY_LOCK') {
              console.warn("ZenB Safety Intervention Triggered");
              stopSession();
              return;
          }

          // Visual Bridge (High Frequency Update)
          const denom = Math.max(state.phaseDuration, 1e-6);
          progressRef.current = Math.max(0, Math.min(state.phaseElapsed / denom, 1));
          entropyRef.current = state.entropy;

          // Discrete State Sync (Low Frequency Update -> React State)
          // We only sync when phase or cycle ACTUALLY changes to avoid render thrashing
          if (state.phase !== prevPhaseRef.current || state.cycleCount !== useSessionStore.getState().cycleCount) {
              syncState(state.phase, state.cycleCount);
          }

          // Side Effects (Drivers)
          if (state.phase !== prevPhaseRef.current && state.status === 'RUNNING') {
                const st = settingsRef.current;
                const duration = state.phaseDuration;
                const cueType = phaseToCueType(state.phase);
                
                // Fire Drivers
                hapticPhase(st.hapticEnabled, st.hapticStrength, cueType);
                playCue(cueType, st.soundEnabled, st.soundPack, duration, st.language).catch(() => {});
                
                prevPhaseRef.current = state.phase;
          }
      });
      return unsub;
  }, [stopSession, syncState]);

  // --- MAIN LOOP (The Heartbeat) ---
  // Pumps the Kernel 'TICK' event
  const loop = (now: number) => {
    const dt = (now - lastTimeRef.current) / 1000;
    lastTimeRef.current = now;

    // Filter large jumps (tab sleep)
    if (dt > 0 && dt < 1.0) {
        kernel.dispatch({ type: 'TICK', dt, timestamp: Date.now() });
    }

    if (isActive && !isPaused) {
        rafIdRef.current = requestAnimationFrame(loop);
    }
  };

  useEffect(() => {
    if (isActive && !isPaused) {
      lastTimeRef.current = performance.now();
      rafIdRef.current = requestAnimationFrame(loop);
    } else {
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
    }
    return () => {
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
    };
  }, [isActive, isPaused]);

  return useMemo(() => ({ progressRef, entropyRef }), []);
}
