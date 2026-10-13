import { router, Stack, useLocalSearchParams, useNavigation } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Alert } from '@/components/dialog';
import { ExerciseImage } from '@/components/exercise-image';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, EmptyState, Input, Row, Screen, SectionTitle } from '@/components/ui';
import { ROUTINE_COLOR_COUNT, Spacing } from '@/constants/theme';
import { useRoutineColors, useTheme } from '@/hooks/use-theme';
import { goBack } from '@/lib/navigation';
import { capitalize } from '@/lib/exercisedb';
import { getRoutine, saveRoutine } from '@/lib/repo';
import {
  beginDraft,
  clearDraft,
  isDraftDirty,
  newDraftKey,
  updateDraft,
  useRoutineDraft,
  type DraftExercise,
} from '@/lib/routine-draft';
import { formatRest } from '@/lib/stats';

const REST_STEP_SEC = 15;

/**
 * Creates (no `id` param) or edits a routine. Changes live in an in-memory
 * draft; only "Guardar" writes to the database and "Cancelar" discards them.
 */
export default function EditRoutineScreen() {
  const db = useSQLiteContext();
  const theme = useTheme();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const routineId = id ? Number(id) : null;
  const draft = useRoutineDraft();
  const [leaving, setLeaving] = useState<null | { savedId: number | null }>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (routineId == null) {
      // New routines take the next color in palette order.
      db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM routines').then((row) =>
        beginDraft({ routineId: null, name: '', color: (row?.n ?? 0) % ROUTINE_COLOR_COUNT, exercises: [] }),
      );
    } else {
      getRoutine(db, routineId).then((r) => {
        if (!r) return;
        beginDraft({
          routineId: r.id,
          name: r.name,
          color: r.color ?? r.id % ROUTINE_COLOR_COUNT,
          exercises: r.exercises.map((e) => ({
            key: newDraftKey(),
            exerciseId: e.exerciseId,
            name: e.name,
            gifUrl: e.gifUrl,
            targetSets: e.targetSets,
            repMin: e.repMin,
            repMax: e.repMax,
            incrementKg: e.incrementKg,
            restSec: e.restSec,
          })),
        });
      });
    }
    return clearDraft;
  }, [db, routineId]);

  const dirty = draft != null && leaving == null && isDraftDirty();

  // Ask before leaving with unsaved changes (back button, swipe, header back).
  usePreventRemove(dirty, ({ data }) => {
    Alert.alert('Descartar cambios', 'Tenés cambios sin guardar en esta rutina.', [
      { text: 'Seguir editando', style: 'cancel' },
      { text: 'Descartar', style: 'destructive', onPress: () => navigation.dispatch(data.action) },
    ]);
  });

  // Navigate only after the render that turned the leave guard off.
  useEffect(() => {
    if (!leaving) return;
    if (routineId == null && leaving.savedId != null) router.replace(`/routine/${leaving.savedId}`);
    else goBack();
  }, [leaving, routineId]);

  if (!draft) return <Screen>{null}</Screen>;

  const setExercise = (key: string, patch: Partial<DraftExercise>) =>
    updateDraft((d) => ({ ...d, exercises: d.exercises.map((e) => (e.key === key ? { ...e, ...patch } : e)) }));

  const move = (index: number, dir: -1 | 1) =>
    updateDraft((d) => {
      const to = index + dir;
      if (to < 0 || to >= d.exercises.length) return d;
      const exercises = [...d.exercises];
      [exercises[index], exercises[to]] = [exercises[to], exercises[index]];
      return { ...d, exercises };
    });

  const remove = (key: string) => updateDraft((d) => ({ ...d, exercises: d.exercises.filter((e) => e.key !== key) }));

  const save = async () => {
    const name = draft.name.trim();
    if (!name) {
      Alert.alert('Falta el nombre', 'Poné un nombre a la rutina antes de guardarla.');
      return;
    }
    setSaving(true);
    try {
      const savedId = await saveRoutine(db, {
        routineId: draft.routineId,
        name,
        color: draft.color,
        exercises: draft.exercises,
      });
      setLeaving({ savedId });
    } finally {
      setSaving(false);
    }
  };

  const cancel = () => {
    if (!isDraftDirty()) {
      setLeaving({ savedId: null });
      return;
    }
    Alert.alert('Descartar cambios', 'Se pierden los cambios que hiciste en esta rutina.', [
      { text: 'Seguir editando', style: 'cancel' },
      { text: 'Descartar', style: 'destructive', onPress: () => setLeaving({ savedId: null }) },
    ]);
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <Stack.Screen options={{ title: routineId == null ? 'Nueva rutina' : 'Editar rutina' }} />
      <Screen style={{ paddingBottom: 120 }}>
        <View style={{ gap: Spacing.one }}>
          <ThemedText type="smallBold" themeColor="textSecondary">
            Nombre
          </ThemedText>
          <Input
            placeholder="Ej: Push, Piernas, Full body A"
            value={draft.name}
            onChangeText={(name) => updateDraft((d) => ({ ...d, name }))}
            autoFocus={routineId == null}
          />
        </View>

        <View style={{ gap: Spacing.one }}>
          <ThemedText type="smallBold" themeColor="textSecondary">
            Color en el calendario
          </ThemedText>
          <ColorPicker value={draft.color} onChange={(color) => updateDraft((d) => ({ ...d, color }))} />
        </View>

        <SectionTitle>Ejercicios ({draft.exercises.length})</SectionTitle>
        {draft.exercises.length === 0 ? (
          <EmptyState title="Sin ejercicios" body="Agregá ejercicios de la base de ExerciseDB con el botón de abajo." />
        ) : (
          draft.exercises.map((ex, i) => (
            <ExerciseEditor
              key={ex.key}
              ex={ex}
              first={i === 0}
              last={i === draft.exercises.length - 1}
              onChange={(patch) => setExercise(ex.key, patch)}
              onMove={(dir) => move(i, dir)}
              onRemove={() => remove(ex.key)}
            />
          ))
        )}

        <Button
          title="+ Agregar ejercicio"
          variant="secondary"
          onPress={() => router.push({ pathname: '/exercise-picker', params: { draft: '1' } })}
        />
      </Screen>

      <View
        style={[
          styles.footer,
          { backgroundColor: theme.background, borderColor: theme.border, paddingBottom: Math.max(insets.bottom, Spacing.three) },
        ]}>
        <Button title="Cancelar" variant="secondary" onPress={cancel} style={{ flex: 1 }} disabled={saving} />
        <Button title="Guardar" onPress={save} loading={saving} style={{ flex: 1 }} />
      </View>
    </View>
  );
}

function ColorPicker({ value, onChange }: { value: number; onChange: (slot: number) => void }) {
  const colorOf = useRoutineColors();
  const theme = useTheme();
  return (
    <Row style={{ flexWrap: 'wrap' }}>
      {Array.from({ length: ROUTINE_COLOR_COUNT }, (_, slot) => {
        const selected = slot === value;
        return (
          <Pressable
            key={slot}
            onPress={() => onChange(slot)}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={`Color ${slot + 1}`}
            hitSlop={4}
            style={[styles.swatchRing, { borderColor: selected ? theme.text : 'transparent' }]}>
            <View style={[styles.swatch, { backgroundColor: colorOf(slot) }]} />
          </Pressable>
        );
      })}
    </Row>
  );
}

function NumberField({
  label,
  value,
  onCommit,
  decimal,
}: {
  label: string;
  value: number;
  onCommit: (v: number) => boolean;
  decimal?: boolean;
}) {
  const [text, setText] = useState(String(value));
  return (
    <View style={{ flex: 1, gap: 2 }}>
      <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
        {label}
      </ThemedText>
      <Input
        value={text}
        onChangeText={setText}
        keyboardType={decimal ? 'decimal-pad' : 'number-pad'}
        selectTextOnFocus
        style={{ paddingHorizontal: 10, textAlign: 'center' }}
        onBlur={() => {
          const n = Number(text.replace(',', '.'));
          if (!(Number.isFinite(n) && n >= 0 && onCommit(n))) setText(String(value));
        }}
      />
    </View>
  );
}

function ExerciseEditor({
  ex,
  first,
  last,
  onChange,
  onMove,
  onRemove,
}: {
  ex: DraftExercise;
  first: boolean;
  last: boolean;
  onChange: (patch: Partial<DraftExercise>) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
}) {
  const theme = useTheme();

  /** Applies a rep-range change only if it keeps min ≤ max. */
  const setReps = (patch: { repMin?: number; repMax?: number }) => {
    const repMin = patch.repMin ?? ex.repMin;
    const repMax = patch.repMax ?? ex.repMax;
    if (repMin > repMax) {
      Alert.alert('Rango inválido', 'Las reps mínimas no pueden superar a las máximas.');
      return false;
    }
    onChange(patch);
    return true;
  };

  return (
    <Card>
      <Row>
        <ExerciseImage uri={ex.gifUrl} />
        <ThemedText style={{ flex: 1, fontWeight: 700 }} numberOfLines={2}>
          {capitalize(ex.name)}
        </ThemedText>
        <View style={styles.moveButtons}>
          <Pressable disabled={first} onPress={() => onMove(-1)} hitSlop={8} accessibilityLabel="Subir">
            <ThemedText style={{ color: first ? theme.backgroundSelected : theme.accent }}>▲</ThemedText>
          </Pressable>
          <Pressable disabled={last} onPress={() => onMove(1)} hitSlop={8} accessibilityLabel="Bajar">
            <ThemedText style={{ color: last ? theme.backgroundSelected : theme.accent }}>▼</ThemedText>
          </Pressable>
        </View>
      </Row>
      <Row>
        <NumberField
          label="Series"
          value={ex.targetSets}
          onCommit={(v) => {
            onChange({ targetSets: Math.max(1, Math.round(v)) });
            return true;
          }}
        />
        <NumberField label="Reps mín" value={ex.repMin} onCommit={(v) => setReps({ repMin: Math.max(1, Math.round(v)) })} />
        <NumberField label="Reps máx" value={ex.repMax} onCommit={(v) => setReps({ repMax: Math.max(1, Math.round(v)) })} />
        <NumberField
          label="Salto kg"
          value={ex.incrementKg}
          decimal
          onCommit={(v) => {
            onChange({ incrementKg: v });
            return true;
          }}
        />
      </Row>
      <Row style={{ justifyContent: 'space-between' }}>
        <ThemedText type="small" themeColor="textSecondary">
          ⏱ Descanso {formatRest(ex.restSec)}
        </ThemedText>
        <Row style={{ gap: Spacing.one }}>
          <Button
            title={`−${REST_STEP_SEC}s`}
            small
            variant="secondary"
            onPress={() => onChange({ restSec: Math.max(REST_STEP_SEC, ex.restSec - REST_STEP_SEC) })}
          />
          <Button
            title={`+${REST_STEP_SEC}s`}
            small
            variant="secondary"
            onPress={() => onChange({ restSec: ex.restSec + REST_STEP_SEC })}
          />
          <Button title="Quitar" small variant="ghost" onPress={onRemove} />
        </Row>
      </Row>
    </Card>
  );
}

const styles = StyleSheet.create({
  moveButtons: { gap: Spacing.two, alignItems: 'center' },
  swatchRing: { borderRadius: 20, borderWidth: 2, padding: 2 },
  swatch: { width: 30, height: 30, borderRadius: 15 },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
