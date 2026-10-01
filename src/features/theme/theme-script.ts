// Theme choice (plan 01 §theme): "system" follows the device, or the teacher picks light/dark. Saved per device.
export const THEME_KEY = "learning-suit-theme-v1";
export type ThemeChoice = "system" | "light" | "dark";

/** Runs in <head> before the first paint, so a dark page never flashes white. */
export const THEME_SCRIPT = `(function(){try{var c=localStorage.getItem(${JSON.stringify(THEME_KEY)});var d=c==="dark"||(c!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.dataset.theme=d?"dark":"light"}catch(e){document.documentElement.dataset.theme="light"}})()`;
