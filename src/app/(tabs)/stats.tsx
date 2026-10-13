import { Picker } from '@react-native-picker/picker';
import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { Platform, View } from 'react-native';

import { BarsChart, TrendChart } from '@/components/charts';
import { CoachCard } from '@/components/coach-card';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, EmptyState, Row, Screen, SectionTitle, Segmented, StatTile } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useContentWidth } from '@/hooks/use-content-width';
import { useFocusData } from '@/hooks/use-focus-data';
import { useTheme } from '@/hooks/use-theme';
import { capitalize } from '@/lib/exercisedb';
import { addDays, fromDayKey, monthLabel, shortDate, toDayKey } from '@/lib/dates';
import { recommend } from '@/lib/progression';
import { getExerciseSessions, getTargetFor, listTrackedExercises, monthlyWorkouts, weeklyVolume } from '@/lib/repo';
import { formatKg, formatNumber, percentChange, sessionMetrics, type SessionMetrics } from '@/lib/stats';

type Metric = 'maxWeight' | 'bestE1rm' | 'volume' | 'maxReps';
type Range = '1m' | '3m' | '6m' | 'all';

const METRICS: { value: Metric; label: string }[] = [
  { value: 'maxWeight', label: 'Peso máx' },
  { value: 'bestE1rm', label: '1RM est.' },
  { value: 'volume', label: 'Volumen' },
  { value: 'maxReps', label: 'Reps' },
];

const RANGES: { value: Range; label: string }[] = [
  { value: '1m', label: '1 mes' },
  { value: '3m', label: '3 meses' },
  { value: '6m', label: '6 meses' },
  { value: 'all', label: 'Todo' },
];

const RANGE_DAYS: Record<Range, number | null> = { '1m': 30, '3m': 91, '6m': 182, all: null };

function formatMetric(metric: Metric, value: number): string {
  if (metric === 'maxReps') return `${value} reps`;
  if (metric === 'volume') return `${formatNumber(value)} kg`;
  return formatKg(value);
}

export default function StatsScreen() {
  const db = useSQLiteContext();
  const theme = useTheme();
  const width = useContentWidth();
  const chartWidth = width - Spacing.three * 4;

  const [exerciseId, setExerciseId] = useState<string | null>(null);
  const [metric, setMetric] = useState<Metric>('bestE1rm');
  const [range, setRange] = useState<Range>('3m');

  const { data: overview } = useFocusData(
    useCallback(async () => {
      const [tracked, weeks, months] = await Promise.all([
        listTrackedExercises(db),
        weeklyVolume(db, 12),
        monthlyWorkouts(db, 6),
      ]);
      return { tracked, weeks, months };
    }, [db]),
  );

  // Default to the most recently trained exercise.
  const tracked = overview?.tracked ?? [];
  const selectedId = tracked.some((t) => t.id === exerciseId)
    ? exerciseId
    : ([...tracked].sort((a, b) => b.lastDate.localeCompare(a.lastDate))[0]?.id ?? null);

  const { data: detail } = useFocusData(
    useCallback(async () => {
      if (!selectedId) return null;
      const days = RANGE_DAYS[range];
      const since = days != null ? toDayKey(addDays(new Date(), -days)) : undefined;
      const [all, target] = await Promise.all([getExerciseSessions(db, selectedId), getTargetFor(db, selectedId)]);
      const sessions = since ? all.filter((s) => s.date >= since) : all;
      const withMetrics = sessions.map((s) => ({ ...s, m: sessionMetrics(s.sets) }));
      return { exerciseId: selectedId, sessions: withMetrics, rec: recommend(all, target) };
    }, [db, selectedId, range]),
  );

  if (overview && overview.tracked.length === 0) {
    return (
      <Screen tabs>
        <ThemedText type="subtitle">Estadísticas</ThemedText>
        <EmptyState
          title="Todavía no hay datos"
          body="Terminá tu primer entrenamiento y acá vas a ver la evolución de cada ejercicio."
        />
      </Screen>
    );
  }

  const points = detail?.sessions ?? [];
  const values = points.map((p) => p.m[metric]);
  const best = values.length ? Math.max(...values) : 0;
  const change = values.length >= 2 ? percentChange(values[0], values[values.length - 1]) : null;
  const changeColor = change == null ? undefined : change >= 0 ? theme.success : theme.danger;

  return (
    <Screen tabs>
      <ThemedText type="subtitle">Estadísticas</ThemedText>

      <SectionTitle>Progreso por ejercicio</SectionTitle>
      <Card style={{ paddingVertical: Platform.OS === 'ios' ? 0 : Spacing.two }}>
        <Picker
          selectedValue={selectedId ?? undefined}
          onValueChange={(v) => setExerciseId(String(v))}
          mode="dropdown"
          dropdownIconColor={theme.text}
          style={{ color: theme.text }}
          itemStyle={{ color: theme.text, fontSize: 17, height: 130 }}
          accessibilityLabel="Ejercicio">
          {overview?.tracked.map((t) => (
            <Picker.Item key={t.id} label={`${capitalize(t.name)} (${t.sessions})`} value={t.id} />
          ))}
        </Picker>
      </Card>

      <Segmented options={METRICS} value={metric} onChange={setMetric} />
      <Segmented options={RANGES} value={range} onChange={setRange} />

      <Card>
        {points.length === 0 ? (
          <ThemedText themeColor="textSecondary" style={{ textAlign: 'center', paddingVertical: Spacing.five }}>
            Sin sesiones en este rango.
          </ThemedText>
        ) : (
          <TrendChart
            key={`${detail?.exerciseId}-${metric}-${range}`}
            width={chartWidth}
            data={points.map((p) => ({
              value: p.m[metric],
              label: shortDate(fromDayKey(p.date)),
              tooltip: `${shortDate(fromDayKey(p.date))}: ${formatMetric(metric, p.m[metric])}`,
            }))}
          />
        )}
      </Card>

      <Row>
        <StatTile label="Mejor" value={formatMetric(metric, best)} />
        <StatTile
          label="Cambio"
          value={change != null ? `${change >= 0 ? '+' : ''}${change.toFixed(1)} %` : '—'}
          hint={change != null ? (change >= 0 ? '▲ mejorando' : '▼ bajando') : 'faltan sesiones'}
          hintColor={changeColor}
        />
        <StatTile label="Sesiones" value={String(points.length)} />
      </Row>

      {detail ? (
        <>
          <SectionTitle
            action={
              <Button title="Ver ejercicio" small variant="ghost" onPress={() => router.push(`/exercise/${detail.exerciseId}`)} />
            }>
            Coach
          </SectionTitle>
          <CoachCard rec={detail.rec} />
        </>
      ) : null}

      {points.length > 0 ? (
        <>
          <SectionTitle>Historial</SectionTitle>
          <Card style={{ gap: 0 }}>
            <HistoryRow header cells={['Fecha', 'Series', 'Peso máx', '1RM est.']} />
            {[...points]
              .reverse()
              .slice(0, 12)
              .map((p) => (
                <HistoryRow key={p.workoutId} cells={historyCells(p.date, p.m, p.sets.length)} />
              ))}
          </Card>
        </>
      ) : null}

      <SectionTitle>Volumen semanal (12 semanas)</SectionTitle>
      <Card>
        {overview ? (
          <BarsChart
            width={chartWidth}
            highlightLast
            data={overview.weeks.map((w) => ({
              value: Math.round(w.volume),
              label: shortDate(fromDayKey(w.weekStart)),
              tooltip: `Semana del ${shortDate(fromDayKey(w.weekStart))}: ${formatNumber(w.volume)} kg · ${w.workouts} entrenos`,
            }))}
          />
        ) : null}
      </Card>

      <SectionTitle>Entrenamientos por mes</SectionTitle>
      <Card>
        {overview ? (
          <BarsChart
            width={chartWidth}
            highlightLast
            data={overview.months.map((m) => {
              const label = monthLabel(fromDayKey(`${m.month}-01`));
              return { value: m.workouts, label, tooltip: `${capitalize(label)}: ${m.workouts} entrenamientos` };
            })}
          />
        ) : null}
      </Card>
    </Screen>
  );
}

function historyCells(date: string, m: SessionMetrics, sets: number): string[] {
  return [shortDate(fromDayKey(date)), String(sets), formatKg(m.maxWeight), formatKg(m.bestE1rm)];
}

function HistoryRow({ cells, header }: { cells: string[]; header?: boolean }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', paddingVertical: 8, borderBottomWidth: header ? 1 : 0, borderColor: theme.border }}>
      {cells.map((c, i) => (
        <ThemedText
          key={i}
          type={header ? 'smallBold' : 'small'}
          themeColor={header ? 'textSecondary' : 'text'}
          style={{ flex: 1, textAlign: i === 0 ? 'left' : 'right' }}>
          {c}
        </ThemedText>
      ))}
    </View>
  );
}
