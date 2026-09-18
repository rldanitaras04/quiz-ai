import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface LogAiUsageParams {
  userId: string;
  assessmentId: string | null;
  provider: string;
  model: string;
  operation: string;
  tokensUsed: number;
  durationMs: number;
  status: string;
  errorCode?: string;
}

export async function logAiUsage(params: LogAiUsageParams): Promise<void> {
  try {
    await supabase.from('ai_usage_logs').insert({
      user_id: params.userId,
      assessment_id: params.assessmentId,
      provider: params.provider,
      model: params.model,
      operation: params.operation,
      input_tokens: params.tokensUsed,
      output_tokens: 0,
      estimated_cost: null,
      duration_ms: params.durationMs,
      status: params.status,
      error_code: params.errorCode || null,
    });
  } catch (error) {
    console.error('Failed to log AI usage:', error);
  }
}
