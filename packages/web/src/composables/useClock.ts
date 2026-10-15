// Minute-hand clock: starts from the server timestamp (hydration-exact — the
// SSR pass rendered from the same number), then ticks on real minute
// boundaries. No seconds: an e-paper must not repaint per second.
import { onScopeDispose, onMounted, ref } from "vue";

export function useClock(startsAt: number) {
  const clockNow = ref(startsAt);

  let alignTimer: ReturnType<typeof setTimeout> | undefined;
  let minuteTimer: ReturnType<typeof setInterval> | undefined;

  onMounted(() => {
    // Align the first tick to the next minute boundary so the display flips
    // exactly when the minute changes, not at an arbitrary offset.
    alignTimer = setTimeout(
      () => {
        clockNow.value = Date.now();
        minuteTimer = setInterval(() => {
          clockNow.value = Date.now();
        }, 60_000);
      },
      60_000 - (Date.now() % 60_000),
    );
  });
  onScopeDispose(() => {
    clearTimeout(alignTimer);
    clearInterval(minuteTimer);
  });

  return { clockNow };
}
