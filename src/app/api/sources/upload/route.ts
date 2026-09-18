import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { extractAndStoreSource } from '@/lib/ai';
import {
  MAX_FILE_SIZE_MB,
  SUPPORTED_SOURCE_FILE_TYPES,
} from '@/lib/constants';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: NextRequest) {
  try {
    // Authenticate user
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

    // Parse form data
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const subjectOfferingId = formData.get('subjectOfferingId') as string;
    const title = formData.get('title') as string;
    const topicId = formData.get('topicId') as string | null;

    if (!file || !subjectOfferingId || !title) {
      return NextResponse.json(
        { error: 'Missing required fields: file, subjectOfferingId, title' },
        { status: 400 }
      );
    }

    // Validate file type
    if (!SUPPORTED_SOURCE_FILE_TYPES.includes(file.type as any)) {
      return NextResponse.json(
        { error: `Unsupported file type: ${file.type}. Supported: PDF, DOCX, TXT, MD` },
        { status: 400 }
      );
    }

    // Validate file size
    const maxSize = MAX_FILE_SIZE_MB * 1024 * 1024;
    if (file.size > maxSize) {
      return NextResponse.json(
        { error: `File too large. Maximum size: ${MAX_FILE_SIZE_MB}MB` },
        { status: 400 }
      );
    }

    // Convert file to buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Upload file to Supabase Storage
    const fileExt = file.name.split('.').pop();
    const storagePath = `${subjectOfferingId}/${Date.now()}.${fileExt}`;

    const { error: uploadError } = await supabase.storage
      .from('source-materials')
      .upload(storagePath, buffer, {
        contentType: file.type,
        upsert: false,
      });

    if (uploadError) {
      console.error('Storage upload error:', uploadError);
      return NextResponse.json({ error: 'Failed to upload file' }, { status: 500 });
    }

    // Create source_materials record
    const { data: sourceMaterial, error: insertError } = await supabase
      .from('source_materials')
      .insert({
        subject_offering_id: subjectOfferingId,
        topic_id: topicId || null,
        title,
        source_type: 'file',
        storage_path: storagePath,
        original_filename: file.name,
        mime_type: file.type,
        file_size: file.size,
        raw_text: null,
        processing_status: 'pending',
        created_by: user.id,
      })
      .select()
      .single();

    if (insertError) {
      console.error('Database insert error:', insertError);
      return NextResponse.json({ error: 'Failed to create source record' }, { status: 500 });
    }

    // Process file asynchronously (extract text, chunk, embed)
    extractAndStoreSource(sourceMaterial.id, buffer, file.type).catch((error) => {
      console.error('Background processing error:', error);
    });

    return NextResponse.json({
      sourceMaterial: {
        id: sourceMaterial.id,
        title: sourceMaterial.title,
        sourceType: sourceMaterial.source_type,
        mimeType: sourceMaterial.mime_type,
        fileSize: sourceMaterial.file_size,
        processingStatus: 'pending',
      },
    }, { status: 201 });
  } catch (error) {
    console.error('Source upload error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
