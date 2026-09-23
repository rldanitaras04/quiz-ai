'use client';

import { useEffect, useState } from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import PageHeader from '@/components/ui/PageHeader';
import TopicManager from '@/components/assessment/TopicManager';
import { getTopicsForOffering } from './actions';
import type { Topic } from '@/lib/types';

interface Props {
  params: Promise<{ offeringId: string }>;
}

export default function TopicsPage({ params }: Props) {
  const [offeringId, setOfferingId] = useState('');
  const [topics, setTopics] = useState<Topic[]>([]);
  const [loading, setLoading] = useState(true);
  const [subjectLabel, setSubjectLabel] = useState('');
  const supabase = createClient();

  useEffect(() => {
    (async () => {
      const { offeringId: oid } = await params;
      setOfferingId(oid);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        redirect('/login');
        return;
      }
      const { data: offering } = await supabase
        .from('subject_offerings')
        .select('subject:subjects(code, title)')
        .eq('id', oid)
        .single();
      if (offering) {
        const s = (offering as any).subject;
        setSubjectLabel(`${s?.code ?? ''} - ${s?.title ?? ''}`);
      }
      try {
        const t = await getTopicsForOffering(oid);
        setTopics(t);
      } catch {
        setTopics([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [params, supabase]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-[var(--color-primary)]" />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        breadcrumbs={[
          { label: 'Faculty', href: '/faculty' },
          { label: 'My Subjects', href: '/faculty/subjects' },
          { label: subjectLabel || 'Subject', href: `/faculty/subjects/${offeringId}` },
          { label: 'Topics' },
        ]}
        title="Topics"
        description="Organize your subject by topic — questions and bank items are grouped and filtered by these."
      />
      <div className="max-w-3xl">
        <TopicManager offeringId={offeringId} topics={topics} onChange={setTopics} />
      </div>
    </div>
  );
}
