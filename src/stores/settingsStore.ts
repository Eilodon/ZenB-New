
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { UserSettings, SessionHistoryItem, ColorTheme, QualityTier, Language, SoundPack, BreathingType, TraumaRecord } from '../types';
import { kernel } from '../services/ZenBKernel';

type SettingsState = {
  userSettings: UserSettings;
  history: SessionHistoryItem[];
  hasSeenOnboarding: boolean;

  // Actions
  toggleSound: () => void;
  toggleHaptic: () => void;
  setHapticStrength: (s: UserSettings['hapticStrength']) => void;
  setTheme: (t: ColorTheme) => void;
  setQuality: (q: QualityTier) => void;
  setReduceMotion: (v: boolean) => void;
  toggleTimer: () => void;
  setLanguage: (l: Language) => void;
  setSoundPack: (p: SoundPack) => void;
  completeOnboarding: () => void;
  clearHistory: () => void;
  setLastUsedPattern: (p: BreathingType) => void;
  
  // Logic
  registerSessionComplete: (durationSec: number, patternId: BreathingType, cycles: number) => void;
};

const getTodayString = () => {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
};

const getYesterdayString = () => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      userSettings: {
        soundEnabled: true,
        hapticEnabled: true,
        hapticStrength: 'medium',
        theme: 'neutral',
        quality: 'auto',
        reduceMotion: false,
        showTimer: true,
        language: 'en',
        soundPack: 'musical',
        streak: 0,
        lastBreathDate: '',
        lastUsedPattern: '4-7-8',
        traumaRegistry: {}
      },
      history: [],
      hasSeenOnboarding: false,

      toggleSound: () => set((s) => ({ userSettings: { ...s.userSettings, soundEnabled: !s.userSettings.soundEnabled } })),
      toggleHaptic: () => set((s) => ({ userSettings: { ...s.userSettings, hapticEnabled: !s.userSettings.hapticEnabled } })),
      setHapticStrength: (s) => set((s) => ({ userSettings: { ...s.userSettings, hapticStrength: s } })),
      setTheme: (t) => set((s) => ({ userSettings: { ...s.userSettings, theme: t } })),
      setQuality: (q) => set((s) => ({ userSettings: { ...s.userSettings, quality: q } })),
      setReduceMotion: (v) => set((s) => ({ userSettings: { ...s.userSettings, reduceMotion: v } })),
      toggleTimer: () => set((s) => ({ userSettings: { ...s.userSettings, showTimer: !s.userSettings.showTimer } })),
      setLanguage: (l) => set((s) => ({ userSettings: { ...s.userSettings, language: l } })),
      setSoundPack: (p) => set((s) => ({ userSettings: { ...s.userSettings, soundPack: p } })),
      completeOnboarding: () => set({ hasSeenOnboarding: true }),
      clearHistory: () => set({ history: [] }),
      setLastUsedPattern: (p) => set((s) => ({ userSettings: { ...s.userSettings, lastUsedPattern: p } })),

      registerSessionComplete: (durationSec, patternId, cycles) => {
        const state = get();
        const kernelState = kernel.getState(); // Snapshot biological state

        // --- TRAUMA REGISTRY UPDATE ---
        // Success definition: > 45s AND Final Entropy < 0.5 (Controlled State)
        const isSuccess = durationSec > 45 && kernelState.entropy < 0.5;
        const registry = { ...state.userSettings.traumaRegistry };
        
        const record: TraumaRecord = registry[patternId] || {
            patternId,
            total_exposure_seconds: 0,
            adverse_events: 0,
            resonance_score: 0.5,
            last_updated: Date.now()
        };

        record.total_exposure_seconds += durationSec;
        record.last_updated = Date.now();

        if (isSuccess) {
            // Reinforcement Learning: Reward
            record.resonance_score = Math.min(1.0, record.resonance_score + 0.05);
        } else {
            // Punishment (Adverse Event)
            record.adverse_events += 1;
            record.resonance_score = Math.max(0.0, record.resonance_score - 0.1);
        }
        registry[patternId] = record;
        
        // Push updated registry to Kernel (Safety Plane)
        kernel.setSafetyRegistry(registry);

        // --- HISTORY & STREAK ---
        let newHistory = state.history;
        if (durationSec > 10) {
            const newItem: SessionHistoryItem = {
                id: Date.now().toString() + Math.random().toString().slice(2, 6),
                timestamp: Date.now(),
                durationSec,
                patternId,
                cycles,
                finalBelief: kernelState.belief
            };
            newHistory = [newItem, ...state.history].slice(0, 100);
        }

        let newStreak = state.userSettings.streak;
        let newLastDate = state.userSettings.lastBreathDate;
        
        if (durationSec > 30) {
            const today = getTodayString();
            const yesterday = getYesterdayString();
            
            if (newLastDate === today) {
                // Already breathed today
            } else if (newLastDate === yesterday) {
                newStreak += 1;
                newLastDate = today;
            } else {
                newStreak = 1;
                newLastDate = today;
            }
        }

        set({
            history: newHistory,
            userSettings: {
                ...state.userSettings,
                streak: newStreak,
                lastBreathDate: newLastDate,
                lastUsedPattern: patternId,
                traumaRegistry: registry
            }
        });
      }
    }),
    {
      name: 'zenb-settings-storage',
      partialize: (state) => ({ 
        userSettings: state.userSettings, 
        hasSeenOnboarding: state.hasSeenOnboarding,
        history: state.history
      }),
      onRehydrateStorage: () => (state) => {
         // Bootloader: Inject saved safety constraints into Kernel on app start
         if (state && state.userSettings) {
             kernel.setSafetyRegistry(state.userSettings.traumaRegistry);
         }
      }
    }
  )
);
