'use client';

import { useState, useEffect, useCallback } from 'react';
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend, ArcElement } from 'chart.js';
import { Bar, Pie } from 'react-chartjs-2';
import Badge from '@/components/ui/Badge';
import Spinner from '@/components/ui/Spinner';
import EmptyState from '@/components/ui/EmptyState';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table';
import { notifyError } from '@/components/ui/alerts';
import { DIFFICULTY_LABELS, BLOOM_LABELS } from '@/lib/constants';
import {
  getDeploymentAnalytics,
  type DeploymentAnalytics,
  type ItemAnalysis,
} from './actions';

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend, ArcElement);

interface AnalyticsClientProps {
  deploymentId: string;
}

export default function AnalyticsClient({ deploymentId }: AnalyticsClientProps) {
  const [analytics, setAnalytics] = useState<DeploymentAnalytics | null>(null);
  const [loading, setLoading] = useState(true);

  const loadAnalytics = useCallback(async () => {
    setLoading(true);
    const result = await getDeploymentAnalytics(deploymentId);
    if (result.error) {
      notifyError(result.error);
    } else {
      setAnalytics(result.data);
    }
    setLoading(false);
  }, [deploymentId]);

  useEffect(() => {
    loadAnalytics();
  }, [loadAnalytics]);

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
        <CardHeader>
          <h3 className="text-base font-semibold text-foreground">Item Analysis</h3>
          <p className="text-sm text-muted">Difficulty index: P = R/N (proportion correct)</p>
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
                    <TH>Rating</TH>
                  </TR>
                </THead>
                <TBody>
                  {analytics.item_analysis.map((item, index) => (
                    <TR key={item.question_id}>
                      <TD numeric className="text-muted">{index + 1}</TD>
                      <TD className="max-w-xs">
                        <span className="line-clamp-2 text-foreground">{item.question_text}</span>
                      </TD>
                      <TD className="text-muted">{item.question_type === 'multiple_choice' ? 'MCQ' : 'ID'}</TD>
                      <TD className="text-muted">{DIFFICULTY_LABELS[item.difficulty as keyof typeof DIFFICULTY_LABELS]}</TD>
                      <TD className="text-muted">{BLOOM_LABELS[item.bloom_level as keyof typeof BLOOM_LABELS]}</TD>
                      <TD numeric className="text-foreground">{item.total_responses}</TD>
                      <TD numeric className="text-foreground">{item.correct_count}</TD>
                      <TD numeric className="text-foreground">{item.difficulty_index.toFixed(2)}</TD>
                      <TD>
                        <Badge variant={
                          item.difficulty_index >= 0.6 ? 'success' :
                          item.difficulty_index >= 0.4 ? 'warning' : 'danger'
                        }>
                          {item.difficulty_index >= 0.6 ? 'Good' :
                           item.difficulty_index >= 0.4 ? 'Moderate' : 'Difficult'}
                        </Badge>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
