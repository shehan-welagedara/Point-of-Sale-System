import type { SVGProps } from "react";

const PATHS = {
  home: "M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z",
  tables: "M4 5h16v3H4zM6 8v11M18 8v11M9 13h6",
  menu: "M7 3v8a2 2 0 0 0 2 2v8M5 3v5a2 2 0 0 0 2 2h0a2 2 0 0 0 2-2V3M17 21V3c-2 0-3.5 2.5-3.5 6s1.5 5 3.5 5",
  orders: "M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h4",
  reports: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  cart: "M3 4h2l2.4 11.2a1 1 0 0 0 1 .8h8.9a1 1 0 0 0 1-.8L21 8H6.2M9 20.5h.01M17 20.5h.01",
  back: "M15 5l-7 7 7 7",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-4.3-4.3",
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  trash: "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13",
  check: "M5 12.5 10 17 19 7",
  card: "M3 6h18v12H3zM3 10h18M7 15h3",
  cash: "M3 7h18v10H3zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 10v4M18 10v4",
  qr: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2v2h-2zM14 18h2v2h-2zM18 18h2v2h-2z",
  bank: "M3 9 12 4l9 5M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18",
  phone: "M8 3h8a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM11 18h2",
  gift: "M4 10h16v10H4zM3 7h18v3H3zM12 7v13M12 7c-1.5-3-5-3-5-1s3 1 5 1c2 0 5 1 5-1s-3.5-2-5 1",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0",
  users: "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 6.5M18 14c2 .7 3.5 2.8 3.5 6",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2",
  settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
  printer: "M6 9V3h12v6M6 18H4v-7h16v7h-2M7 14h10v7H7z",
  logout: "M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11",
  chevron: "M9 5l7 7-7 7",
  dots: "M12 5h.01M12 12h.01M12 19h.01",
  eye: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  eyeOff: "M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3 3.9M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a9.6 9.6 0 0 0 4.4-1.1M9.9 9.9a3 3 0 0 0 4.2 4.2",
  lock: "M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4",
  send: "M4 12 20 4l-6 16-3-7z",
  swap: "M7 7h13l-4-4M17 17H4l4 4",
  bolt: "M13 2 4 14h7l-1 8 9-12h-7z",
  trend: "M3 17l6-6 4 4 8-8M15 7h6v6",
  star: "M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z",
  note: "M5 4h10l4 4v12H5zM14 4v5h5M8 13h8M8 17h5",
  percent: "M19 5 5 19M7 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM17 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
  x: "M6 6l12 12M18 6 6 18",
  bell: "M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15zM10 20.5a2.2 2.2 0 0 0 4 0",
  inbox: "M3 13h5l1.5 3h5l1.5-3h5M5.5 5h13L21 13v6H3v-6z",
  box: "M3 7.5 12 3l9 4.5v9L12 21l-9-4.5zM3 7.5 12 12l9-4.5M12 12v9",
  truck: "M2 6h12v10H2zM14 9h4l3 3.5V16h-7M6 19.5a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6zM17.5 19.5a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6z",
  camera: "M4 8h3l2-3h6l2 3h3v11H4zM12 17a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z",
  clipboard: "M8 4h8v3H8zM6 5.5H4V21h16V5.5h-2M8 12l2 2 4-4M8 17h8",
  grid: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
  receipt: "M6 3h12v18l-2-1.5L14 21l-2-1.5L10 21l-2-1.5L6 21zM9 8h6M9 12h6M9 16h3",
  alert: "M12 3 2 20h20zM12 10v4.5M12 17.5v.01",
  book: "M4 5a2 2 0 0 1 2-2h14v16H6a2 2 0 0 0-2 2zM4 21a2 2 0 0 1 2-2h14",
  download: "M12 3v12M7 10l5 5 5-5M4 20h16",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 22, ...rest }: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
      <path d={PATHS[name]} />
    </svg>
  );
}

export function tenderIcon(type: string): IconName {
  switch (type) {
    case "cash":
    case "foreignCash":
      return "cash";
    case "card":
      return "card";
    case "lankaqr":
      return "qr";
    case "payhere":
      return "phone";
    case "voucher":
      return "gift";
    case "house":
      return "bank";
    default:
      return "star";
  }
}
