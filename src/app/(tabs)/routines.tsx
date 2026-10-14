import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback } from 'react';
import { Pressable, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, EmptyState, Row, Screen, SectionTitle } from '@/components/ui';
import { useFocusData } from '@/hooks/use-focus-data';
import { useRoutineColors } from '@/hooks/use-theme';
import { fromDayKey, shortDate } from '@/lib/dates';
import { listRoutines } from '@/lib/repo';

export default function RoutinesScreen() {
  const db = useSQLiteContext();
  const colorOf = useRoutineColors();
  const { data: routines } = useFocusData(useCallback(() => listRoutines(db), [db]));

  return (
    <Screen tabs>
      <ThemedText type="subtitle">Rutinas</ThemedText>
      <Button title="+ Nueva rutina" onPress={() => router.push('/routine/edit')} />

      <SectionTitle>Mis rutinas</SectionTitle>
      {routines && routines.length === 0 ? (
        <EmptyState title="Sin rutinas" body="Creá tu primera rutina con el botón de arriba." />
      ) : (
        routines?.map((r) => (
          <Pressable key={r.id} onPress={() => router.push(`/routine/${r.id}`)} accessibilityRole="button">
            <Card style={{ borderWidth: 2, borderColor: colorOf(r.color) }}>
              <Row style={{ justifyContent: 'space-between' }}>
                <View style={{ flex: 1 }}>
                  <ThemedText style={{ fontWeight: 700 }} numberOfLines={1}>
                    {r.name}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {r.exerciseCount} ejercicios ·{' '}
                    {r.lastDone ? `Última vez: ${shortDate(fromDayKey(r.lastDone))}` : 'Nunca realizada'}
                  </ThemedText>
                </View>
                <Button
                  title="Editar"
                  small
                  variant="ghost"
                  onPress={() => router.push({ pathname: '/routine/edit', params: { id: String(r.id) } })}
                />
              </Row>
            </Card>
          </Pressable>
        ))
      )}
    </Screen>
  );
}
