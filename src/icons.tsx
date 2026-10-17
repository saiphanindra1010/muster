/** Icon set: lucide-react with our size-first API. Drop-in for the old hand SVGs. */
import type { ComponentType } from "react";
import type { LucideProps } from "lucide-react";
import {
  Activity,
  ArrowUp,
  Ban,
  BookOpen,
  Bot,
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  MessageCircle,
  Monitor,
  Moon,
  Package,
  Pencil,
  Plug,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings,
  Sparkles,
  Square,
  Store,
  Sun,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  User,
  Wrench,
  X,
} from "lucide-react";

type P = { size?: number; className?: string };

const w =
  (C: ComponentType<LucideProps>) =>
  ({ size = 16, className }: P) =>
    <C size={size} className={className} />;

export const IconPlus = w(Plus);
export const IconRefresh = w(RefreshCw);
export const IconX = w(X);
export const IconArrowUp = w(ArrowUp);
export const IconStop = ({ size = 14, className }: P) => (
  <Square size={size} className={className} fill="currentColor" strokeWidth={0} />
);
export const IconCopy = w(Copy);
export const IconCheck = w(Check);
export const IconThumbsUp = w(ThumbsUp);
export const IconThumbsDown = w(ThumbsDown);
export const IconActivity = w(Activity);
export const IconChat = w(MessageCircle);
export const IconPencil = w(Pencil);
export const IconBan = w(Ban);
export const IconSave = w(Save);
export const IconSparkle = w(Sparkles);
export const IconChevronDown = w(ChevronDown);
export const IconUser = w(User);
export const IconBot = w(Bot);
export const IconMonitor = w(Monitor);
export const IconSun = w(Sun);
export const IconMoon = w(Moon);
export const IconTrash = w(Trash2);
export const IconGear = w(Settings);
export const IconPlug = w(Plug);
export const IconStore = w(Store);
export const IconSearch = w(Search);
export const IconPackage = w(Package);
export const IconBook = w(BookOpen);
export const IconWrench = w(Wrench);
export const IconExternal = w(ExternalLink);
