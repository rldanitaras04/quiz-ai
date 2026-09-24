'use client';

import { useState, useEffect, Fragment, type JSX } from 'react';
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend, ArcElement } from 'chart.js';
import { Bar, Pie } from 'react-chartjs-2';
import { HeadingLevel } from 'docx';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Spinner from '@/components/ui/Spinner';
import EmptyState from '@/components/ui/EmptyState';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table';
import { notifyError, notifySuccess } from '@/components/ui/alerts';
import {
  DIFFICULTY_LABELS,
  BLOOM_LABELS,
  QUESTION_TYPE_SHORT_LABELS,
} from '@/lib/constants';
import {
  downloadDocx,
  safeDocxFilename,
  heading,
  paragraph,
  simpleTable,
  buildDocument,
} from '@/lib/export/docx';
import type { BloomLevel, Difficulty, QuestionType } from '@/lib/types';
import {
  getDeploymentAnalytics,
  type DeploymentAnalytics,
} from './actions';

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend, ArcElement);

interface AnalyticsClientProps {
  deploymentId: string;
}

function discriminationBadge(value: number | null): JSX.Element {
  if (value === null) return <Badge variant="default">—</Badge>;
  if (value >= 0.3) return <Badge variant="success">Good</Badge>;
  if (value >= 0.2) return <Badge variant="info">Fair</Badge>;
  if (value >= 0) return <Badge variant="warning">Weak</Badge>;
  return <Badge variant="danger">Negative</Badge>;
}

function buildItemAnalysisDocument(analytics: DeploymentAnalytics): ReturnType<typeof buildDocument> {
  const children: Parameters<typeof buildDocument>[0] = [
    heading('Item Analysis', HeadingLevel.HEADING_1),
    paragraph(analytics.assessment_title, { bold: true, spacing: { after: 60 } }),
    paragraph(
      `Submitted: ${analytics.total_submitted}  ·  Mean: ${analytics.mean_score.toFixed(1)}%  ·  Pass rate: ${analytics.pass_rate.toFixed(1)}%`
    ),
    heading('Items'),
    simpleTable(
      ['#', 'Type', 'Difficulty', 'Bloom', 'Responses', 'Correct', 'P (Difficulty)', 'D (Discrimination)'],
      analytics.item_analysis.map((item, index) => [
        index + 1,
        QUESTION_TYPE_SHORT_LABELS[item.question_type as QuestionType] ?? item.question_type,
        DIFFICULTY_LABELS[item.difficulty as Difficulty] ?? item.difficulty,
        BLOOM_LABELS[item.bloom_level as BloomLevel] ?? item.bloom_level,
        item.total_responses,
        item.correct_count,
        item.difficulty_index.toFixed(2),
        item.discrimination_index === null ? '—' : item.discrimination_index.toFixed(2),
      ])
    ),
  ];

  const withDistractors = analytics.item_analysis.filter(item => item.distractor_analysis.length > 0);
  if (withDistractors.length > 0) {
    children.push(heading('Distractor analysis'));
    for (const [index, item] of withDistractors.entries()) {
      children.push(
        paragraph(
          `Item ${analytics.item_analysis.indexOf(item) + 1}: ${item.question_text}`,
          { bold: true }
        )
      );
      children.push(
        simpleTable(
          ['Choice', 'Text', 'Selections', '%', 'Correct'],
          item.distractor_analysis.map(d => [
            d.choice_key,
            d.choice_text,
            d.selection_count,
            d.selection_percentage.toFixed(1),
            d.is_correct ? 'Yes' : 'No',
          ])
        )
      );
      if (index < withDistractors.length - 1) children.push(paragraph(''));
    }
  }

  return buildDocument(children);
}

export default function AnalyticsClient({ deploymentId }: AnalyticsClientProps): JSX.Element {
  const [analytics, setAnalytics] = useState<DeploymentAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await getDeploymentAnalytics(deploymentId);
      if (cancelled) return;
      if (result.error) {
        notifyError(result.error);
      } else {
        setAnalytics(result.data);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [deploymentId]);

  const handleDownload = async () => {
    if (!analytics) return;
    setDownloading(true);
    try {
      await downloadDocx(
        buildItemAnalysisDocument(analytics),
        safeDocxFilename(analytics.assessment_title, 'item-analysis')
      );
      notifySuccess('Item analysis downloaded');
    } catch (error) {
      notifyError(
        'Could not download item analysis',
        error instanceof Error ? error.message : 'Unexpected error.'
      );
    } finally {
      setDownloading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!analytics) {
    return (
      <EmptyState
        title="No analytics data"
        description="No results have been submitted for this deployment yet."
      />
    );
  }

  const scoreChartData = {
    labels: analytics.score_distribution.map(d => d.range),
    datasets: [
      {
        label: 'Students',
        data: analytics.score_distribution.map(d => d.count),
        backgroundColor: [
          'rgba(239, 68, 68, 0.7)',
          'rgba(245, 158, 11, 0.7)',
          'rgba(234, 179, 8, 0.7)',
          'rgba(34, 197, 94, 0.7)',
          'rgba(59, 130, 246, 0.7)',
        ],
        borderColor: [
          'rgb(239, 68, 68)',
          'rgb(245, 158, 11)',
          'rgb(234, 179, 8)',
          'rgb(34, 197, 94)',
          'rgb(59, 130, 246)',
        ],
        borderWidth: 1,
      },
    ],
  };

  const passFailData = {
    labels: ['Pass', 'Fail'],
    datasets: [
      {
        data: [
          Math.round(analytics.pass_rate),
          Math.round(100 - analytics.pass_rate),
        ],
        backgroundColor: ['rgba(34, 197, 94, 0.7)', 'rgba(239, 68, 68, 0.7)'],
        borderColor: ['rgb(34, 197, 94)', 'rgb(239, 68, 68)'],
        borderWidth: 1,
      },
    ],
  };

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="py-4">
            <p className="text-sm text-muted">Enrolled</p>
            <p className="text-2xl font-bold text-foreground">{analytics.total_enrolled}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <p className="text-sm text-muted">Attempted</p>
            <p className="text-2xl font-bold text-foreground">{analytics.total_attempted}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <p className="text-sm text-muted">Submitted</p>
            <p className="text-2xl font-bold text-foreground">{analytics.total_submitted}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <p className="text-sm text-muted">Completion Rate</p>
            <p className="text-2xl font-bold text-foreground">{analytics.completion_rate.toFixed(1)}%</p>
          </CardContent>
        </Card>
      </div>

      {/* Score Statistics */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
        <Card>
          <CardContent className="py-4">
            <p className="text-sm text-muted">Mean</p>
            <p className="text-lg font-bold text-foreground">{analytics.mean_score.toFixed(1)}%</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <p className="text-sm text-muted">Median</p>
            <p className="text-lg font-bold text-foreground">{analytics.median_score.toFixed(1)}%</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <p className="text-sm text-muted">Highest</p>
            <p className="text-lg font-bold text-foreground">{analytics.highest_score.toFixed(1)}%</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <p className="text-sm text-muted">Lowest</p>
            <p className="text-lg font-bold text-foreground">{analytics.lowest_score.toFixed(1)}%</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <p className="text-sm text-muted">Std Dev</p>
            <p className="text-lg font-bold text-foreground">{analytics.standard_deviation.toFixed(1)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <p className="text-sm text-muted">Pass Rate</p>
            <p className="text-lg font-bold text-foreground">{analytics.pass_rate.toFixed(1)}%</p>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <h3 className="text-base font-semibold text-foreground">Score Distribution</h3>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <Bar
                data={scoreChartData}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: {
                    legend: { display: false },
                  },
                  scales: {
                    y: {
                      beginAtZero: true,
                      ticks: { stepSize: 1 },
                    },
                  },
                }}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <h3 className="text-base font-semibold text-foreground">Pass/Fail Ratio</h3>
          </CardHeader>
          <CardContent>
            <div className="h-64 flex items-center justify-center">
              <div className="w-48">
                <Pie
                  data={passFailData}
                  options={{
                    responsive: true,
                    maintainAspectRatio: true,
                  }}
                />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Item Analysis */}
      <Card>
        <CardHeader className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-foreground">Item Analysis</h3>
            <p className="text-sm text-muted">
              Difficulty index P = R/N · Discrimination index D = upper 27% correct − lower 27% correct
            </p>
          </div>
          <Button variant="secondary" size="sm" loading={downloading} onClick={handleDownload}>
            Download Item Analysis
          </Button>
        </CardHeader>
        <CardContent>
          {analytics.item_analysis.length === 0 ? (
            <p className="text-sm text-muted py-4">No questions to analyze.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <THead>
                  <TR>
                    <TH align="right">#</TH>
                    <TH>Question</TH>
                    <TH>Type</TH>
                    <TH>Difficulty</TH>
                    <TH>Bloom</TH>
                    <TH align="right">Responses</TH>
                    <TH align="right">Correct</TH>
                    <TH align="right">P (Difficulty)</TH>
                    <TH align="right">D (Discrimination)</TH>
                    <TH>Rating</TH>
                    <TH>Distractors</TH>
                  </TR>
                </THead>
                <TBody>
                  {analytics.item_analysis.map((item, index) => (
                    <Fragment key={item.question_id}>
                      <TR>
                      <TD numeric className="text-muted">{index + 1}</TD>
                      <TD className="max-w-xs">
                        <span className="line-clamp-2 text-foreground">{item.question_text}</span>
                      </TD>
                      <TD className="text-muted">
                        {item.question_type === 'multiple_choice'
                          ? 'MCQ'
                          : item.question_type === 'true_false'
                            ? 'TF'
                            : 'ID'}
                      </TD>
                      <TD className="text-muted">{DIFFICULTY_LABELS[item.difficulty as keyof typeof DIFFICULTY_LABELS]}</TD>
                      <TD className="text-muted">{BLOOM_LABELS[item.bloom_level as keyof typeof BLOOM_LABELS]}</TD>
                      <TD numeric className="text-foreground">{item.total_responses}</TD>
                      <TD numeric className="text-foreground">{item.correct_count}</TD>
                      <TD numeric className="text-foreground">{item.difficulty_index.toFixed(2)}</TD>
                      <TD numeric className="text-foreground">
                        {item.discrimination_index === null
                          ? '—'
                          : item.discrimination_index.toFixed(2)}
                      </TD>
                      <TD>
                        <Badge variant={
                          item.difficulty_index >= 0.6 ? 'success' :
                          item.difficulty_index >= 0.4 ? 'warning' : 'danger'
                        }>
                          {item.difficulty_index >= 0.6 ? 'Good' :
                           item.difficulty_index >= 0.4 ? 'Moderate' : 'Difficult'}
                        </Badge>
                      </TD>
                      <TD>
                        {item.distractor_analysis.length > 0 ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              setExpandedId(prev => (prev === item.question_id ? null : item.question_id))
                            }
                          >
                            {expandedId === item.question_id ? 'Hide' : 'Show'}
                          </Button>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </TD>
                      </TR>
                      {expandedId === item.question_id && (
                        <TR>
                          <TD colSpan={11} className="bg-[var(--color-surface-hover)] p-4">
                          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
                            Choice distribution
                          </p>
                          <Table>
                            <THead>
                              <TR>
                                <TH>Choice</TH>
                                <TH>Text</TH>
                                <TH align="right">Selections</TH>
                                <TH align="right">%</TH>
                                <TH>Correct</TH>
                              </TR>
                            </THead>
                            <TBody>
                              {item.distractor_analysis.map(choice => (
                                <TR key={choice.choice_id}>
                                  <TD className="text-muted">{choice.choice_key}</TD>
                                  <TD className="text-foreground">{choice.choice_text}</TD>
                                  <TD numeric className="text-foreground">{choice.selection_count}</TD>
                                  <TD numeric className="text-foreground">
                                    {choice.selection_percentage.toFixed(1)}%
                                  </TD>
                                  <TD>
                                    {choice.is_correct ? (
                                      <Badge variant="success">Correct</Badge>
                                    ) : (
                                      <span className="text-muted">—</span>
                                    )}
                                  </TD>
                                </TR>
                              ))}
                            </TBody>
                          </Table>
                        </TD>
                        </TR>
                      )}
                    </Fragment>
                  ))}
                </TBody>
              </Table>
              <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted">
                <span>Discrimination:</span>
                {discriminationBadge(0.4)}
                {discriminationBadge(0.25)}
                {discriminationBadge(0.1)}
                {discriminationBadge(-0.1)}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
