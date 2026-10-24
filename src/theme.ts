/**
 * Appearance follows the system - Muster has no in-app theme override.
 *
 * The decision lands on <html data-theme="dark|light">; every token in
 * styles.css has a light twin. index.html runs the same resolution before
 * first paint (no flash of the wrong theme), this module owns it after that.
 */

function systemPrefersDark(): boolean {
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    return true;
  }
}

/** Resolve the OS appearance and paint it on <html>. */
export function applyAppearance(): void {
  const el = document.documentElement;
  const next = systemPrefersDark() ? "dark" : "light";
  if (el.dataset.theme && el.dataset.theme !== next) {
    // Crossfade surfaces for a beat so the switch doesn't snap.
    el.classList.add("theme-anim");
    window.setTimeout(() => el.classList.remove("theme-anim"), 260);
  }
  el.dataset.theme = next;
}

/** Repaint when the OS appearance changes. Returns the cleanup function. */
export function watchSystemAppearance(): () => void {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const onChange = () => applyAppearance();
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}
