import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useMemo, useState } from 'react';
import { View } from 'react-native';
import { Calendar, LocaleConfig } from 'react-native-calendars';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, EmptyState, Row, Screen, SectionTitle, Segmented, StatTile } from '@/components/ui';
import { WorkoutCard } from '@/components/workout-card';
import { useFocusData } from '@/hooks/use-focus-data';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useRoutineColors, useTheme } from '@/hooks/use-theme';
import { addDays, fromDayKey, longDate, startOfWeek, toDayKey } from '@/lib/dates';
import { capitalize } from '@/lib/exercisedb';
import { getWorkoutsForDay, listHistory, listRoutines, listTrainingDays } from '@/lib/repo';

LocaleConfig.locales.es = {
  monthNames: [
    'Enero',
    'Febrero',
    'Marzo',
    'Abril',
    'Mayo',
    'Junio',
    'Julio',
    'Agosto',
    'Septiembre',
    'Octubre',
    'Noviembre',
    'Diciembre',
  ],
  monthNamesShort: ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'],
  dayNames: ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'],
  dayNamesShort: ['D', 'L', 'M', 'M', 'J', 'V', 'S'],
  today: 'Hoy',
};
LocaleConfig.defaultLocale = 'es';

const PAGE_SIZE = 20;

type HistoryView = 'list' | 'calendar';

export default function HistoryScreen() {
  const [view, setView] = useState<HistoryView>('list');
  return (
    <Screen tabs>
      <ThemedText type="subtitle">Historial</ThemedText>
      <Segmented
        options={[
          { value: 'list', label: 'Entrenamientos' },
          { value: 'calendar', label: 'Calendario' },
        ]}
        value={view}
        onChange={setView}
      />
      {view === 'list' ? <HistoryList /> : <HistoryCalendar />}
    </Screen>
  );
}

function HistoryList() {
  const db = useSQLiteContext();
  const [pages, setPages] = useState(1);
  const { data: workouts } = useFocusData(useCallback(() => listHistory(db, PAGE_SIZE * pages), [db, pages]));

  if (workouts && workouts.length === 0) {
    return (
      <EmptyState
        title="Todavía no hay entrenamientos"
        body="Cuando termines un entrenamiento va a quedar guardado acá con sus ejercicios y series."
      />
    );
  }
  return (
    <>
      {workouts?.map((w) => (
        <WorkoutCard key={w.id} workout={w} />
      ))}
      {workouts && workouts.length === PAGE_SIZE * pages ? (
        <Button title="Ver más" variant="ghost" onPress={() => setPages((p) => p + 1)} />
      ) : null}
    </>
  );
}

/** Consecutive weeks (ending this week or last) with at least one workout. */
function weekStreak(days: string[]): number {
  const weeks = new Set(days.map((d) => toDayKey(startOfWeek(fromDayKey(d)))));
  let cursor = startOfWeek(new Date());
  if (!weeks.has(toDayKey(cursor))) cursor = addDays(cursor, -7);
  let streak = 0;
  while (weeks.has(toDayKey(cursor))) {
    streak++;
    cursor = addDays(cursor, -7);
  }
  return streak;
}

function HistoryCalendar() {
  const db = useSQLiteContext();
  const theme = useTheme();
  const scheme = useColorScheme();
  const colorOf = useRoutineColors();
  const [selected, setSelected] = useState(toDayKey(new Date()));
  const [month, setMonth] = useState(toDayKey(new Date()).slice(0, 7));

  const { data } = useFocusData(
    useCallback(async () => {
      const [days, routines] = await Promise.all([listTrainingDays(db), listRoutines(db)]);
      return { days, routines };
    }, [db]),
  );
  const { data: workouts } = useFocusData(useCallback(() => getWorkoutsForDay(db, selected), [db, selected]));

  // Each trained day gets a ring in the color of its (first) routine.
  const marked = useMemo(() => {
    const m: Record<string, object> = {};
    for (const d of data?.days ?? []) {
      m[d.date] = {
        customStyles: {
          container: { borderWidth: 2.5, borderColor: colorOf(d.colors[0]), borderRadius: 18 },
          text: { color: theme.text, fontWeight: '700' },
        },
      };
    }
    const sel = (m[selected] as { customStyles?: { container?: object; text?: object } } | undefined)?.customStyles;
    m[selected] = {
      customStyles: {
        container: { ...(sel?.container ?? { borderRadius: 18 }), backgroundColor: theme.backgroundSelected },
        text: sel?.text ?? { color: theme.text },
      },
    };
    return m;
  }, [data, selected, theme, colorOf]);

  const days = data?.days ?? [];
  const inMonth = days.filter((d) => d.date.startsWith(month)).reduce((n, d) => n + d.workouts, 0);
  const usedColors = new Set(days.flatMap((d) => d.colors));

  return (
    <>
      <Card style={{ padding: 4 }}>
        <Calendar
          key={scheme}
          firstDay={1}
          current={selected}
          markingType="custom"
          markedDates={marked}
          onDayPress={(d: { dateString: string }) => setSelected(d.dateString)}
          onMonthChange={(d: { dateString: string }) => setMonth(d.dateString.slice(0, 7))}
          enableSwipeMonths
          theme={{
            calendarBackground: 'transparent',
            dayTextColor: theme.text,
            monthTextColor: theme.text,
            textSectionTitleColor: theme.textSecondary,
            textDisabledColor: theme.backgroundSelected,
            todayTextColor: theme.accent,
            arrowColor: theme.accent,
            textDayFontWeight: '500',
            textMonthFontWeight: '700',
          }}
        />
      </Card>

      {/* Legend: color alone never identifies the routine. */}
      <Row style={{ flexWrap: 'wrap', rowGap: 4 }}>
        {data?.routines
          .filter((r) => usedColors.has(r.color))
          .map((r) => (
            <Row key={r.id} style={{ gap: 6, marginRight: 12 }}>
              <View style={{ width: 12, height: 12, borderRadius: 6, borderWidth: 2.5, borderColor: colorOf(r.color) }} />
              <ThemedText type="small" themeColor="textSecondary">
                {r.name}
              </ThemedText>
            </Row>
          ))}
        {usedColors.has(null) ? (
          <Row style={{ gap: 6 }}>
            <View style={{ width: 12, height: 12, borderRadius: 6, borderWidth: 2.5, borderColor: colorOf(null) }} />
            <ThemedText type="small" themeColor="textSecondary">
              Libre
            </ThemedText>
          </Row>
        ) : null}
      </Row>

      <Row>
        <StatTile label="Este mes" value={String(inMonth)} hint="entrenamientos" />
        <StatTile label="Racha" value={String(weekStreak(days.map((d) => d.date)))} hint="semanas seguidas" />
        <StatTile label="Total" value={String(days.length)} hint="días entrenados" />
      </Row>

      <SectionTitle>{capitalize(longDate(fromDayKey(selected)))}</SectionTitle>
      {workouts && workouts.length === 0 ? (
        <EmptyState title="Día de descanso" body="No registraste entrenamientos este día." />
      ) : (
        workouts?.map((w) => <WorkoutCard key={w.id} workout={w} />)
      )}
    </>
  );
}
