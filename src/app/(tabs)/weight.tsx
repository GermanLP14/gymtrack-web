import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { TrendChart } from '@/components/charts';
import { Alert } from '@/components/dialog';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, EmptyState, Input, Row, Screen, SectionTitle } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useContentWidth } from '@/hooks/use-content-width';
import { useFocusData } from '@/hooks/use-focus-data';
import { useTheme } from '@/hooks/use-theme';
import {
  deleteWeight,
  getTargetWeight,
  listWeights,
  saveWeight,
  setTargetWeight,
  storeProgressPhoto,
  type WeightEntry,
} from '@/lib/body';
import { fromDayKey, longDate, shortDate, toDayKey } from '@/lib/dates';
import { capitalize } from '@/lib/exercisedb';
import { formatKg } from '@/lib/stats';

function parseKg(text: string): number | null {
  const n = Number(text.replace(',', '.'));
  return text.trim() !== '' && Number.isFinite(n) && n >= 20 && n <= 400 ? Math.round(n * 10) / 10 : null;
}

export default function WeightScreen() {
  const db = useSQLiteContext();
  const width = useContentWidth();
  const { data, reload } = useFocusData(
    useCallback(async () => {
      const [entries, target] = await Promise.all([listWeights(db), getTargetWeight(db)]);
      return { entries, target };
    }, [db]),
  );
  const [viewing, setViewing] = useState<WeightEntry | null>(null);

  if (!data) return <Screen tabs>{null}</Screen>;
  const { entries, target } = data;
  const today = toDayKey(new Date());
  const todayEntry = entries.find((e) => e.date === today) ?? null;
  const chronological = [...entries].reverse();

  return (
    <Screen tabs>
      <ThemedText type="subtitle">Peso</ThemedText>

      <TargetCard
        target={target}
        current={entries[0]?.weight ?? null}
        start={chronological[0]?.weight ?? null}
        onChanged={reload}
      />

      <SectionTitle>{todayEntry ? 'Hoy (ya registrado)' : 'Registrar hoy'}</SectionTitle>
      <TodayForm key={todayEntry?.id ?? 'new'} entry={todayEntry} lastWeight={entries[0]?.weight ?? null} onSaved={reload} />

      {chronological.length >= 2 ? (
        <>
          <SectionTitle>Evolución</SectionTitle>
          <Card>
            <TrendChart
              width={width - Spacing.three * 4}
              data={chronological.slice(-60).map((e) => ({
                value: e.weight,
                label: shortDate(fromDayKey(e.date)),
                tooltip: `${shortDate(fromDayKey(e.date))}: ${formatKg(e.weight)}`,
              }))}
            />
          </Card>
        </>
      ) : null}

      <SectionTitle>Registros</SectionTitle>
      {entries.length === 0 ? (
        <EmptyState title="Sin registros" body="Anotá tu peso hoy para empezar a ver tu evolución." />
      ) : (
        entries.map((e, i) => (
          <EntryRow key={e.id} entry={e} previous={entries[i + 1] ?? null} onOpenPhoto={() => setViewing(e)} onChanged={reload} />
        ))
      )}

      <PhotoViewer entry={viewing} onClose={() => setViewing(null)} />
    </Screen>
  );
}

function TargetCard({
  target,
  current,
  start,
  onChanged,
}: {
  target: number | null;
  current: number | null;
  start: number | null;
  onChanged: () => void;
}) {
  const db = useSQLiteContext();
  const theme = useTheme();
  const [editing, setEditing] = useState(target == null);
  const [text, setText] = useState(target != null ? String(target) : '');

  const save = async () => {
    const kg = parseKg(text);
    if (kg == null) {
      Alert.alert('Peso inválido', 'Ingresá tu peso objetivo en kg, por ejemplo 75,5.');
      return;
    }
    await setTargetWeight(db, kg);
    setEditing(false);
    onChanged();
  };

  const diff = target != null && current != null ? current - target : null;
  // Progress from the first logged weight toward the target, whichever direction.
  const progress =
    target != null && current != null && start != null && start !== target
      ? Math.min(1, Math.max(0, (start - current) / (start - target)))
      : null;

  return (
    <Card style={{ alignItems: 'center', paddingVertical: Spacing.four }}>
      <ThemedText type="smallBold" themeColor="textSecondary" style={{ textTransform: 'uppercase', letterSpacing: 0.6 }}>
        Peso objetivo
      </ThemedText>
      {editing ? (
        <View style={{ width: '100%', gap: Spacing.two }}>
          <Input
            value={text}
            onChangeText={setText}
            keyboardType="decimal-pad"
            placeholder="Ej: 75"
            style={styles.targetInput}
            autoFocus={target != null}
            onSubmitEditing={save}
          />
          <Button title="Guardar objetivo" onPress={save} />
        </View>
      ) : (
        <Pressable onPress={() => setEditing(true)} accessibilityRole="button" accessibilityHint="Editar peso objetivo">
          <ThemedText style={styles.targetValue}>{formatKg(target!)}</ThemedText>
        </Pressable>
      )}
      {!editing && diff != null ? (
        <ThemedText themeColor="textSecondary">
          {Math.abs(diff) < 0.1
            ? '¡Llegaste a tu objetivo!'
            : `${diff > 0 ? 'Te faltan bajar' : 'Te faltan subir'} ${formatKg(Math.abs(diff))} · hoy ${formatKg(current!)}`}
        </ThemedText>
      ) : null}
      {!editing && progress != null ? (
        <View style={[styles.track, { backgroundColor: theme.backgroundSelected }]}>
          <View style={[styles.fill, { width: `${progress * 100}%`, backgroundColor: theme.accent }]} />
        </View>
      ) : null}
      {!editing ? (
        <ThemedText type="small" themeColor="textSecondary">
          Tocá el número para cambiarlo
        </ThemedText>
      ) : null}
    </Card>
  );
}

function TodayForm({
  entry,
  lastWeight,
  onSaved,
}: {
  entry: WeightEntry | null;
  lastWeight: number | null;
  onSaved: () => void;
}) {
  const db = useSQLiteContext();
  const [text, setText] = useState(entry ? String(entry.weight) : lastWeight != null ? String(lastWeight) : '');
  const [photo, setPhoto] = useState<string | null>(null); // newly picked, not yet saved
  const [saving, setSaving] = useState(false);
  const shownPhoto = photo ?? entry?.photoUri ?? null;

  // Opens the browser's file chooser (on phones it also offers the camera).
  const pick = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'] });
    if (!result.canceled) setPhoto(result.assets[0].uri);
  };

  const save = async () => {
    const kg = parseKg(text);
    if (kg == null) {
      Alert.alert('Peso inválido', 'Ingresá tu peso en kg, por ejemplo 80,4.');
      return;
    }
    setSaving(true);
    try {
      const date = toDayKey(new Date());
      const stored = photo ? await storeProgressPhoto(photo) : undefined;
      await saveWeight(db, date, kg, stored);
      setPhoto(null);
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <ThemedText type="small" themeColor="textSecondary">
        {capitalize(longDate(new Date()))}
      </ThemedText>
      <Row>
        <Input
          value={text}
          onChangeText={setText}
          keyboardType="decimal-pad"
          placeholder="Peso en kg"
          style={{ flex: 1, fontSize: 22 }}
        />
        <ThemedText themeColor="textSecondary">kg</ThemedText>
      </Row>
      {shownPhoto ? (
        <Image
          source={{ uri: shownPhoto }}
          style={styles.preview}
          contentFit="cover"
          accessibilityLabel="Foto de progreso de hoy"
        />
      ) : null}
      <Button title={shownPhoto ? 'Cambiar foto' : '📷 Agregar foto'} small variant="secondary" onPress={pick} />
      <Button title={entry ? 'Actualizar registro de hoy' : 'Guardar peso'} onPress={save} loading={saving} />
    </Card>
  );
}

function EntryRow({
  entry,
  previous,
  onOpenPhoto,
  onChanged,
}: {
  entry: WeightEntry;
  previous: WeightEntry | null;
  onOpenPhoto: () => void;
  onChanged: () => void;
}) {
  const db = useSQLiteContext();
  const delta = previous ? entry.weight - previous.weight : null;

  const remove = () =>
    Alert.alert(
      'Eliminar registro',
      `${formatKg(entry.weight)} del ${shortDate(fromDayKey(entry.date))}${entry.photoUri ? ' y su foto' : ''}.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: async () => {
            await deleteWeight(db, entry);
            onChanged();
          },
        },
      ],
    );

  return (
    <Card>
      <Row>
        {entry.photoUri ? (
          <Pressable onPress={onOpenPhoto} accessibilityRole="imagebutton" accessibilityLabel="Ver foto">
            <Image source={{ uri: entry.photoUri }} style={styles.thumb} contentFit="cover" />
          </Pressable>
        ) : null}
        <View style={{ flex: 1 }}>
          <ThemedText style={{ fontWeight: 700 }}>{formatKg(entry.weight)}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {capitalize(longDate(fromDayKey(entry.date)))}
          </ThemedText>
        </View>
        {delta != null ? (
          <ThemedText type="smallBold" themeColor="textSecondary">
            {delta === 0 ? '=' : `${delta > 0 ? '▲ +' : '▼ '}${formatKg(delta).replace('-', '')}`}
          </ThemedText>
        ) : null}
        <Button title="Eliminar" small variant="ghost" onPress={remove} />
      </Row>
    </Card>
  );
}

function PhotoViewer({ entry, onClose }: { entry: WeightEntry | null; onClose: () => void }) {
  return (
    <Modal visible={entry?.photoUri != null} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.viewer} onPress={onClose} accessibilityLabel="Cerrar foto">
        {entry?.photoUri ? <Image source={{ uri: entry.photoUri }} style={StyleSheet.absoluteFill} contentFit="contain" /> : null}
        {entry ? (
          <View style={styles.viewerCaption}>
            <ThemedText style={{ color: '#fff', fontWeight: 700 }}>
              {formatKg(entry.weight)} · {capitalize(longDate(fromDayKey(entry.date)))}
            </ThemedText>
          </View>
        ) : null}
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  targetValue: { fontSize: 56, lineHeight: 64, fontWeight: 800 },
  targetInput: { fontSize: 32, textAlign: 'center', fontWeight: 700 },
  track: { height: 8, borderRadius: 4, overflow: 'hidden', alignSelf: 'stretch', marginTop: Spacing.one },
  fill: { height: 8, borderRadius: 4 },
  preview: { width: '100%', aspectRatio: 3 / 4, borderRadius: 12 },
  thumb: { width: 56, height: 72, borderRadius: 8 },
  viewer: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)' },
  viewerCaption: { position: 'absolute', left: 0, right: 0, bottom: 48, alignItems: 'center' },
});
