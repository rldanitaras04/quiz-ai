import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { SUPPORTED_QUESTION_IMAGE_TYPES } from '@/lib/constants';

export async function POST(request: NextRequest) {
  const supabase = createAdminClient();
  try {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const token = authHeader.split(' ')[1];
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check faculty role
    const { data: roles } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id);
    const isFaculty = roles?.some((r) => r.role === 'faculty' || r.role === 'super_admin');
    if (!isFaculty) {
      return NextResponse.json({ error: 'Forbidden: Faculty access required' }, { status: 403 });
    }

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const offeringId = formData.get('offeringId') as string | null;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    // Validate mime
    if (!SUPPORTED_QUESTION_IMAGE_TYPES.includes(file.type as any)) {
      return NextResponse.json(
        { error: `Unsupported image type: ${file.type}. Supported: JPEG, PNG, WebP, GIF, SVG` },
        { status: 400 }
      );
    }

    const maxMb = 10; // question images capped at 10 MB regardless of source setting
    const maxBytes = maxMb * 1024 * 1024;
    if (file.size > maxBytes) {
      return NextResponse.json(
        { error: `Image too large. Maximum size: ${maxMb} MB` },
        { status: 400 }
      );
    }

    // If offeringId provided, verify faculty assignment (super_admin bypasses)
    if (offeringId && !roles?.some((r) => r.role === 'super_admin')) {
      const { data: assignment } = await supabase
        .from('faculty_assignments')
        .select('id')
        .eq('subject_offering_id', offeringId)
        .eq('faculty_id', user.id)
        .maybeSingle();
      if (!assignment) {
        return NextResponse.json(
          { error: 'Forbidden: not assigned to this subject offering' },
          { status: 403 }
        );
      }
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const ext = file.name.split('.').pop()?.toLowerCase() || file.type.split('/')[1] || 'png';
    // Store under question-images/<offeringIdOrUserId>/<timestamp>-<rand>.<ext>
    const folder = offeringId ?? user.id;
    const storagePath = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from('question-images')
      .upload(storagePath, buffer, {
        contentType: file.type,
        upsert: false,
      });

    if (uploadError) {
      console.error('Question image upload error:', uploadError);
      return NextResponse.json({ error: 'Failed to upload image' }, { status: 500 });
    }

    const { data: pub } = supabase.storage.from('question-images').getPublicUrl(storagePath);

    return NextResponse.json(
      {
        url: pub.publicUrl,
        storagePath,
        mimeType: file.type,
        size: file.size,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Question image upload error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
