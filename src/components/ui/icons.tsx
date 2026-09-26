'use client';

// Phosphor's entry point creates a React context at module scope, which is
// forbidden when evaluated as a Server Component. Server components must import
// icons through this client shim instead of directly from '@phosphor-icons/react'.
export {
  Bell,
  BookOpen,
  Books,
  Buildings,
  CalendarBlank,
  CalendarCheck,
  ChartBar,
  CheckCircle,
  ChalkboardTeacher,
  ClipboardText,
  Clock,
  Database,
  Exam,
  FileText,
  Gear,
  GraduationCap,
  NotePencil,
  Pulse,
  Question,
  Robot,
  ShieldCheck,
  Stack,
  SquaresFour,
  Student,
  TrendDown,
  TrendUp,
  UploadSimple,
  UserPlus,
  Users,
  UsersFour,
  WarningCircle,
} from '@phosphor-icons/react';

export type { Icon } from '@phosphor-icons/react';
