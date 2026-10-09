// Theme preference: "system" (default), "light" or "dark". Stored per device.
const KEY = "tuitionpro.theme";

export function getTheme() {
  try {
    const t = localStorage.getItem(KEY);
    return t === "light" || t === "dark" ? t : "system";
  } catch {
    return "system";
  }
}

export function applyTheme(theme = getTheme()) {
  const root = document.documentElement;
  if (theme === "light" || theme === "dark") root.dataset.theme = theme;
  else delete root.dataset.theme;
  const dark = theme === "dark" || (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
    if (theme === "system") m.content = m.media.includes("dark") ? "#0f0f1a" : "#f5f6fb";
    else m.content = dark ? "#0f0f1a" : "#f5f6fb";
  });
}

export function setTheme(theme) {
  try {
    if (theme === "light" || theme === "dark") localStorage.setItem(KEY, theme);
    else localStorage.removeItem(KEY);
  } catch {
    /* still apply for this session */
  }
  applyTheme(theme);
}

export function initTheme() {
  applyTheme();
  window.addEventListener("storage", (e) => {
    if (e.key === KEY) applyTheme();
  });
}
