
import React, { useEffect, useState, useRef } from 'react';
import { useSessionStore } from './stores/sessionStore';
import { useSettingsStore } from './stores/settingsStore';
import { useUIStore } from './stores/uiStore';
import OrbBreathViz from './components/OrbBreathViz';
import { useBreathEngine } from './hooks/useBreathEngine';
import { cleanupAudio, unlockAudio } from './services/audio';
import { BREATHING_PATTERNS, BreathingType } from './types';
import { TRANSLATIONS } from './translations';
import { Header } from './components/sections/Header';
import { Footer } from './components/sections/Footer';
import { ActiveSessionDisplay } from './components/sections/ActiveSessionDisplay';
import { OnboardingModal } from './components/modals/OnboardingModal';
import { SummaryModal } from './components/modals/SummaryModal';
import { HistorySheet } from './components/sections/HistorySheet';
import { SettingsSheet } from './components/sections/SettingsSheet';

export default function App() {
  // --- SELECTORS ---
  const isActive = useSessionStore(s => s.isActive);
  const isPaused = useSessionStore(s => s.isPaused);
  const phase = useSessionStore(s => s.phase);
  const currentPattern = useSessionStore(s => s.currentPattern);
  const lastSessionStats = useSessionStore(s => s.lastSessionStats);
  
  const userSettings = useSettingsStore(s => s.userSettings);
  const hasSeenOnboarding = useSettingsStore(s => s.hasSeenOnboarding);
  const completeOnboarding = useSettingsStore(s => s.completeOnboarding);

  const showSummary = useUIStore(s => s.showSummary);
  const setShowSummary = useUIStore(s => s.setShowSummary);

  // Core Engine (Biological OS Driver)
  const { progressRef, entropyRef } = useBreathEngine();
  
  const [selectedPatternId, setSelectedPatternId] = useState<BreathingType>(userSettings.lastUsedPattern || '4-7-8');
  
  useEffect(() => {
    setSelectedPatternId(userSettings.lastUsedPattern);
  }, [userSettings.lastUsedPattern]);

  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const t = TRANSLATIONS[userSettings.language] || TRANSLATIONS.en;

  useEffect(() => {
    if (lastSessionStats) {
      setShowSummary(true);
    }
  }, [lastSessionStats, setShowSummary]);

  const handleCloseSummary = () => {
    setShowSummary(false);
  };

  // GLOBAL AUDIO UNLOCKER
  useEffect(() => {
    const oneTimeUnlock = () => {
        unlockAudio();
    };
    window.addEventListener('click', oneTimeUnlock);
    window.addEventListener('touchstart', oneTimeUnlock);
    return () => {
        window.removeEventListener('click', oneTimeUnlock);
        window.removeEventListener('touchstart', oneTimeUnlock);
    };
  }, []);

  // Audio Cleanup
  useEffect(() => {
    if (!isActive) cleanupAudio();
  }, [isActive]);

  // ROBUST WAKE LOCK
  useEffect(() => {
    const requestWakeLock = async () => {
      if (!isActive || isPaused) {
        if (wakeLockRef.current) {
          wakeLockRef.current.release().catch(() => {});
          wakeLockRef.current = null;
        }
        return;
      }

      if ('wakeLock' in navigator && !wakeLockRef.current) {
        try {
          const lock = await navigator.wakeLock.request('screen');
          wakeLockRef.current = lock;
          lock.addEventListener('release', () => {
            wakeLockRef.current = null;
          });
        } catch (err) {
          console.warn("Wake Lock failed:", err);
        }
      }
    };

    requestWakeLock();

    const handleVis = () => {
      if (document.visibilityState === 'visible') {
        requestWakeLock();
      } else {
        if (wakeLockRef.current) {
          wakeLockRef.current.release().catch(() => {});
          wakeLockRef.current = null;
        }
      }
    };
    
    document.addEventListener('visibilitychange', handleVis);
    return () => {
      document.removeEventListener('visibilitychange', handleVis);
      if (wakeLockRef.current) wakeLockRef.current.release().catch(() => {});
    };
  }, [isActive, isPaused]);

  return (
    <div className="relative w-full min-h-dvh overflow-hidden bg-black text-white selection:bg-white/20 font-sans">
      
      {/* ---------------- LAYER 0: VISUAL CORTEX ---------------- */}
      <div className="absolute inset-0 z-0 flex items-center justify-center">
        <OrbBreathViz
          phase={phase}
          theme={isActive ? currentPattern.colorTheme : BREATHING_PATTERNS[selectedPatternId].colorTheme}
          quality={userSettings.quality}
          reduceMotion={userSettings.reduceMotion}
          progressRef={progressRef}
          entropyRef={entropyRef}
          isActive={isActive}
        />
      </div>

      {/* ---------------- LAYER 1: UI ORCHESTRATION ---------------- */}
      
      <Header />
      
      <ActiveSessionDisplay />
      
      <Footer 
        selectedPatternId={selectedPatternId} 
        setSelectedPatternId={setSelectedPatternId} 
      />

      {/* ---------------- OVERLAYS ---------------- */}
      
      {!hasSeenOnboarding && <OnboardingModal onComplete={completeOnboarding} t={t} />}
      
      {showSummary && lastSessionStats && (
        <SummaryModal 
            stats={lastSessionStats} 
            onClose={handleCloseSummary} 
            t={t} 
            streak={userSettings.streak} 
            language={userSettings.language}
        />
      )}

      <HistorySheet />
      <SettingsSheet />
      
    </div>
  );
}
