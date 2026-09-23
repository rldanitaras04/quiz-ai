'use client';

import { useState, useEffect, useCallback } from 'react';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import Input from '@/components/ui/Input';
import Modal from '@/components/ui/Modal';
import EmptyState from '@/components/ui/EmptyState';
import Spinner from '@/components/ui/Spinner';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table';
import { notifySuccess, notifyError } from '@/components/ui/alerts';
import { EXCEPTION_TYPE_LABELS } from '@/lib/constants';
import type { ExceptionType } from '@/lib/types';
import {
  listExceptions,
  grantException,
  revokeException,
  listEnrolledStudents,
  type ExceptionWithStudent,
} from './actions';

interface ExceptionsClientProps {
  deploymentId: string;
}

export default function ExceptionsClient({ deploymentId }: ExceptionsClientProps) {
  const [exceptions, setExceptions] = useState<ExceptionWithStudent[]>([]);
  const [loading, setLoading] = useState(true);
  const [showGrantModal, setShowGrantModal] = useState(false);
  const [granting, setGranting] = useState(false);

  const [students, setStudents] = useState<{ id: string; name: string; email: string }[]>([]);
  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [exceptionType, setExceptionType] = useState<ExceptionType>('extended_time');
  const [reason, setReason] = useState('');
  const [additionalMinutes, setAdditionalMinutes] = useState('');
  const [additionalAttempts, setAdditionalAttempts] = useState('');
  const [overrideClosesAt, setOverrideClosesAt] = useState('');

  const loadExceptions = useCallback(async () => {
    setLoading(true);
    const result = await listExceptions(deploymentId);
    if (result.error) {
      notifyError(result.error);
    } else {
      setExceptions(result.data ?? []);
    }
    setLoading(false);
  }, [deploymentId]);

  useEffect(() => {
    loadExceptions();
  }, [loadExceptions]);

  const openGrantModal = async () => {
    setShowGrantModal(true);
    setSelectedStudentId('');
    setExceptionType('extended_time');
    setReason('');
    setAdditionalMinutes('');
    setAdditionalAttempts('');
    setOverrideClosesAt('');

    const result = await listEnrolledStudents(deploymentId);
    if (result.data) setStudents(result.data);
  };

  const handleGrant = async () => {
    if (!selectedStudentId) {
      notifyError('Select a student');
      return;
    }
    if (!reason.trim()) {
      notifyError('Reason is required');
      return;
    }

    setGranting(true);
    const overrides: Record<string, unknown> = {};
    if (exceptionType === 'extended_time' && additionalMinutes) {
      overrides.additional_minutes = parseInt(additionalMinutes, 10);
    }
    if (exceptionType === 'additional_attempt' && additionalAttempts) {
      overrides.additional_attempts = parseInt(additionalAttempts, 10);
    }
    if (exceptionType === 'schedule_override' && overrideClosesAt) {
      overrides.override_closes_at = overrideClosesAt;
    }

    const result = await grantException(
      deploymentId,
      selectedStudentId,
      exceptionType,
      reason,
      overrides as Parameters<typeof grantException>[4]
    );

    setGranting(false);
    if (result.error) {
      notifyError(result.error);
    } else {
      notifySuccess('Exception granted');
      setShowGrantModal(false);
      loadExceptions();
    }
  };

  const handleRevoke = async (exceptionId: string) => {
    const result = await revokeException(exceptionId);
    if (result.error) {
      notifyError(result.error);
    } else {
      notifySuccess('Exception revoked');
      loadExceptions();
    }
  };

  const badgeVariant = (type: ExceptionType) => {
    switch (type) {
      case 'extended_time': return 'info';
      case 'additional_attempt': return 'warning';
      case 'schedule_override': return 'default';
      case 'accessibility': return 'success';
      default: return 'default';
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-foreground">Student Exceptions</h3>
            <p className="text-sm text-muted">Grant additional time, attempts, or schedule overrides</p>
          </div>
          <Button variant="primary" size="sm" onClick={openGrantModal}>
            Grant Exception
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex justify-center py-8"><Spinner /></div>
        ) : exceptions.length === 0 ? (
          <EmptyState
            title="No exceptions"
            description="No exceptions have been granted for this deployment."
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Student</TH>
                <TH>Type</TH>
                <TH>Details</TH>
                <TH>Reason</TH>
                <TH>Authorized By</TH>
                <TH>Actions</TH>
              </TR>
            </THead>
            <TBody>
              {exceptions.map((ex) => (
                <TR key={ex.id}>
                  <TD>
                    <div>
                      <div className="font-medium text-foreground">{ex.student_name}</div>
                      <div className="text-xs text-muted">{ex.student_email}</div>
                    </div>
                  </TD>
                  <TD>
                    <Badge variant={badgeVariant(ex.exception_type)}>
                      {EXCEPTION_TYPE_LABELS[ex.exception_type] ?? ex.exception_type}
                    </Badge>
                  </TD>
                  <TD>
                    <div className="text-sm">
                      {ex.exception_type === 'extended_time' && ex.additional_minutes && (
                        <span>+{ex.additional_minutes} minutes</span>
                      )}
                      {ex.exception_type === 'additional_attempt' && ex.additional_attempts && (
                        <span>+{ex.additional_attempts} attempt(s)</span>
                      )}
                      {ex.exception_type === 'schedule_override' && ex.override_closes_at && (
                        <span>Closes: {new Date(ex.override_closes_at).toLocaleString()}</span>
                      )}
                      {ex.exception_type === 'accessibility' && (
                        <span>Accessibility accommodation</span>
                      )}
                    </div>
                  </TD>
                  <TD>
                    <div className="text-sm text-muted max-w-xs truncate">{ex.reason}</div>
                  </TD>
                  <TD>
                    <div className="text-sm">{ex.authorizer_name}</div>
                  </TD>
                  <TD>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRevoke(ex.id)}
                    >
                      Revoke
                    </Button>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </CardContent>

      <Modal
        open={showGrantModal}
        onClose={() => setShowGrantModal(false)}
        title="Grant Exception"
        actions={
          <>
            <Button variant="secondary" onClick={() => setShowGrantModal(false)} disabled={granting}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleGrant} loading={granting}>
              Grant
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Student</label>
            <select
              value={selectedStudentId}
              onChange={(e) => setSelectedStudentId(e.target.value)}
              className="w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-foreground)]"
            >
              <option value="">Select a student...</option>
              {students.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.email})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Exception Type</label>
            <select
              value={exceptionType}
              onChange={(e) => setExceptionType(e.target.value as ExceptionType)}
              className="w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-foreground)]"
            >
              <option value="extended_time">Extended Time</option>
              <option value="additional_attempt">Additional Attempt</option>
              <option value="schedule_override">Schedule Override</option>
              <option value="accessibility">Accessibility</option>
            </select>
          </div>

          {exceptionType === 'extended_time' && (
            <Input
              label="Additional Minutes"
              type="number"
              value={additionalMinutes}
              onChange={(e) => setAdditionalMinutes(e.target.value)}
              placeholder="e.g., 30"
              min={1}
            />
          )}

          {exceptionType === 'additional_attempt' && (
            <Input
              label="Additional Attempts"
              type="number"
              value={additionalAttempts}
              onChange={(e) => setAdditionalAttempts(e.target.value)}
              placeholder="e.g., 1"
              min={1}
            />
          )}

          {exceptionType === 'schedule_override' && (
            <Input
              label="New Closing Time"
              type="datetime-local"
              value={overrideClosesAt}
              onChange={(e) => setOverrideClosesAt(e.target.value)}
            />
          )}

          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Reason *</label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              className="w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-foreground)]"
              placeholder="Explain why this exception is needed..."
            />
          </div>
        </div>
      </Modal>
    </Card>
  );
}
