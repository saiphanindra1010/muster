/** Icon set: lucide-react with our size-first API. Drop-in for the old hand SVGs. */
import {
  Activity,
  ArrowUp,
  Ban,
  Bot,
  Check,
  ChevronDown,
  Copy,
  MessageCircle,
  Pencil,
  Plug,
  Plus,
  RefreshCw,
  Save,
  Settings,
  Sparkles,
  Square,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  User,
  X,
} from "lucide-react";

type P = { size?: number; className?: string };

const w = (C: any) => ({ size = 16, className }: P) => <C size={size} className={className} />;

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
export const IconTrash = w(Trash2);
export const IconGear = w(Settings);
export const IconPlug = w(Plug);
