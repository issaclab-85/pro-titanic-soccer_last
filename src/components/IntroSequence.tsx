import { useEffect, useState } from 'react';

interface IntroSequenceProps {
  onComplete: () => void;
}

type IntroStep = 'studio' | 'creator' | 'loading';

export function IntroSequence({ onComplete }: IntroSequenceProps) {
  const [step, setStep] = useState<IntroStep>('studio');
  const [stampVisible, setStampVisible] = useState(false);
  const [creatorFadingOut, setCreatorFadingOut] = useState(false);
  const [loadProgress, setLoadProgress] = useState(0);

  useEffect(() => {
    if (step === 'studio') {
      const t = window.setTimeout(() => {
        setStep('creator');
      }, 3900);
      return () => clearTimeout(t);
    }

    if (step === 'creator') {
      setStampVisible(false);
      setCreatorFadingOut(false);
      const tStamp = window.setTimeout(() => setStampVisible(true), 620);
      const tFadeOut = window.setTimeout(() => setCreatorFadingOut(true), 3250);
      const tNext = window.setTimeout(() => setStep('loading'), 3850);
      return () => {
        clearTimeout(tStamp);
        clearTimeout(tFadeOut);
        clearTimeout(tNext);
      };
    }

    // Step 3: 4-second smooth white-bordered loading bar
    const durationMs = 4000;
    const start = performance.now();
    let raf = 0;

    const tick = (now: number) => {
      const elapsed = now - start;
      const pct = Math.min(100, (elapsed / durationMs) * 100);
      setLoadProgress(pct);
      if (elapsed < durationMs) {
        raf = requestAnimationFrame(tick);
      } else {
        window.setTimeout(onComplete, 120);
      }
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [step, onComplete]);

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-black text-white select-none">
      {/* Step 1: SR Studio Slow Fade-In / Hold 2s / Fade-Out */}
      {step === 'studio' && (
        <div className="flex h-full w-full items-center justify-center bg-black px-6">
          <div className="animate-sr-studio text-center">
            <div className="text-3xl font-light tracking-[0.38em] text-white uppercase sm:text-5xl">
              SR Studio
            </div>
            <div className="mx-auto mt-4 h-px w-20 bg-white/30" />
          </div>
        </div>
      )}

      {/* Step 2: Created and designed by + SAIMUN RAHMAN Rubber Stamp Impact */}
      {step === 'creator' && (
        <div
          className={`flex h-full w-full flex-col items-center justify-center bg-black px-6 transition-opacity duration-500 ${
            creatorFadingOut ? 'opacity-0' : 'opacity-100'
          }`}
        >
          <p className="animate-sr-subtitle text-sm font-medium tracking-[0.28em] text-slate-300 uppercase sm:text-base">
            Created and designed by
          </p>

          <div className="relative mt-5 flex items-center justify-center">
            {stampVisible && (
              <>
                <span className="animate-sr-stamp-ring pointer-events-none absolute inset-0 rounded-xl border-2 border-amber-400/70" />
                <div className="animate-sr-stamp relative border-[3px] border-amber-400 bg-amber-400/10 px-6 py-2.5 shadow-[0_0_32px_rgba(251,191,36,0.28)] sm:px-9 sm:py-3">
                  <span className="block text-2xl font-black tracking-[0.18em] text-amber-300 uppercase sm:text-4xl">
                    SAIMUN RAHMAN
                  </span>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Step 3: Custom Floodlit Night Stadium Background + Wordmark PNG + 4s Loading Bar */}
      {step === 'loading' && (
        <div className="relative flex h-dvh w-full flex-col justify-between overflow-hidden bg-[#05070d] px-5 py-5 sm:px-12 sm:py-9">
          <img
            src="/assets/aistudio/football_stadium_loading_background_ac75707f.png"
            alt=""
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 h-full w-full object-cover object-center"
          />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/45 via-black/15 to-[#05070d]/85" />

          <div className="relative z-10 h-2 shrink-0" />

          {/* Center Stylized Title Wordmark PNG */}
          <div className="relative z-10 my-auto flex items-center justify-center px-4">
            <img
              src="/assets/aistudio/pro_titanic_soccer_logo_91a3a484.png"
              alt="Pro Titanic Soccer"
              className="max-h-[36dvh] w-auto max-w-[84vw] object-contain drop-shadow-[0_12px_32px_rgba(0,0,0,0.9)] sm:max-h-[42dvh]"
            />
          </div>

          {/* Bottom Smooth 4-Second Loading Bar */}
          <div className="relative z-10 mx-auto w-full max-w-2xl shrink-0 pb-1">
            <div className="mb-1.5 flex items-center justify-end text-xs font-black tracking-widest text-[#F5C542] drop-shadow-[0_2px_6px_rgba(0,0,0,0.9)]">
              <span className="font-mono tabular-nums">{Math.round(loadProgress)}%</span>
            </div>
            <div className="h-3.5 w-full overflow-hidden rounded-full border-2 border-white/90 bg-[#05070d]/85 p-0.5 shadow-[0_0_22px_rgba(0,0,0,0.85)] sm:h-4">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[#D4AF37] via-[#F5C542] to-white transition-[width] duration-75 ease-linear"
                style={{ width: `${loadProgress}%` }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
