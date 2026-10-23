/** Thin line icons drawn for Bloom (no icon font, no emoji). */
import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function Svg({ children, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      {children}
    </svg>
  );
}

export const IconFlower = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="9" r="2" />
    <path d="M12 7C10 3 14 3 12 7ZM14 9c4-2 4 2 0 0ZM10 9c-4-2-4 2 0 0ZM13.2 10.8c2.8 3 -.6 4.3-1.2 1M10.8 10.8c-2.8 3 .6 4.3 1.2 1" />
    <path d="M12 12v9M12 17c-2.5-.2-4-1.6-4.5-3.5 2.4.1 4 1.4 4.5 3.5Z" />
  </Svg>
);

export const IconCamera = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 8h3l1.6-2.2h6.8L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z" />
    <circle cx="12" cy="13.2" r="3.6" />
    <path d="M17.6 10.6h.01" />
  </Svg>
);

export const IconJournal = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 3.5h11a1.5 1.5 0 0 1 1.5 1.5v14.5H7a2 2 0 0 1-2-2v-12a2 2 0 0 1 1-2Z" />
    <path d="M5 17.5a2 2 0 0 1 2-2h11.5" />
    <path d="M12 7.2c-.8-1.4-3-.8-2.6.9.3 1.2 2.6 2.6 2.6 2.6s2.3-1.4 2.6-2.6c.4-1.7-1.8-2.3-2.6-.9Z" />
  </Svg>
);

export const IconTogether = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="6" width="9" height="12" rx="1" transform="rotate(-6 7.5 12)" />
    <rect x="12" y="6" width="9" height="12" rx="1" transform="rotate(6 16.5 12)" />
  </Svg>
);

export const IconLive = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="2.2" />
    <path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M5 5a10 10 0 0 0 0 14M19 5a10 10 0 0 1 0 14" />
  </Svg>
);

export const IconInbox = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 13.5 6.5 5h11L20 13.5V19H4Z" />
    <path d="M4 13.5h4.5l1 2h5l1-2H20" />
  </Svg>
);

export const IconUser = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="8.5" r="3.5" />
    <path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5" />
  </Svg>
);

export const IconDownload = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14" />
  </Svg>
);

export const IconUpload = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M5 19.5h14" />
  </Svg>
);

export const IconTrash = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 12.5h9l1-12.5" />
  </Svg>
);

export const IconCopy = (p: IconProps) => (
  <Svg {...p}>
    <rect x="8" y="8" width="12" height="12" rx="1.5" />
    <path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8" />
  </Svg>
);

export const IconUndo = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 7 4.5 11.5 9 16" />
    <path d="M5 11.5h9a5 5 0 0 1 0 10h-2" />
  </Svg>
);

export const IconRedo = (p: IconProps) => (
  <Svg {...p}>
    <path d="m15 7 4.5 4.5L15 16" />
    <path d="M19 11.5h-9a5 5 0 0 0 0 10h2" />
  </Svg>
);

export const IconReset = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" />
    <path d="M4.5 4.5v4h4" />
  </Svg>
);

export const IconFlip = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 8.5A8 8 0 0 1 18.5 6M20 15.5A8 8 0 0 1 5.5 18" />
    <path d="M18.5 2.5V6H15M5.5 21.5V18H9" />
  </Svg>
);

export const IconHand = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 12V5.5a1.5 1.5 0 0 1 3 0V11M11 10V4a1.5 1.5 0 0 1 3 0v7M14 10.5V5.5a1.5 1.5 0 0 1 3 0V13" />
    <path d="M17 11.5a1.5 1.5 0 0 1 3 0V15a6.5 6.5 0 0 1-6.5 6.5h-1A6.5 6.5 0 0 1 6.9 18L4.5 14a1.6 1.6 0 0 1 2.6-1.8L8 13.5" />
  </Svg>
);

export const IconMic = (p: IconProps) => (
  <Svg {...p}>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
  </Svg>
);

export const IconMicOff = (p: IconProps) => (
  <Svg {...p}>
    <path d="M15 9.5V6a3 3 0 0 0-5.7-1.3M9 9v2a3 3 0 0 0 4.6 2.5M18.5 11a6.5 6.5 0 0 1-1 3.5M5.5 11a6.5 6.5 0 0 0 10 5.5M12 17.5V21M3.5 3.5l17 17" />
  </Svg>
);

export const IconVideo = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="6.5" width="12.5" height="11" rx="1.5" />
    <path d="m15.5 10.5 5-3v9l-5-3" />
  </Svg>
);

export const IconVideoOff = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 6.5h5a1.5 1.5 0 0 1 1.5 1.5v4.5M15.5 16v.5a1 1 0 0 1-1 1H4.5A1.5 1.5 0 0 1 3 16V8a1.5 1.5 0 0 1 1.5-1.5M15.5 10.5l5-3v9M3.5 3.5l17 17" />
  </Svg>
);

export const IconPlus = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);

export const IconX = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Svg>
);

export const IconCheck = (p: IconProps) => (
  <Svg {...p}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Svg>
);

export const IconEdit = (p: IconProps) => (
  <Svg {...p}>
    <path d="M14.5 5.5 18.5 9.5M4.5 19.5l1-4.5L16 4.5a1.4 1.4 0 0 1 2 0l1.5 1.5a1.4 1.4 0 0 1 0 2L9 18.5Z" />
  </Svg>
);

export const IconShuffle = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.5 7h3c4 0 6.5 10 11 10h3M3.5 17h3c1.7 0 3-1.7 4.2-3.8M13.3 9.8C14.5 8.1 15.8 7 17.5 7h3M18 4.5 20.5 7 18 9.5M18 14.5l2.5 2.5-2.5 2.5" />
  </Svg>
);

export const IconArrowLeft = (p: IconProps) => (
  <Svg {...p}>
    <path d="M19 12H5M11 6l-6 6 6 6" />
  </Svg>
);

export const IconSprig = (p: IconProps) => (
  <svg viewBox="0 0 64 64" fill="none" aria-hidden="true" {...p}>
    <path d="M32 60C32 42 33 26 32 8" stroke="var(--sage-deep)" strokeWidth="1.5" strokeLinecap="round" />
    <path d="M32 44c-8-1-12-7-11-12 7 1 11 6 11 12ZM32 30c8-1 11-6 11-11-7 1-10 5-11 11Z" fill="var(--sage)" opacity=".85" />
    <circle cx="32" cy="7" r="4" fill="var(--rose)" />
  </svg>
);

export function BloomMark(p: IconProps) {
  return (
    <svg viewBox="0 0 40 40" aria-hidden="true" {...p}>
      <g fill="var(--rose)">
        {[0, 72, 144, 216, 288].map((a) => (
          <ellipse key={a} cx="20" cy="11" rx="4.6" ry="7.4" transform={`rotate(${a} 20 19)`} opacity="0.92" />
        ))}
      </g>
      <circle cx="20" cy="19" r="3.4" fill="var(--cream)" />
    </svg>
  );
}
