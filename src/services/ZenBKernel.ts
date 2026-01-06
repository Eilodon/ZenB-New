
import { BreathPattern, BreathPhase, KernelEvent, BeliefState, Observation, TraumaRecord, BREATHING_PATTERNS } from "../types";
import { nextPhaseSkipZero, isCycleBoundary } from "./phaseMachine";

/**
 * 🜂 ZENB KERNEL (The Biological Operating System)
 * 
 * Architecture:
 * 1. Event Log (Source of Truth)
 * 2. Active Inference Model (Controller)
 * 3. Safety Guards (Middleware)
 */

export type RuntimeState = {
  status: 'IDLE' | 'RUNNING' | 'PAUSED' | 'HALTED' | 'SAFETY_LOCK';
  pattern: BreathPattern | null;
  phase: BreathPhase;
  phaseElapsed: number;
  phaseDuration: number;
  cycleCount: number;
  sessionDuration: number;
  
  // The Internal Model (Bayesian Beliefs)
  belief: BeliefState;
  
  // System Metrics
  entropy: number; // Derived from belief (Variational Free Energy)
};

// --- SUBSYSTEM: ACTIVE INFERENCE MODEL ---
class ActiveInferenceModel {
  // Minimizes Free Energy (Stress/Entropy) by matching internal rhythm to reality
  
  public update(currentBelief: BeliefState, observation: Observation, isRunning: boolean): BeliefState {
    const dt = observation.delta_time;
    let { arousal, attention, rhythm_alignment } = currentBelief;

    if (!isRunning) {
        // Decay to baseline when idle
        arousal = Math.max(0, arousal - (0.1 * dt));
        attention = Math.max(0, attention - (0.2 * dt));
        rhythm_alignment = Math.max(0, rhythm_alignment - (0.1 * dt));
        return { arousal, attention, rhythm_alignment };
    }

    // 1. Perception (Sensory Input)
    const isInterrupted = observation.visibilty_state === 'hidden' || observation.user_interaction === 'pause';
    
    // 2. Prediction Error Processing
    if (isInterrupted) {
        // High Surprise -> Increased Entropy/Arousal
        arousal = Math.min(1.0, arousal + (0.3 * dt)); 
        attention = Math.max(0.0, attention - (0.5 * dt));
        rhythm_alignment = Math.max(0.0, rhythm_alignment - (0.4 * dt));
    } else {
        // Flow State -> Deepening Resonance
        arousal = Math.max(0.0, arousal - (0.05 * dt)); // Calming down
        attention = Math.min(1.0, attention + (0.1 * dt)); // Focus increasing
        rhythm_alignment = Math.min(1.0, rhythm_alignment + (0.2 * dt)); // Syncing
    }

    return { arousal, attention, rhythm_alignment };
  }

  public calculateEntropy(belief: BeliefState): number {
    // Entropy is high when Arousal is high AND Alignment is low.
    // H = Arousal * (1 - Alignment)
    return Math.min(1.0, Math.max(0, belief.arousal * (1.0 - (belief.rhythm_alignment * 0.8))));
  }
}

// --- SUBSYSTEM: SAFETY GUARD ---
class HippocraticGuard {
  // "First, do no harm"
  
  public check(state: RuntimeState, registry: Record<string, TraumaRecord>): KernelEvent | null {
    if (!state.pattern) return null;

    // Guard 1: Trauma Resonance Check
    // If user previously failed this pattern often, and current entropy is spiking -> HALT
    const record = registry[state.pattern.id];
    if (record && record.resonance_score < 0.3) {
       if (state.entropy > 0.8) {
           return { 
               type: 'SAFETY_INTERVENTION', 
               riskLevel: 0.9, 
               action: 'HALT_PREVENTATIVE',
               timestamp: Date.now() 
           };
       }
    }

    // Guard 2: Hyperventilation Watchdog
    // If cycle count is high on an energetic pattern and arousal is peaking
    if (state.pattern.tier === 2 && state.cycleCount > 30 && state.belief.arousal > 0.9) {
        return {
            type: 'SAFETY_INTERVENTION',
            riskLevel: 0.8,
            action: 'COOLDOWN_FORCED',
            timestamp: Date.now()
        };
    }

    return null;
  }
}

// --- KERNEL IMPLEMENTATION ---

class ZenBKernel {
  private state: RuntimeState;
  private eventLog: KernelEvent[] = [];
  private inference: ActiveInferenceModel;
  private guard: HippocraticGuard;
  private subscribers: Set<(s: RuntimeState) => void>;

  // Driver bindings
  private safetyRegistry: Record<string, TraumaRecord> = {};

  constructor() {
    this.inference = new ActiveInferenceModel();
    this.guard = new HippocraticGuard();
    this.subscribers = new Set();
    this.state = this.getInitialState();
    this.emit({ type: 'BOOT', timestamp: Date.now() });
  }

  private getInitialState(): RuntimeState {
    return {
      status: 'IDLE',
      pattern: null,
      phase: 'inhale',
      phaseElapsed: 0,
      phaseDuration: 0,
      cycleCount: 0,
      sessionDuration: 0,
      belief: { arousal: 0.2, attention: 0.5, rhythm_alignment: 0.0 }, // Neutral priors
      entropy: 0.2
    };
  }

  // --- IO Ports ---
  public subscribe(cb: (s: RuntimeState) => void) {
    this.subscribers.add(cb);
    cb(this.state);
    return () => this.subscribers.delete(cb);
  }

  public setSafetyRegistry(registry: Record<string, TraumaRecord>) {
    this.safetyRegistry = registry;
  }

  public getState() { return this.state; }

  // --- EVENT BUS (Write Side) ---

  public dispatch(event: KernelEvent) {
    // 1. Log (Immutable History)
    this.eventLog.push(event);

    // 2. Reduce (State Transition)
    this.reduce(event);

    // 3. Notify (View Update)
    this.notify();
  }

  // --- REDUCER (The Logic) ---
  
  private reduce(event: KernelEvent) {
    switch (event.type) {
      case 'LOAD_PROTOCOL':
        const pattern = BREATHING_PATTERNS[event.patternId];
        if (!pattern) return; // Should allow error state
        this.state.pattern = pattern;
        this.state.phase = 'inhale';
        this.state.phaseDuration = pattern.timings.inhale;
        this.state.phaseElapsed = 0;
        this.state.cycleCount = 0;
        this.state.sessionDuration = 0;
        this.state.status = 'IDLE';
        // Loading a new protocol resets alignment but keeps arousal (context switch cost)
        this.state.belief.rhythm_alignment = 0.0; 
        break;

      case 'START_SESSION':
        if (this.state.pattern) {
            this.state.status = 'RUNNING';
        }
        break;

      case 'USER_INTERRUPTION':
        if (this.state.status === 'RUNNING') {
            this.state.status = 'PAUSED';
            // Immediate penalty to belief state
            this.state.belief.attention *= 0.8;
            this.state.belief.rhythm_alignment *= 0.5;
        }
        break;
        
      case 'RESUME_SESSION':
        if (this.state.status === 'PAUSED') {
            this.state.status = 'RUNNING';
        }
        break;

      case 'HALT':
      case 'SAFETY_INTERVENTION':
        this.state.status = event.type === 'HALT' ? 'IDLE' : 'SAFETY_LOCK';
        break;

      case 'PHASE_TRANSITION':
        this.state.phase = event.to;
        this.state.phaseElapsed = 0;
        this.state.phaseDuration = this.state.pattern ? this.state.pattern.timings[event.to] : 0;
        break;

      case 'CYCLE_COMPLETE':
        this.state.cycleCount = event.count;
        break;

      case 'TICK':
        this.handleTick(event.dt);
        break;
    }
    
    // Re-calculate Entropy after every state change
    this.state.entropy = this.inference.calculateEntropy(this.state.belief);
  }

  private handleTick(dt: number) {
    // 1. Active Inference Update
    const obs: Observation = {
        timestamp: Date.now(),
        delta_time: dt,
        visibilty_state: document.hidden ? 'hidden' : 'visible',
        user_interaction: this.state.status === 'PAUSED' ? 'pause' : undefined
    };
    
    this.state.belief = this.inference.update(this.state.belief, obs, this.state.status === 'RUNNING');

    if (this.state.status !== 'RUNNING' || !this.state.pattern) return;

    // 2. Physics Update
    this.state.phaseElapsed += dt;
    this.state.sessionDuration += dt;

    // 3. Phase Logic
    if (this.state.phaseElapsed >= this.state.phaseDuration) {
        this.transitionPhase();
    }

    // 4. Safety Guard Check
    const hazard = this.guard.check(this.state, this.safetyRegistry);
    if (hazard) {
        this.dispatch(hazard);
    }
  }

  private transitionPhase() {
    if (!this.state.pattern) return;
    
    const currentP = this.state.phase;
    const nextP = nextPhaseSkipZero(currentP, this.state.pattern);
    
    // Emit Transition Event
    this.dispatch({
        type: 'PHASE_TRANSITION',
        from: currentP,
        to: nextP,
        timestamp: Date.now()
    });

    if (isCycleBoundary(nextP)) {
        this.dispatch({
            type: 'CYCLE_COMPLETE',
            count: this.state.cycleCount + 1,
            timestamp: Date.now()
        });
    }
  }

  // --- INTERNAL UTILS ---
  private emit(event: KernelEvent) {
      this.dispatch(event);
  }

  private notify() {
    this.subscribers.forEach(cb => cb({ ...this.state }));
  }
}

export const kernel = new ZenBKernel();
