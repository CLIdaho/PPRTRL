interface Props {
  size?: number
  className?: string
}

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
})

export const TimelineIcon = ({ size = 20, className }: Props) => (
  <svg {...base(size)} className={className} aria-hidden="true">
    <path d="M5 4v16" /><circle cx="5" cy="8" r="1.6" /><circle cx="5" cy="16" r="1.6" />
    <path d="M10 8h9M10 16h6" />
  </svg>
)

export const CaseIcon = ({ size = 20, className }: Props) => (
  <svg {...base(size)} className={className} aria-hidden="true">
    <rect x="3" y="7" width="18" height="13" rx="2.5" />
    <path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7M3 12h18" />
  </svg>
)

export const LedgerIcon = ({ size = 20, className }: Props) => (
  <svg {...base(size)} className={className} aria-hidden="true">
    <path d="M9 7.5h7M9 12h7M9 16.5h4" />
    <rect x="4.5" y="3" width="15" height="18" rx="2.5" />
  </svg>
)

export const SettingsIcon = ({ size = 20, className }: Props) => (
  <svg {...base(size)} className={className} aria-hidden="true">
    <circle cx="12" cy="12" r="3" />
    <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4" />
  </svg>
)

export const PlusIcon = ({ size = 20, className }: Props) => (
  <svg {...base(size)} className={className} aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
)

export const BackIcon = ({ size = 20, className }: Props) => (
  <svg {...base(size)} className={className} aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
)

export const SearchIcon = ({ size = 18, className }: Props) => (
  <svg {...base(size)} className={className} aria-hidden="true">
    <circle cx="11" cy="11" r="6.5" /><path d="M16 16l4 4" />
  </svg>
)

export const ShieldIcon = ({ size = 18, className }: Props) => (
  <svg {...base(size)} className={className} aria-hidden="true">
    <path d="M12 3l7 3v5.5c0 4.3-2.9 7.9-7 9.5-4.1-1.6-7-5.2-7-9.5V6z" /><path d="M9.2 12l2 2 3.6-3.8" />
  </svg>
)

export const AlertIcon = ({ size = 18, className }: Props) => (
  <svg {...base(size)} className={className} aria-hidden="true">
    <path d="M12 4.5l8.5 15h-17z" /><path d="M12 10v4M12 17h.01" />
  </svg>
)

export const ExportIcon = ({ size = 18, className }: Props) => (
  <svg {...base(size)} className={className} aria-hidden="true">
    <path d="M12 15V4M8.5 7.5L12 4l3.5 3.5" /><path d="M5 14v4.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V14" />
  </svg>
)

export const TrashIcon = ({ size = 18, className }: Props) => (
  <svg {...base(size)} className={className} aria-hidden="true">
    <path d="M4.5 6.5h15M9.5 6.5V5A1.5 1.5 0 0 1 11 3.5h2A1.5 1.5 0 0 1 14.5 5v1.5" />
    <path d="M6.5 6.5l.8 12a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4l.8-12" />
  </svg>
)

export const EditIcon = ({ size = 18, className }: Props) => (
  <svg {...base(size)} className={className} aria-hidden="true">
    <path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17z" /><path d="M14.5 6.5l3 3" />
  </svg>
)

export const PaperclipIcon = ({ size = 18, className }: Props) => (
  <svg {...base(size)} className={className} aria-hidden="true">
    <path d="M19 11.5l-7.3 7.3a4.2 4.2 0 0 1-6-6l7.7-7.7a2.8 2.8 0 0 1 4 4l-7.7 7.7a1.4 1.4 0 0 1-2-2l7-7" />
  </svg>
)

export const kindIcons = {
  image: ({ size = 18, className }: Props) => (
    <svg {...base(size)} className={className} aria-hidden="true">
      <rect x="3.5" y="5" width="17" height="14" rx="2.5" /><circle cx="9" cy="10" r="1.6" />
      <path d="M4 16.5l4.5-4 3.5 3 3-2.5 5 4.5" />
    </svg>
  ),
  video: ({ size = 18, className }: Props) => (
    <svg {...base(size)} className={className} aria-hidden="true">
      <rect x="3" y="6" width="12.5" height="12" rx="2.5" /><path d="M15.5 11l5.5-3v8l-5.5-3z" />
    </svg>
  ),
  audio: ({ size = 18, className }: Props) => (
    <svg {...base(size)} className={className} aria-hidden="true">
      <path d="M12 4v11.5" /><circle cx="9" cy="17" r="3" /><path d="M12 4l6 2v4" />
    </svg>
  ),
  pdf: ({ size = 18, className }: Props) => (
    <svg {...base(size)} className={className} aria-hidden="true">
      <path d="M13.5 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5z" />
      <path d="M13.5 3v5.5H19M8.5 16.5c2.5-1 4-4.5 3-5.8-1-1.2-2 .6-1 3.2s3 3.6 5 3" />
    </svg>
  ),
  document: ({ size = 18, className }: Props) => (
    <svg {...base(size)} className={className} aria-hidden="true">
      <path d="M13.5 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5z" />
      <path d="M13.5 3v5.5H19M8.5 13h7M8.5 16.5h5" />
    </svg>
  ),
  other: ({ size = 18, className }: Props) => (
    <svg {...base(size)} className={className} aria-hidden="true">
      <path d="M13.5 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5z" /><path d="M13.5 3v5.5H19" />
    </svg>
  ),
  note: ({ size = 18, className }: Props) => (
    <svg {...base(size)} className={className} aria-hidden="true">
      <rect x="4.5" y="4" width="15" height="16" rx="2.5" /><path d="M8 9h8M8 13h8M8 17h4" />
    </svg>
  ),
}
