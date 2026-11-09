/**
 * Appearance: System (default), Light, or Dark.
 *
 * The choice is `localStorage["muster.appearance"]`. It is applied in
 * index.html before first paint, then owned here. System follows the OS
 * and repaints when the OS flips.
 */

export type Appearance = "system" | "light" | "dark";

const STORAGE_KEY = "muster.appearance";

function systemPrefersDark(): boolean {
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    return true;
  }
}

export function readAppearance(): Appearance {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {}
  return "system";
}

export function resolveTheme(choice: Appearance = readAppearance()): "light" | "dark" {
  if (choice === "light" || choice === "dark") return choice;
  return systemPrefersDark() ? "dark" : "light";
}

/** Paint `<html data-theme>`. Crossfades when the resolved theme actually changes. */
export function applyAppearance(choice: Appearance = readAppearance()): void {
  const el = document.documentElement;
  const next = resolveTheme(choice);
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (el.dataset.theme && el.dataset.theme !== next && !reduced) {
    el.classList.add("theme-anim");
    window.setTimeout(() => el.classList.remove("theme-anim"), 260);
  }
  el.dataset.theme = next;
}

/** Persist a choice and paint it. */
export function setAppearance(choice: Appearance): void {
  try {
    localStorage.setItem(STORAGE_KEY, choice);
  } catch {}
  applyAppearance(choice);
}

/** Repaint when the OS appearance changes and the choice is System. */
export function watchSystemAppearance(): () => void {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const onChange = () => {
    if (readAppearance() === "system") applyAppearance("system");
  };
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}
