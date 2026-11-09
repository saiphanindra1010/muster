/**
 * Brand marks for the apps a bot can use. Multi-color where the mark is
 * multi-color. Single-color marks use the real brand color.
 */
import {
  IconLogoDiscord,
  IconLogoGithub,
  IconLogoSentry,
  IconLogoTeams,
} from "./icons";

export function AppLogo({ id, size = 26 }: { id: string; size?: number }) {
  if (id === "slack") return <Slack size={size} />;
  if (id === "gmail") return <Gmail size={size} />;
  if (id === "google-chat") return <GoogleChat size={size} />;
  if (id === "agent-browser" || id === "chrome") return <Chrome size={size} />;
  // Monochrome marks follow the theme so they stay visible on dark tiles.
  const color =
    id === "github" ? "var(--txt)" :
    id === "sentry" ? "var(--brand-sentry)" :
    id === "discord" ? "#5865F2" :
    id === "teams" ? "#5B5FC7" :
    "currentColor";
  const Mark =
    id === "github" ? IconLogoGithub :
    id === "discord" ? IconLogoDiscord :
    id === "teams" ? IconLogoTeams :
    id === "sentry" ? IconLogoSentry :
    null;
  if (!Mark) return null;
  return (
    <span style={{ color, display: "inline-flex" }}>
      <Mark size={size} />
    </span>
  );
}

function Slack({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#E01E5A" d="M6 15.2a2 2 0 1 1-2-2H6v2zm1.2 0a2 2 0 1 1 4 0v5a2 2 0 1 1-4 0v-5z" />
      <path fill="#36C5F0" d="M8.8 6a2 2 0 1 1 2-2v2h-2zm0 1.2a2 2 0 1 1 0 4H3.8a2 2 0 1 1 0-4h5z" />
      <path fill="#2EB67D" d="M18 8.8a2 2 0 1 1 2 2h-2v-2zm-1.2 0a2 2 0 1 1-4 0V3.8a2 2 0 1 1 4 0v5z" />
      <path fill="#ECB22E" d="M15.2 18a2 2 0 1 1-2 2v-2h2zm0-1.2a2 2 0 1 1 0-4h5a2 2 0 1 1 0 4h-5z" />
    </svg>
  );
}

function Gmail({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#EA4335" d="M24 5.457v13.909c0 .904-.732 1.636-1.636 1.636h-3.819V11.73L12 16.64l-6.545-4.91v9.273H1.636A1.636 1.636 0 0 1 0 19.366V5.457c0-2.023 2.309-3.178 3.927-1.964L5.455 4.64 12 9.548l6.545-4.91 1.528-1.145C21.69 2.28 24 3.434 24 5.457z" />
    </svg>
  );
}

function GoogleChat({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#00AC47" d="M5 4.5h10.2A3.3 3.3 0 0 1 18.5 7.8v6.2a3.3 3.3 0 0 1-3.3 3.3H9.2L5.4 20.6c-.5.4-1.2 0-1.2-.6V7.8A3.3 3.3 0 0 1 5 4.5z" />
      <circle cx="8.2" cy="11" r="1.15" fill="#fff" />
      <circle cx="12" cy="11" r="1.15" fill="#FBBC04" />
      <circle cx="15.8" cy="11" r="1.15" fill="#4285F4" />
    </svg>
  );
}

function Chrome({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <defs>
        <clipPath id="muster-chrome">
          <circle cx="24" cy="24" r="16" />
        </clipPath>
      </defs>
      <g clipPath="url(#muster-chrome)">
        <path fill="#EA4335" d="M8 8h32L24 24z" />
        <path fill="#FBBC04" d="M8 8v32L24 24z" />
        <path fill="#34A853" d="M8 40h32L24 24z" />
        <path fill="#4285F4" d="M40 8v32L24 24z" />
      </g>
      <circle cx="24" cy="24" r="7" fill="#fff" />
      <circle cx="24" cy="24" r="5" fill="#4285F4" />
    </svg>
  );
}
