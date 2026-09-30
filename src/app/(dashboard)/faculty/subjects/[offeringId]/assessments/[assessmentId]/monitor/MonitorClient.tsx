'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient as createBrowserSupabase } from '@/lib/supabase/client';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import Modal from '@/components/ui/Modal';
import Select from '@/components/ui/Select';
import Input from '@/components/ui/Input';
import Spinner from '@/components/ui/Spinner';
import EmptyState from '@/components/ui/EmptyState';
import { confirmAction, notifyError, notifySuccess } from '@/components/ui/alerts';
import {
  EVENT_TYPE_LABELS,
  SEVERITY_LABELS,
  SECURITY_MODE_LABELS,
  monitorStateLabel,
  type EventSeverity,
} from '@/lib/exam-security';
import {
  allowSessionRecovery,
  grantExtraTime,
  requireReverification,
  terminateAttempt,
} from './actions';

export interface MonitorDeployment {
  id: string;
  status: string;
  opens_at: string;
  closes_at: string;
  duration_minutes: number;
  attempt_limit: number;
  security_mode: string;
  created_at: string;
}

export interface MonitorStudent {
  id: string;
  fullName: string;
  email: string;
  studentNumber: string;
}

interface AttemptRow {
  id: string;
  student_id: string;
  status: string;
  attempt_number: number;
  started_at: string | null;
  expires_at: string | null;
  submitted_at: string | null;
  created_at: string;
}

interface SessionRow {
  id: string;
  attempt_id: string;
  student_id: string;
  status: string;
  current_item: number;
  total_items: number | null;
  answered_count: number;
  flagged_count: number;
  connection_state: 'online' | 'offline' | 'unknown';
  sync_state: 'synced' | 'syncing' | 'pending' | 'error';
  pending_sync_count: number;
  last_heartbeat_at: string | null;
  last_local_save_at: string | null;
  last_sync_at: string | null;
  reverification_required: boolean;
  allow_recovery: boolean | null;
  started_at: string;
  ended_at: string | null;
  close_reason: string | null;
}

interface EventRow {
  id: string;
  attempt_id: string;
  student_id: string;
  event_type: string;
  severity: EventSeverity;
  metadata: Record<string, unknown> | null;
  recorded_at: string;
}

type BadgeVariant = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'outline';

const ATTEMPT_STATUS: Record<string, { label: string; variant: BadgeVariant }> = {
  created: { label: 'Not started', variant: 'default' },
  in_progress: { label: 'In progress', variant: 'info' },
  submitted: { label: 'Submitted', variant: 'success' },
  auto_submitted: { label: 'Auto-submitted', variant: 'success' },
  timed_out: { label: 'Timed out', variant: 'warning' },
  expired: { label: 'Expired', variant: 'warning' },
  cancelled: { label: 'Cancelled', variant: 'default' },
  invalidated: { label: 'Terminated', variant: 'danger' },
};

const SEVERITY_VARIANT: Record<EventSeverity, BadgeVariant> = {
  info: 'info',
  warning: 'warning',
  critical: 'danger',
};

const POLL_INTERVAL_MS = 10_000;
const REALTIME_DEBOUNCE_MS = 400;

interface MonitorRow {
  student: MonitorStudent;
  attempt: AttemptRow | null;
  session: SessionRow | null;
  events: EventRow[];
}

function statusBucket(
  row: MonitorRow
): 'not_started' | 'in_progress' | 'submitted' | 'finished' {
  const st = row.attempt?.status;
  if (!row.attempt || st === 'created') return 'not_started';
  if (st === 'in_progress') return 'in_progress';
  if (st === 'submitted' || st === 'auto_submitted') return 'submitted';
  return 'finished';
}

function securityState(row: MonitorRow): { label: string; variant: BadgeVariant } {
  const crit = row.events.filter((e) => e.severity === 'critical').length;
  const warn = row.events.filter((e) => e.severity === 'warning').length;
  if (row.session?.reverification_required) return { label: 'Reverification', variant: 'warning' };
  if (crit > 0) return { label: `Critical (${crit})`, variant: 'danger' };
  if (warn > 0) return { label: `Attention (${warn})`, variant: 'warning' };
  if (row.attempt?.status === 'in_progress') return { label: 'Clear', variant: 'success' };
  return { label: '—', variant: 'default' };
}

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${h}:${pad(m)}:${pad(s)}`;
}

const INTERRUPTION_EVENT_TYPES = new Set([
  'connection_lost',
  'session_recovered',
  'page_reloaded',
  'concurrent_session_attempt',
]);

export default function MonitorClient({
  offeringId,
  assessmentId,
  deployments,
  roster,
  contextLabel,
}: {
  offeringId: string;
  assessmentId: string;
  deployments: MonitorDeployment[];
  roster: MonitorStudent[];
  contextLabel?: string;
}) {
  const [deploymentId, setDeploymentId] = useState(
    deployments.find((d) => d.status === 'active')?.id ?? deployments[0]?.id ?? ''
  );
  const [attempts, setAttempts] = useState<AttemptRow[]>([]);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  // Tracks which deployment has loaded — switching deployments shows the
  // spinner until its data arrives, without setState-in-effect.
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [selectedAttemptId, setSelectedAttemptId] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [extraTimeAttempt, setExtraTimeAttempt] = useState<AttemptRow | null>(null);
  const [extraMinutes, setExtraMinutes] = useState(10);

  // Roster filters — summary badges always reflect the full roster; only the
  // table is filtered.
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [securityFilter, setSecurityFilter] = useState('all');
  const [syncFilter, setSyncFilter] = useState('all');

  // 1s ticker: heartbeat age, time remaining, "updated x s ago".
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1_000);
    return () => clearInterval(t);
  }, []);

  const loading = loadedFor !== deploymentId;

  const fetchData = useCallback(async () => {
    const sb = createBrowserSupabase();
    try {
      const [aRes, sRes, eRes] = await Promise.all([
        sb
          .from('exam_attempts')
          .select(
            'id, student_id, status, attempt_number, started_at, expires_at, submitted_at, created_at'
          )
          .eq('deployment_id', deploymentId),
        sb
          .from('exam_sessions')
          .select(
            'id, attempt_id, student_id, status, current_item, total_items, answered_count, ' +
              'flagged_count, connection_state, sync_state, pending_sync_count, last_heartbeat_at, ' +
              'last_local_save_at, last_sync_at, reverification_required, allow_recovery, ' +
              'started_at, ended_at, close_reason'
          )
          .eq('deployment_id', deploymentId)
          .order('started_at', { ascending: false }),
        sb
          .from('exam_events')
          .select('id, attempt_id, student_id, event_type, severity, metadata, recorded_at')
          .eq('deployment_id', deploymentId)
          .order('recorded_at', { ascending: false })
          .limit(300),
      ]);

      setAttempts((aRes.data ?? []) as unknown as AttemptRow[]);
      setSessions((sRes.data ?? []) as unknown as SessionRow[]);
      setEvents((eRes.data ?? []) as unknown as EventRow[]);
      setLoadError(null);
    } catch {
      setLoadError('Could not load live data. Retrying automatically…');
    } finally {
      setLoadedFor(deploymentId);
    }
  }, [deploymentId]);

  // Initial load + realtime (debounced refetch) + 10s poll fallback.
  useEffect(() => {
    if (!deploymentId) return;
    let cancelled = false;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const run = async () => {
      if (cancelled) return;
      await fetchData();
    };
    const schedule = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(run, REALTIME_DEBOUNCE_MS);
    };

    void run();
    const poll = setInterval(run, POLL_INTERVAL_MS);

    const sb = createBrowserSupabase();
    const channel = sb
      .channel(`live-monitor-${deploymentId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'exam_sessions', filter: `deployment_id=eq.${deploymentId}` },
        schedule
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'exam_events', filter: `deployment_id=eq.${deploymentId}` },
        schedule
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'exam_attempts', filter: `deployment_id=eq.${deploymentId}` },
        schedule
      )
      .subscribe();

    return () => {
      cancelled = true;
      if (debounceTimer) clearTimeout(debounceTimer);
      clearInterval(poll);
      void sb.removeChannel(channel);
    };
  }, [deploymentId, fetchData]);

  const rows: MonitorRow[] = useMemo(() => {
    const rosterById = new Map(roster.map((s) => [s.id, s]));

    // Latest attempt per student (highest attempt number, then created_at).
    const attemptByStudent = new Map<string, AttemptRow>();
    for (const a of attempts) {
      const prev = attemptByStudent.get(a.student_id);
      if (
        !prev ||
        a.attempt_number > prev.attempt_number ||
        (a.attempt_number === prev.attempt_number && a.created_at > prev.created_at)
      ) {
        attemptByStudent.set(a.student_id, a);
      }
    }

    // Best session per attempt: active beats closed; newer beats older.
    const sessionByAttempt = new Map<string, SessionRow>();
    for (const s of sessions) {
      const prev = sessionByAttempt.get(s.attempt_id);
      if (
        !prev ||
        (s.status === 'active' && prev.status !== 'active') ||
        (s.status === prev.status && s.started_at > prev.started_at)
      ) {
        sessionByAttempt.set(s.attempt_id, s);
      }
    }

    const eventsByAttempt = new Map<string, EventRow[]>();
    for (const e of events) {
      const list = eventsByAttempt.get(e.attempt_id);
      if (list) list.push(e);
      else eventsByAttempt.set(e.attempt_id, [e]);
    }

    const students = new Map(rosterById);
    for (const a of attempts) {
      if (!students.has(a.student_id)) {
        students.set(a.student_id, {
          id: a.student_id,
          fullName: 'Unknown student',
          email: '',
          studentNumber: '',
        });
      }
    }

    const out: MonitorRow[] = [];
    for (const student of students.values()) {
      const attempt = attemptByStudent.get(student.id) ?? null;
      out.push({
        student,
        attempt,
        session: attempt ? sessionByAttempt.get(attempt.id) ?? null : null,
        events: attempt ? eventsByAttempt.get(attempt.id) ?? [] : [],
      });
    }

    // In-progress first, then not started, then finished; name as tiebreak.
    const rank = (r: MonitorRow) => {
      if (!r.attempt) return 1;
      if (r.attempt.status === 'in_progress') return 0;
      if (r.attempt.status === 'created') return 1;
      return 2;
    };
    out.sort((a, b) => {
      const d = rank(a) - rank(b);
      if (d !== 0) return d;
      return a.student.fullName.localeCompare(b.student.fullName);
    });
    return out;
  }, [roster, attempts, sessions, events]);

  // Summary always covers the FULL roster (filters only affect the table).
  const summary = useMemo(() => {
    let notStarted = 0;
    let inProgress = 0;
    let submitted = 0;
    let offline = 0;
    let attention = 0;
    let critical = 0;
    for (const r of rows) {
      const st = r.attempt?.status;
      if (!r.attempt || st === 'created') notStarted += 1;
      else if (st === 'in_progress') inProgress += 1;
      else if (st === 'submitted' || st === 'auto_submitted') submitted += 1;

      const active = st === 'in_progress' && r.session?.status === 'active';
      if (active && r.session?.connection_state === 'offline') offline += 1;

      const warn = r.events.filter((e) => e.severity === 'warning').length;
      const crit = r.events.filter((e) => e.severity === 'critical').length;
      critical += crit;

      // "Needs attention" counts STUDENTS, not events: active students with a
      // warning/critical event, a stale heartbeat, a sync error, or no active
      // session at all.
      const stale =
        active &&
        r.session?.last_heartbeat_at != null &&
        now.getTime() - new Date(r.session.last_heartbeat_at).getTime() > 60_000;
      const needsAttention =
        st === 'in_progress' &&
        (warn > 0 || crit > 0 || stale || r.session?.sync_state === 'error' || !active);
      if (needsAttention) attention += 1;
    }
    return { notStarted, inProgress, submitted, offline, attention, critical };
  }, [rows, now]);

  const filteredRows: MonitorRow[] = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (
        q &&
        !(
          r.student.fullName.toLowerCase().includes(q) ||
          r.student.email.toLowerCase().includes(q) ||
          r.student.studentNumber.toLowerCase().includes(q)
        )
      ) {
        return false;
      }
      if (statusFilter !== 'all' && statusBucket(r) !== statusFilter) return false;
      if (securityFilter !== 'all') {
        const crit = r.events.some((e) => e.severity === 'critical');
        const warn = r.events.some((e) => e.severity === 'warning');
        const state = crit ? 'critical' : warn ? 'attention' : 'clear';
        if (securityFilter !== state) return false;
      }
      if (syncFilter !== 'all') {
        const active = r.attempt?.status === 'in_progress' && r.session?.status === 'active';
        if (!active) return false;
        const offline = r.session?.connection_state === 'offline';
        const sync = r.session?.sync_state;
        if (syncFilter === 'offline' && !offline) return false;
        if (syncFilter === 'synced' && (offline || sync !== 'synced')) return false;
        if (syncFilter === 'pending' && (offline || sync !== 'pending')) return false;
        if (syncFilter === 'error' && sync !== 'error') return false;
      }
      return true;
    });
  }, [rows, search, statusFilter, securityFilter, syncFilter]);

  const selectedRow = useMemo(
    () => rows.find((r) => r.attempt?.id === selectedAttemptId) ?? null,
    [rows, selectedAttemptId]
  );

  // All sessions for the open detail (multi-session history after recovery).
  const selectedSessions = useMemo(() => {
    if (!selectedRow?.attempt) return [];
    const attemptId = selectedRow.attempt.id;
    return sessions
      .filter((s) => s.attempt_id === attemptId)
      .sort((a, b) => b.started_at.localeCompare(a.started_at));
  }, [sessions, selectedRow]);

  // Interruptions = reconnects, recoveries, reloads, concurrent-session hits.
  const interruptionCount = useMemo(() => {
    if (!selectedRow) return 0;
    return selectedRow.events.filter((e) => INTERRUPTION_EVENT_TYPES.has(e.event_type)).length;
  }, [selectedRow]);

  // -------------------------------------------------------------------------
  // Faculty controls
  // -------------------------------------------------------------------------
  const runAction = useCallback(
    async (
      key: string,
      fn: () => Promise<{ success: boolean; error?: string; value?: string }>,
      successTitle: string,
      successText?: string | ((value?: string) => string | undefined)
    ) => {
      setBusyAction(key);
      try {
        const result = await fn();
        if (result.success) {
          const detail =
            typeof successText === 'function' ? successText(result.value) : successText;
          notifySuccess(successTitle, detail);
          await fetchData();
        } else {
          notifyError('Action failed', result.error);
        }
      } finally {
        setBusyAction(null);
      }
    },
    [fetchData]
  );

  const handleGrantExtraTime = async () => {
    const attempt = extraTimeAttempt;
    if (!attempt) return;
    setExtraTimeAttempt(null);
    await runAction(
      `time-${attempt.id}`,
      () => grantExtraTime({ attemptId: attempt.id, offeringId, assessmentId, minutes: extraMinutes }),
      'Extra time granted',
      (v) =>
        v
          ? `New deadline: ${new Date(v).toLocaleTimeString()}. The student's exam updates within about 20 seconds.`
          : undefined
    );
  };

  const handleAllowRecovery = (attemptId: string) =>
    runAction(
      `recovery-${attemptId}`,
      () => allowSessionRecovery({ attemptId, offeringId, assessmentId }),
      'Session recovery allowed',
      'The student can now reopen this attempt from another session or device.'
    );

  const handleRequireReverification = (attemptId: string) =>
    runAction(
      `reverify-${attemptId}`,
      () => requireReverification({ attemptId, offeringId, assessmentId }),
      'Reverification requested',
      'The student will be asked to re-enter their password within about 20 seconds.'
    );

  const handleTerminate = async (attemptId: string) => {
    const ok = await confirmAction({
      title: 'Terminate this attempt?',
      text: 'The student will be disconnected and the attempt will be marked as terminated. This action is recorded in the audit log. It does not score or release anything.',
      confirmText: 'Terminate attempt',
      destructive: true,
    });
    if (!ok) return;
    await runAction(
      `terminate-${attemptId}`,
      () => terminateAttempt({ attemptId, offeringId, assessmentId }),
      'Attempt terminated'
    );
  };

  // -------------------------------------------------------------------------
  // Render helpers
  // -------------------------------------------------------------------------
  const presenceLabel = (row: MonitorRow): { text: string; variant: BadgeVariant } => {
    if (!row.attempt) return { text: '—', variant: 'default' };
    if (row.attempt.status !== 'in_progress') {
      return {
        text: ATTEMPT_STATUS[row.attempt.status]?.label ?? row.attempt.status,
        variant: ATTEMPT_STATUS[row.attempt.status]?.variant ?? 'default',
      };
    }
    if (!row.session || row.session.status !== 'active') {
      return { text: 'NO ACTIVE SESSION', variant: 'warning' };
    }
    const text = monitorStateLabel({
      connectionState: row.session.connection_state,
      syncState: row.session.sync_state,
      lastHeartbeatAt: row.session.last_heartbeat_at,
      now,
    });
    return {
      text,
      variant: text === 'HEARTBEAT STALE' ? 'warning' : 'default',
    };
  };

  const heartbeatAge = (session: SessionRow | null): string => {
    if (!session?.last_heartbeat_at) return '—';
    const secs = Math.max(0, Math.round((now.getTime() - new Date(session.last_heartbeat_at).getTime()) / 1000));
    if (secs < 60) return `${secs}s ago`;
    return `${Math.floor(secs / 60)}m ${secs % 60}s ago`;
  };

  const remaining = (attempt: AttemptRow | null): string => {
    if (!attempt?.expires_at || attempt.status !== 'in_progress') return '—';
    const ms = new Date(attempt.expires_at).getTime() - now.getTime();
    if (ms <= 0) return '00:00';
    const total = Math.floor(ms / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const pad = (n: number) => String(n).padStart(2, '0');
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  };

  const remainingClass = (attempt: AttemptRow | null): string => {
    if (!attempt?.expires_at || attempt.status !== 'in_progress') return '';
    const ms = new Date(attempt.expires_at).getTime() - now.getTime();
    if (ms <= 5 * 60_000) return 'text-[var(--color-danger)] font-semibold';
    if (ms <= 15 * 60_000) return 'text-[var(--color-warning)]';
    return '';
  };

  const metadataSummary = (metadata: Record<string, unknown> | null): string => {
    if (!metadata || Object.keys(metadata).length === 0) return '';
    return Object.entries(metadata)
      .map(([k, v]) => `${k}: ${String(v)}`)
      .join(' · ');
  };

  const activeDeployment = deployments.find((d) => d.id === deploymentId);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-semibold">Live sessions</h2>
              <span className="flex items-center gap-1.5 text-xs text-[var(--color-muted)]">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--color-success)] opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--color-success)]" />
                </span>
                Live — realtime with 10s fallback refresh
              </span>
            </div>
            {contextLabel && (
              <span className="text-xs text-[var(--color-muted)]">{contextLabel}</span>
            )}
          </div>
          {deployments.length > 1 && (
            <Select
              label="Deployment"
              value={deploymentId}
              onChange={(e) => setDeploymentId(e.target.value)}
              className="sm:w-72"
            >
              {deployments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.status} · opens {new Date(d.opens_at).toLocaleString()}
                </option>
              ))}
            </Select>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge variant="info">In progress: {summary.inProgress}</Badge>
            <Badge variant="default">Not started: {summary.notStarted}</Badge>
            <Badge variant="success">Submitted: {summary.submitted}</Badge>
            <Badge variant={summary.offline > 0 ? 'warning' : 'default'}>
              Offline: {summary.offline}
            </Badge>
            <Badge variant={summary.attention > 0 ? 'warning' : 'default'}>
              Needs attention: {summary.attention}
            </Badge>
            <Badge variant={summary.critical > 0 ? 'danger' : 'default'}>
              Critical events: {summary.critical}
            </Badge>
            {activeDeployment?.security_mode && activeDeployment.security_mode !== 'standard' && (
              <Badge variant="info">
                {SECURITY_MODE_LABELS[
                  activeDeployment.security_mode as keyof typeof SECURITY_MODE_LABELS
                ] ?? activeDeployment.security_mode}
              </Badge>
            )}
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <Input
              label="Search students"
              placeholder="Name, email, or student number"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="sm:flex-1"
            />
            <Select
              label="Status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="all">All statuses</option>
              <option value="in_progress">In progress</option>
              <option value="not_started">Not started</option>
              <option value="submitted">Submitted</option>
              <option value="finished">Closed / terminated</option>
            </Select>
            <Select
              label="Security"
              value={securityFilter}
              onChange={(e) => setSecurityFilter(e.target.value)}
            >
              <option value="all">All</option>
              <option value="critical">Critical events</option>
              <option value="attention">Attention events</option>
              <option value="clear">Clear (no events)</option>
            </Select>
            <Select
              label="Sync"
              value={syncFilter}
              onChange={(e) => setSyncFilter(e.target.value)}
            >
              <option value="all">All</option>
              <option value="synced">Synced</option>
              <option value="pending">Sync pending</option>
              <option value="error">Sync error</option>
              <option value="offline">Offline</option>
            </Select>
          </div>

          {loadError && <p className="text-sm text-[var(--color-danger)]">{loadError}</p>}

          {loading ? (
            <div className="flex justify-center py-10">
              <Spinner size="lg" />
            </div>
          ) : rows.length === 0 ? (
            <EmptyState
              title="No students in this deployment"
              description="Students appear here as soon as the assessment is deployed to their section."
            />
          ) : filteredRows.length === 0 ? (
            <EmptyState
              title="No students match the current filters"
              description="Adjust the search box or the status, security, and sync filters."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1120px] text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-border)] text-left text-xs uppercase tracking-wide text-[var(--color-muted)]">
                    <th className="py-2 pr-3">Student</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2 pr-3">Progress</th>
                    <th className="py-2 pr-3">Item</th>
                    <th className="py-2 pr-3">Flagged</th>
                    <th className="py-2 pr-3">Connection</th>
                    <th className="py-2 pr-3">Sync</th>
                    <th className="py-2 pr-3">Security</th>
                    <th className="py-2 pr-3">Heartbeat</th>
                    <th className="py-2 pr-3">Time left</th>
                    <th className="py-2 pr-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row) => {
                    const st = ATTEMPT_STATUS[row.attempt?.status ?? 'created'] ?? {
                      label: 'Not started',
                      variant: 'default' as BadgeVariant,
                    };
                    const presence = presenceLabel(row);
                    const sec = securityState(row);
                    const total = row.session?.total_items ?? null;
                    const answered = row.session?.answered_count ?? 0;
                    const isActive = row.attempt?.status === 'in_progress';
                    const busy = row.attempt
                      ? [
                          `time-${row.attempt.id}`,
                          `recovery-${row.attempt.id}`,
                          `reverify-${row.attempt.id}`,
                          `terminate-${row.attempt.id}`,
                        ].includes(busyAction ?? '')
                      : false;

                    return (
                      <tr
                        key={row.student.id}
                        className="border-b border-[var(--color-border)] align-middle"
                      >
                        <td className="py-3 pr-3">
                          <div className="font-medium text-[var(--color-foreground)]">
                            {row.student.fullName}
                          </div>
                          <div className="text-xs text-[var(--color-muted)]">
                            {row.student.studentNumber || row.student.email}
                          </div>
                        </td>
                        <td className="py-3 pr-3">
                          <div className="flex flex-col gap-1">
                            <Badge variant={st.variant}>{st.label}</Badge>
                            {row.attempt?.status === 'in_progress' && (
                              <Badge variant={presence.variant} className="font-mono text-[10px]">
                                {presence.text}
                              </Badge>
                            )}
                            {row.session?.reverification_required && row.attempt?.status === 'in_progress' && (
                              <Badge variant="warning">Reverification pending</Badge>
                            )}
                          </div>
                        </td>
                        <td className="py-3 pr-3 tabular-nums">
                          {isActive && row.session ? (
                            <span>
                              {answered}
                              {total !== null ? ` / ${total}` : ''} answered
                            </span>
                          ) : (
                            <span className="text-[var(--color-muted)]">—</span>
                          )}
                        </td>
                        <td className="py-3 pr-3 tabular-nums">
                          {isActive && row.session && total !== null ? (
                            <span>
                              {row.session.current_item} / {total}
                            </span>
                          ) : isActive && row.session ? (
                            <span>{row.session.current_item}</span>
                          ) : (
                            <span className="text-[var(--color-muted)]">—</span>
                          )}
                        </td>
                        <td className="py-3 pr-3 tabular-nums">
                          {isActive && row.session ? (
                            <span>{row.session.flagged_count}</span>
                          ) : (
                            <span className="text-[var(--color-muted)]">—</span>
                          )}
                        </td>
                        <td className="py-3 pr-3 text-xs">
                          {isActive && row.session ? (
                            <span
                              className={
                                row.session.connection_state === 'offline'
                                  ? 'font-medium text-[var(--color-warning)]'
                                  : undefined
                              }
                            >
                              {row.session.connection_state}
                            </span>
                          ) : (
                            <span className="text-[var(--color-muted)]">—</span>
                          )}
                        </td>
                        <td className="py-3 pr-3 text-xs">
                          {isActive && row.session ? (
                            <span className="flex flex-col gap-0.5">
                              <span>{row.session.sync_state}</span>
                              {row.session.pending_sync_count > 0 && (
                                <span className="text-[var(--color-warning)]">
                                  {row.session.pending_sync_count} pending
                                </span>
                              )}
                            </span>
                          ) : (
                            <span className="text-[var(--color-muted)]">—</span>
                          )}
                        </td>
                        <td className="py-3 pr-3">
                          <Badge variant={sec.variant}>{sec.label}</Badge>
                        </td>
                        <td className="py-3 pr-3 text-xs tabular-nums">
                          {isActive ? heartbeatAge(row.session) : '—'}
                        </td>
                        <td className={`py-3 pr-3 tabular-nums ${remainingClass(row.attempt)}`}>
                          {remaining(row.attempt)}
                        </td>
                        <td className="py-3 pr-3">
                          <div className="flex justify-end gap-1.5">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => row.attempt && setSelectedAttemptId(row.attempt.id)}
                            >
                              Details
                            </Button>
                            {row.attempt?.status === 'in_progress' && (
                              <>
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  disabled={busy}
                                  onClick={() => setExtraTimeAttempt(row.attempt)}
                                >
                                  +Time
                                </Button>
                                <Button
                                  size="sm"
                                  variant="danger"
                                  disabled={busy}
                                  onClick={() => row.attempt && handleTerminate(row.attempt.id)}
                                >
                                  Terminate
                                </Button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <p className="text-xs text-[var(--color-muted)]">
            Security events are factual session records (for example “tab left 3
            times”). They are not findings of misconduct — review the timeline
            before drawing any conclusion.
          </p>
        </CardContent>
      </Card>

      {/* Session detail + event timeline + full control set */}
      <Modal
        open={selectedRow !== null}
        onClose={() => setSelectedAttemptId(null)}
        title={selectedRow ? `Session detail — ${selectedRow.student.fullName}` : 'Session detail'}
        actions={
          selectedRow?.attempt?.status === 'in_progress' ? (
            <>
              <Button
                variant="secondary"
                size="sm"
                disabled={Boolean(busyAction)}
                onClick={() =>
                  selectedRow.attempt &&
                  !selectedRow.session?.allow_recovery &&
                  handleAllowRecovery(selectedRow.attempt.id)
                }
              >
                {selectedRow.session?.allow_recovery ? 'Recovery allowed' : 'Allow recovery'}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={Boolean(busyAction) || Boolean(selectedRow.session?.reverification_required)}
                onClick={() =>
                  selectedRow.attempt && handleRequireReverification(selectedRow.attempt.id)
                }
              >
                {selectedRow.session?.reverification_required
                  ? 'Reverification requested'
                  : 'Require reverification'}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={Boolean(busyAction)}
                onClick={() =>
                  selectedRow.attempt && setExtraTimeAttempt(selectedRow.attempt)
                }
              >
                Grant extra time
              </Button>
            </>
          ) : null
        }
      >
        {selectedRow && (
          <div className="space-y-4 text-sm">
            <div className="grid grid-cols-2 gap-x-4 gap-y-2">
              <span className="text-[var(--color-muted)]">Status</span>
              <span>
                {selectedRow.attempt
                  ? ATTEMPT_STATUS[selectedRow.attempt.status]?.label ?? selectedRow.attempt.status
                  : 'Not started'}
              </span>
              <span className="text-[var(--color-muted)]">Student number</span>
              <span>{selectedRow.student.studentNumber || '—'}</span>
              <span className="text-[var(--color-muted)]">Current item</span>
              <span className="tabular-nums">
                {selectedRow.session
                  ? `${selectedRow.session.current_item}${
                      selectedRow.session.total_items !== null
                        ? ` of ${selectedRow.session.total_items}`
                        : ''
                    }`
                  : '—'}
              </span>
              <span className="text-[var(--color-muted)]">Connection</span>
              <span className="font-mono text-xs">
                {selectedRow.attempt?.status === 'in_progress'
                  ? presenceLabel(selectedRow).text
                  : '—'}
              </span>
              <span className="text-[var(--color-muted)]">Sync state</span>
              <span className="font-mono text-xs">
                {selectedRow.session
                  ? `${
                      selectedRow.session.connection_state === 'offline'
                        ? 'offline'
                        : selectedRow.session.sync_state
                    }${selectedRow.session.pending_sync_count > 0 ? ` (${selectedRow.session.pending_sync_count} pending)` : ''}`
                  : '—'}
              </span>
              <span className="text-[var(--color-muted)]">Progress</span>
              <span className="tabular-nums">
                {selectedRow.session
                  ? `${selectedRow.session.answered_count}${
                      selectedRow.session.total_items !== null
                        ? ` / ${selectedRow.session.total_items}`
                        : ''
                    } answered · ${selectedRow.session.flagged_count} flagged`
                  : '—'}
              </span>
              <span className="text-[var(--color-muted)]">Started</span>
              <span>
                {selectedRow.attempt?.started_at
                  ? new Date(selectedRow.attempt.started_at).toLocaleString()
                  : '—'}
              </span>
              <span className="text-[var(--color-muted)]">Elapsed</span>
              <span className="tabular-nums">
                {selectedRow.attempt?.started_at
                  ? formatElapsed(
                      (selectedRow.attempt.submitted_at
                        ? new Date(selectedRow.attempt.submitted_at).getTime()
                        : now.getTime()) - new Date(selectedRow.attempt.started_at).getTime()
                    )
                  : '—'}
              </span>
              <span className="text-[var(--color-muted)]">Last heartbeat</span>
              <span className="tabular-nums">
                {selectedRow.attempt?.status === 'in_progress'
                  ? heartbeatAge(selectedRow.session)
                  : '—'}
              </span>
              <span className="text-[var(--color-muted)]">Last successful sync</span>
              <span>
                {selectedRow.session?.last_sync_at
                  ? new Date(selectedRow.session.last_sync_at).toLocaleTimeString()
                  : '—'}
              </span>
              <span className="text-[var(--color-muted)]">Pending sync</span>
              <span className="tabular-nums">
                {selectedRow.session ? `${selectedRow.session.pending_sync_count} answers` : '—'}
              </span>
              <span className="text-[var(--color-muted)]">Last local save</span>
              <span>
                {selectedRow.session?.last_local_save_at
                  ? new Date(selectedRow.session.last_local_save_at).toLocaleTimeString()
                  : '—'}
              </span>
              <span className="text-[var(--color-muted)]">Interruptions</span>
              <span className="tabular-nums">
                {selectedRow.attempt ? interruptionCount : '—'}
              </span>
              <span className="text-[var(--color-muted)]">Deadline</span>
              <span className="tabular-nums">
                {selectedRow.attempt?.expires_at
                  ? `${new Date(selectedRow.attempt.expires_at).toLocaleTimeString()} (${remaining(selectedRow.attempt)} left)`
                  : '—'}
              </span>
            </div>

            {selectedSessions.length > 0 && (
              <div>
                <h3 className="mb-2 text-sm font-semibold">Session history</h3>
                <ol className="space-y-1.5">
                  {selectedSessions.map((s) => (
                    <li
                      key={s.id}
                      className="rounded-lg border border-[var(--color-border)] p-2.5 text-xs"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium">
                          {s.status === 'active'
                            ? 'Active session'
                            : `Session — ${s.status.replace(/_/g, ' ')}`}
                        </span>
                        <span className="text-[var(--color-muted)]">
                          started {new Date(s.started_at).toLocaleString()}
                        </span>
                      </div>
                      {s.ended_at && (
                        <div className="text-[var(--color-muted)]">
                          ended {new Date(s.ended_at).toLocaleString()}
                          {s.close_reason ? ` · ${s.close_reason.replace(/_/g, ' ')}` : ''}
                        </div>
                      )}
                    </li>
                  ))}
                </ol>
              </div>
            )}

            <div>
              <h3 className="mb-2 text-sm font-semibold">Event timeline</h3>
              {selectedRow.events.length === 0 ? (
                <p className="text-xs text-[var(--color-muted)]">
                  No recorded events for this attempt.
                </p>
              ) : (
                <ol className="max-h-72 space-y-2 overflow-y-auto pr-1">
                  {selectedRow.events.map((e) => (
                    <li
                      key={e.id}
                      className="rounded-lg border border-[var(--color-border)] p-2.5"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-sm font-medium">
                          {EVENT_TYPE_LABELS[e.event_type as keyof typeof EVENT_TYPE_LABELS] ?? e.event_type}
                        </span>
                        <Badge variant={SEVERITY_VARIANT[e.severity] ?? 'info'}>
                          {SEVERITY_LABELS[e.severity]}
                        </Badge>
                      </div>
                      <div className="mt-1 flex items-center justify-between text-xs text-[var(--color-muted)]">
                        <span>{new Date(e.recorded_at).toLocaleTimeString()}</span>
                      </div>
                      {metadataSummary(e.metadata) && (
                        <p className="mt-1 break-words text-xs text-[var(--color-muted)]">
                          {metadataSummary(e.metadata)}
                        </p>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* Grant extra time */}
      <Modal
        open={extraTimeAttempt !== null}
        onClose={() => setExtraTimeAttempt(null)}
        title="Grant extra time"
        actions={
          <>
            <Button variant="secondary" onClick={() => setExtraTimeAttempt(null)}>
              Cancel
            </Button>
            <Button
              onClick={handleGrantExtraTime}
              disabled={extraMinutes < 1 || extraMinutes > 240}
            >
              Grant {extraMinutes} min
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm">
          <p>
            Extend the deadline for{' '}
            <strong>
              {rows.find((r) => r.attempt?.id === extraTimeAttempt?.id)?.student.fullName ??
                'this student'}
            </strong>
            . The running exam picks up the new deadline at the next heartbeat
            (within about 20 seconds) — no reload needed.
          </p>
          <Input
            label="Extra minutes (1–240)"
            type="number"
            min={1}
            max={240}
            value={extraMinutes}
            onChange={(e) => setExtraMinutes(Number(e.target.value))}
          />
        </div>
      </Modal>
    </div>
  );
}
