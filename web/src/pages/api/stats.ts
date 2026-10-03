import type { APIRoute } from 'astro';
import { json } from '../../lib/server/http';
import { appState, sessionSeries, streakCalendar, tagComparison, warmupRangeSeries } from '../../lib/server/stats';

export const GET: APIRoute = ({ url }) => {
  const days = Math.min(730, Number(url.searchParams.get('days')) || 120);
  return json({
    state: appState(),
    series: sessionSeries(days),
    warmupRange: warmupRangeSeries(days),
    calendar: streakCalendar(days),
    compare: tagComparison(30),
  });
};
