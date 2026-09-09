import type { SVGProps } from "react";

type IconProps = Omit<SVGProps<SVGSVGElement>, "viewBox" | "fill" | "stroke">;

function makeIcon(children: React.ReactNode) {
  return function Icon(props: IconProps) {
    const { className = "", "aria-label": ariaLabel, ...rest } = props;
    const decorative = ariaLabel == null;
    return (
      <svg
        viewBox="0 0 24 24"
        width="1em"
        height="1em"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={`ico ${className}`.trim()}
        aria-hidden={decorative ? true : undefined}
        aria-label={ariaLabel}
        role={decorative ? "presentation" : "img"}
        focusable={false}
        {...rest}
      >
        {children}
      </svg>
    );
  };
}

export const Icons = {
  Dashboard: makeIcon(
    <>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </>,
  ),
  Users: makeIcon(
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c.7-3.4 3.5-5.5 6.5-5.5s5.8 2.1 6.5 5.5" />
      <circle cx="17" cy="9" r="2.7" />
      <path d="M21.5 18.5c-.5-2.6-2.4-4-4.5-4" />
    </>,
  ),
  Library: makeIcon(
    <>
      <path d="M4 4h4v16H4z" />
      <path d="M10 4h4v16h-4z" />
      <path d="m16.4 5.2 3.4 1 -3.6 14.5 -3.4-1z" />
    </>,
  ),
  Plans: makeIcon(
    <>
      <path d="M5 4h10l4 4v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" />
      <path d="M14 4v5h5" />
      <path d="M8 12h8M8 16h5" />
    </>,
  ),
  History: makeIcon(
    <>
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 4v5h5" />
      <path d="M12 7v5l3 2" />
    </>,
  ),
  Plus: makeIcon(<path d="M12 5v14M5 12h14" />),
  Search: makeIcon(
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>,
  ),
  Play: makeIcon(<path d="M6 4.5v15l13-7.5z" />),
  Pause: makeIcon(
    <>
      <rect x="6" y="4" width="4" height="16" rx="1" />
      <rect x="14" y="4" width="4" height="16" rx="1" />
    </>,
  ),
  Chev: makeIcon(<path d="m9 6 6 6-6 6" />),
  ChevDown: makeIcon(<path d="m6 9 6 6 6-6" />),
  ChevUp: makeIcon(<path d="m6 15 6-6 6 6" />),
  ChevLeft: makeIcon(<path d="m15 6-6 6 6 6" />),
  Upload: makeIcon(
    <>
      <path d="M12 16V4M6 10l6-6 6 6" />
      <path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />
    </>,
  ),
  Download: makeIcon(
    <>
      <path d="M12 4v12M6 10l6 6 6-6" />
      <path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />
    </>,
  ),
  Calendar: makeIcon(
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 9h18M8 3v4M16 3v4" />
    </>,
  ),
  Video: makeIcon(
    <>
      <rect x="3" y="6" width="13" height="12" rx="2" />
      <path d="m16 10 5-3v10l-5-3z" />
    </>,
  ),
  Clock: makeIcon(
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>,
  ),
  Check: makeIcon(<path d="m5 12 5 5 9-11" />),
  Dot: makeIcon(<circle cx="12" cy="12" r="1.5" fill="currentColor" />),
  Drag: makeIcon(
    <>
      <circle cx="9" cy="6" r="1" fill="currentColor" />
      <circle cx="15" cy="6" r="1" fill="currentColor" />
      <circle cx="9" cy="12" r="1" fill="currentColor" />
      <circle cx="15" cy="12" r="1" fill="currentColor" />
      <circle cx="9" cy="18" r="1" fill="currentColor" />
      <circle cx="15" cy="18" r="1" fill="currentColor" />
    </>,
  ),
  More: makeIcon(
    <>
      <circle cx="5" cy="12" r="1.3" fill="currentColor" />
      <circle cx="12" cy="12" r="1.3" fill="currentColor" />
      <circle cx="19" cy="12" r="1.3" fill="currentColor" />
    </>,
  ),
  Edit: makeIcon(
    <>
      <path d="M4 20h4l10-10-4-4L4 16v4z" />
      <path d="m13 7 4 4" />
    </>,
  ),
  Trash: makeIcon(<path d="M4 7h16M9 7V4h6v3M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" />),
  X: makeIcon(<path d="M6 6l12 12M18 6 6 18" />),
  Trainer: makeIcon(<path d="M6 8h12l-1 6H7zM8 14v6M16 14v6M8 8V4M16 8V4" />),
  Trainee: makeIcon(
    <>
      <circle cx="12" cy="7" r="3" />
      <path d="M5 21c1-4 4-6 7-6s6 2 7 6" />
    </>,
  ),
  Flame: makeIcon(
    <path d="M12 21c-4 0-7-2.5-7-6.5 0-3 2-5.5 3-7 .5-.7 1-1 1 0 0 1 0 2 1 2.5C11 8 11 4 12 3c2 2 6 6 6 11.5C18 18.5 16 21 12 21z" />,
  ),
  Trend: makeIcon(
    <>
      <path d="M3 17l6-6 4 4 8-9" />
      <path d="M14 6h7v7" />
    </>,
  ),
  TrendDown: makeIcon(
    <>
      <path d="M3 7l6 6 4-4 8 9" />
      <path d="M14 18h7v-7" />
    </>,
  ),
  Chart: makeIcon(
    <>
      <path d="M3 3v18h18" />
      <path d="M7 14l4-4 3 3 5-6" />
    </>,
  ),
  Trophy: makeIcon(
    <>
      <path d="M8 21h8M12 17v4M7 4h10v4a5 5 0 0 1-10 0V4z" />
      <path d="M5 6H3v2a3 3 0 0 0 3 3M19 6h2v2a3 3 0 0 1-3 3" />
    </>,
  ),
  Filter: makeIcon(<path d="M3 5h18l-7 9v6l-4-2v-4z" />),
  Sun: makeIcon(
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>,
  ),
  Moon: makeIcon(<path d="M21 13.5A8.5 8.5 0 0 1 10.5 3 8.5 8.5 0 1 0 21 13.5z" />),
  Settings: makeIcon(
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82c.26.5.76.84 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </>,
  ),
  Sparkle: makeIcon(
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8" />,
  ),
  Link: makeIcon(
    <>
      <path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 1 0-5.66-5.66l-1 1" />
      <path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 1 0 5.66 5.66l1-1" />
    </>,
  ),
  Arch: makeIcon(
    <>
      <rect x="3" y="4" width="18" height="4" rx="1" />
      <path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M10 12h4" />
    </>,
  ),
  Note: makeIcon(
    <>
      <path d="M4 4h12l4 4v12a1 1 0 0 1-1 1H4z" />
      <path d="M16 4v4h4M8 13h8M8 17h5" />
    </>,
  ),
  Consult: makeIcon(
    <>
      <path d="M4 5h16a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H9l-4 4v-4H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" />
      <path d="M8 9.5h8M8 12.5h5" />
    </>,
  ),
  Camera: makeIcon(
    <>
      <path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" />
      <circle cx="12" cy="13" r="4" />
    </>,
  ),
  Image: makeIcon(
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="9" cy="10" r="2" />
      <path d="m3 17 5-5 4 4 3-3 6 6" />
    </>,
  ),
  Body: makeIcon(
    <>
      <circle cx="12" cy="4.5" r="2" />
      <path d="M12 7v6M8 9l8 0M9 13l-1 8M15 13l1 8M9 13h6" />
    </>,
  ),
  Drop: makeIcon(<path d="M12 3s-7 8-7 13a7 7 0 0 0 14 0c0-5-7-13-7-13z" />),
  LogOut: makeIcon(
    <>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="m16 17 5-5-5-5" />
      <path d="M21 12H9" />
    </>,
  ),
  Card: makeIcon(
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 10h18M7 15h4" />
    </>,
  ),
};
