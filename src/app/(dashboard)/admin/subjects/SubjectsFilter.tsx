'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import Input from '@/components/ui/Input';
import EmptyState from '@/components/ui/EmptyState';
import type { SubjectWithOfferings } from '../actions';

const offeringStatusVariant: Record<string, 'success' | 'warning' | 'default'> = {
  active: 'success',
  inactive: 'warning',
  archived: 'default',
};

interface SubjectsFilterProps {
  subjects: SubjectWithOfferings[];
}

export default function SubjectsFilter({ subjects }: SubjectsFilterProps) {
  const [search, setSearch] = useState('');

  const filtered = subjects.filter((s) => {
    const query = search.toLowerCase();
    if (!query) return true;
    return (
      s.code.toLowerCase().includes(query) ||
      s.title.toLowerCase().includes(query) ||
      s.offerings.some(
        (o) =>
          o.program.toLowerCase().includes(query) ||
          o.section.toLowerCase().includes(query)
      )
    );
  });

  return (
    <>
      <div className="mb-4">
        <Input
          placeholder="Search by code, title, program, or section..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-md"
        />
      </div>

      <div className="space-y-4">
        {filtered.length === 0 ? (
          <Card>
            <CardContent>
              <EmptyState
                title="No subjects found"
                description={search ? 'Try adjusting your search query.' : 'No subjects have been created yet.'}
              />
            </CardContent>
          </Card>
        ) : (
          filtered.map((subject) => (
            <Card key={subject.id}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-medium text-[var(--color-foreground)]">
                      {subject.code} – {subject.title}
                    </h3>
                    {subject.description && (
                      <p className="text-sm text-[var(--color-muted)]">{subject.description}</p>
                    )}
                  </div>
                  <Badge variant={subject.is_active ? 'success' : 'default'}>
                    {subject.is_active ? 'Active' : 'Inactive'}
                  </Badge>
                </div>
              </CardHeader>
              {subject.offerings.length > 0 && (
                <CardContent>
                  <p className="text-xs font-medium text-[var(--color-muted)] uppercase tracking-wide mb-2">
                    Offerings ({subject.offerings.length})
                  </p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-[var(--color-border)]">
                          <th className="text-left py-2 px-3 font-medium text-[var(--color-muted)]">Semester</th>
                          <th className="text-left py-2 px-3 font-medium text-[var(--color-muted)]">Program</th>
                          <th className="text-left py-2 px-3 font-medium text-[var(--color-muted)]">Year Level</th>
                          <th className="text-left py-2 px-3 font-medium text-[var(--color-muted)]">Section</th>
                          <th className="text-left py-2 px-3 font-medium text-[var(--color-muted)]">Enrolled</th>
                          <th className="text-left py-2 px-3 font-medium text-[var(--color-muted)]">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {subject.offerings.map((offering) => (
                          <tr
                            key={offering.id}
                            className="border-b border-[var(--color-border)] last:border-0"
                          >
                            <td className="py-2 px-3 text-[var(--color-foreground)]">
                              {offering.semester}
                              <span className="text-[var(--color-muted)] ml-1">({offering.academicYear})</span>
                            </td>
                            <td className="py-2 px-3 text-[var(--color-muted)]">{offering.program}</td>
                            <td className="py-2 px-3 text-[var(--color-muted)]">{offering.yearLevel}</td>
                            <td className="py-2 px-3 text-[var(--color-muted)]">{offering.section}</td>
                            <td className="py-2 px-3 text-[var(--color-foreground)] font-medium">
                              {offering.enrolledCount}
                            </td>
                            <td className="py-2 px-3">
                              <Badge variant={offeringStatusVariant[offering.status] ?? 'default'}>
                                {offering.status}
                              </Badge>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              )}
              {subject.offerings.length === 0 && (
                <CardContent>
                  <p className="text-sm text-[var(--color-muted)]">No offerings yet.</p>
                </CardContent>
              )}
            </Card>
          ))
        )}
      </div>
    </>
  );
}
