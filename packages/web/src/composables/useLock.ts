// Lock mode, honour-system edition: locking persists a cookie and navigates
// to the clock page; unlocking clears it and lets the buttons come back.
//
// The lock lives in a COOKIE rather than localStorage on purpose: the server
// reads it during SSR, so the page after 锁定 is rendered locked from the
// very first paint. Reactive-swap-then-navigate would repaint the navbar
// twice on an e-paper (button swap + full page); cookie-first keeps it at
// exactly one flash. It is also the seam a future companion-app integration
// replaces — the server can read (and later enforce) the same signal.
import { ref } from "vue";

const COOKIE_NAME = "mira-panel-lock";

export function useLock(initial: boolean) {
  // Initial value comes from the server (SSR read the cookie) and is embedded
  // in the bootstrap JSON, so hydration agrees with the first paint.
  const locked = ref(initial);

  function lock(): void {
    // Cookie first (synchronous), then the one navigation locking does. No
    // reactive repaint happens that matters — the page is replaced wholesale.
    document.cookie = `${COOKIE_NAME}=1; path=/; max-age=31536000; samesite=lax`;
    locked.value = true;
    location.assign("/");
  }

  function unlock(): void {
    document.cookie = `${COOKIE_NAME}=; path=/; max-age=0; samesite=lax`;
    // Intentional repaint: the refresh buttons return as feedback.
    locked.value = false;
  }

  return { locked, lock, unlock };
}
