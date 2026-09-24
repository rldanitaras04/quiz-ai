import { countUsedAttempts } from '@/lib/attempt-limit';

export interface DeploymentStatusResult {
  label: string;
  variant: 'success' | 'warning' | 'danger' | 'info' | 'default';
  attemptId: string | null;
}

export function getDeploymentStatus(
  d: Record<string, unknown>,
  attemptsByDeployment: Map<string, Array<Record<string, unknown>>>,
  now: Date
): DeploymentStatusResult {
  const opensAt = new Date(d.opens_at as string);
  const closesAt = new Date(d.closes_at as string);
  const studentAttempts = attemptsByDeployment.get(d.id as string) ?? [];
  const inProgress = studentAttempts.find((a) => a.status === 'in_progress');
  const usedCount = countUsedAttempts(
    studentAttempts.map((a) => ({ status: String(a.status ?? '') }))
  );
  const attemptLimit = Number(d.attempt_limit) || 0;
  const withinWindow = now >= opensAt && now <= closesAt;

  if (inProgress && withinWindow) return { label: 'In Progress', variant: 'warning', attemptId: inProgress.id as string };
  if (inProgress) return { label: 'Expired', variant: 'danger', attemptId: null };
  if (now < opensAt) return { label: 'Upcoming', variant: 'info', attemptId: null };
  if (now > closesAt) return { label: 'Closed', variant: 'default', attemptId: null };
  if (usedCount >= attemptLimit) return { label: 'Completed', variant: 'success', attemptId: null };
  return { label: 'Available', variant: 'success', attemptId: null };
}
