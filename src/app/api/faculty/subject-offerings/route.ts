import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const subjectId = searchParams.get('subjectId');

  if (!subjectId) {
    return NextResponse.json({ error: 'subjectId is required' }, { status: 400 });
  }

  const supabase = await createClient();

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Get offerings for this subject that the faculty is assigned to
  const { data: assignments } = await supabase
    .from('faculty_assignments')
    .select('subject_offering:subject_offerings(id)')
    .eq('faculty_id', user.id);

  const offeringIds = (assignments ?? [])
    .map((a: any) => a.subject_offering?.id)
    .filter(Boolean);

  const { data: offerings } = await supabase
    .from('subject_offerings')
    .select('id')
    .eq('subject_id', subjectId)
    .eq('status', 'active')
    .in('id', offeringIds);

  return NextResponse.json({ offerings: offerings ?? [] });
}
