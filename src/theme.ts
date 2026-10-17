/**
 * Appearance (light / dark / system) — one setting for the whole app.
 *
 * The decision lands on <html data-theme="dark|light">; every token in
 * styles.css has a light twin. index.html runs the same resolution before
 * first paint (no flash), this module owns it after that.
 */

export type Appearance = "system" | "light" | "dark";

const KEY = "openchat:appearance";

export function loadAppearance(): Appearance {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {}
  return "system";
}

function systemPrefersDark(): boolean {
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    return true;
  }
}

/** Resolve to a concrete theme and paint it on <html>. */
export function applyAppearance(a: Appearance): void {
  const dark = a === "dark" || (a === "system" && systemPrefersDark());
  const el = document.documentElement;
  const next = dark ? "dark" : "light";
  if (el.dataset.theme && el.dataset.theme !== next) {
    // Crossfade surfaces for a beat so the switch doesn't snap.
    el.classList.add("theme-anim");
    window.setTimeout(() => el.classList.remove("theme-anim"), 260);
  }
  el.dataset.theme = next;
  try {
    localStorage.setItem(KEY, a);
  } catch {}
}

/** Repaint when the OS flips while the preference is "system".
 *  Returns the cleanup function. Call inside an effect. */
export function watchSystemAppearance(appearance: Appearance): () => void {
  if (appearance !== "system") return () => {};
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const onChange = () => applyAppearance("system");
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}
