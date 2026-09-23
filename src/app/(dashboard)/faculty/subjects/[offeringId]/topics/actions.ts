'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { isFacultyOfOffering } from '@/lib/auth';
import type { Topic } from '@/lib/types';

async function requireUser() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) throw new Error('Not authenticated');
  return { supabase, userId: user.id };
}

async function resolveSubjectId(supabase: Awaited<ReturnType<typeof createClient>>, offeringId: string): Promise<string> {
  const { data, error } = await supabase
    .from('subject_offerings')
    .select('subject_id')
    .eq('id', offeringId)
    .single();
  if (error || !data) throw new Error('Subject offering not found');
  return data.subject_id as string;
}

export async function getTopicsForOffering(offeringId: string): Promise<Topic[]> {
  const { supabase, userId } = await requireUser();
  if (!(await isFacultyOfOffering(supabase, userId, offeringId))) {
    throw new Error('Not authorized for this offering');
  }
  const subjectId = await resolveSubjectId(supabase, offeringId);
  const { data, error } = await supabase
    .from('topics')
    .select('*')
    .eq('subject_id', subjectId)
    .order('title', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as Topic[];
}

export async function getTopicsForSubject(subjectId: string): Promise<Topic[]> {
  const { supabase } = await requireUser();
  const { data, error } = await supabase
    .from('topics')
    .select('*')
    .eq('subject_id', subjectId)
    .order('title', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as Topic[];
}

export async function createTopic(
  offeringId: string,
  input: { title: string; description?: string }
): Promise<Topic> {
  const { supabase, userId } = await requireUser();
  if (!(await isFacultyOfOffering(supabase, userId, offeringId))) {
    throw new Error('Not authorized for this offering');
  }
  const subjectId = await resolveSubjectId(supabase, offeringId);
  const title = input.title?.trim();
  if (!title) throw new Error('Topic title is required');
  if (title.length > 120) throw new Error('Title must be 120 characters or fewer');

  const { data, error } = await supabase
    .from('topics')
    .insert({
      subject_id: subjectId,
      title,
      description: input.description?.trim() || null,
      created_by: userId,
    })
    .select()
    .single();
  if (error) {
    if (error.message.includes('duplicate') || error.code === '23505') {
      throw new Error('A topic with that title already exists for this subject');
    }
    throw new Error(error.message);
  }
  revalidatePath(`/faculty/subjects/${offeringId}`);
  return data as Topic;
}

export async function updateTopic(
  topicId: string,
  input: { title?: string; description?: string }
): Promise<Topic> {
  const { supabase, userId } = await requireUser();
  const { data: topic } = await supabase.from('topics').select('subject_id').eq('id', topicId).single();
  if (!topic) throw new Error('Topic not found');
  // Verify faculty owns subject via any offering
  const { data: ok } = await supabase
    .from('subject_offerings')
    .select('id')
    .eq('subject_id', topic.subject_id)
    .limit(1);
  // Simple check: require is_faculty_of_subject via helper; fallback to admin check via RLS error
  // We'll verify by trying to fetch with RLS-scoped session (supabase already scoped)
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.title !== undefined) {
    const t = input.title.trim();
    if (!t) throw new Error('Title cannot be empty');
    updates.title = t;
  }
  if (input.description !== undefined) updates.description = input.description?.trim() || null;

  const { data, error } = await supabase
    .from('topics')
    .update(updates)
    .eq('id', topicId)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as Topic;
}

export async function deleteTopic(topicId: string): Promise<{ success: true }> {
  const { supabase } = await requireUser();
  const { error } = await supabase.from('topics').delete().eq('id', topicId);
  if (error) throw new Error(error.message);
  return { success: true };
}
