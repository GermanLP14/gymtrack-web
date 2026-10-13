import { Stack } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { Linking, Switch } from 'react-native';

import { Alert } from '@/components/dialog';
import { ProfileForm } from '@/components/profile-form';
import { SyncSettings } from '@/components/sync-settings';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, Input, Row, Screen, SectionTitle, Segmented } from '@/components/ui';
import { useFocusData } from '@/hooks/use-focus-data';
import { useTheme } from '@/hooks/use-theme';
import { AI_MODELS, getApiKey, setApiKey, type AiModel } from '@/lib/ai';
import { bmr } from '@/lib/calories';
import { getEffectiveProfile, getProfile, saveProfile } from '@/lib/body';
import { getThemePref, setThemePref, type ThemePref } from '@/lib/preferences';
import { getSetting, setSetting } from '@/lib/repo';
import { formatNumber } from '@/lib/stats';

export default function SettingsScreen() {
  const db = useSQLiteContext();
  const { data, reload } = useFocusData(
    useCallback(async () => {
      const [profile, effective, theme, key, model, auto] = await Promise.all([
        getProfile(db),
        getEffectiveProfile(db),
        getThemePref(db),
        getApiKey(),
        getSetting(db, 'aiModel'),
        getSetting(db, 'aiAuto'),
      ]);
      return {
        profile,
        effective,
        theme,
        hasKey: !!key,
        model: (model ?? 'claude-opus-5') as AiModel,
        auto: auto !== '0',
      };
    }, [db]),
  );

  if (!data) return <Screen>{null}</Screen>;

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Ajustes' }} />

      <SectionTitle>Perfil</SectionTitle>
      <Card>
        <ProfileForm
          key={JSON.stringify(data.profile)}
          initial={data.profile}
          submitLabel="Guardar perfil"
          onSubmit={async (p) => {
            await saveProfile(db, p);
            await reload();
            Alert.alert('Perfil guardado', 'Los próximos entrenamientos van a usar estos datos.');
          }}
        />
        {data.effective ? (
          <ThemedText type="small" themeColor="textSecondary">
            Metabolismo basal estimado: {formatNumber(bmr(data.effective))} kcal/día. Para las calorías se usa tu último peso
            registrado ({data.effective.weightKg} kg).
          </ThemedText>
        ) : null}
      </Card>

      <SectionTitle>Apariencia</SectionTitle>
      <Segmented<ThemePref>
        options={[
          { value: 'system', label: 'Sistema' },
          { value: 'light', label: 'Claro' },
          { value: 'dark', label: 'Oscuro' },
        ]}
        value={data.theme}
        onChange={async (pref) => {
          await setThemePref(db, pref);
          await reload();
        }}
      />

      <SectionTitle>Sincronización</SectionTitle>
      <SyncSettings />

      <SectionTitle>IA · Claude</SectionTitle>
      <AiSettings hasKey={data.hasKey} model={data.model} auto={data.auto} onChanged={reload} />

      <ThemedText type="small" themeColor="textSecondary" style={{ textAlign: 'center' }}>
        Ejercicios e imágenes: ExerciseDB
      </ThemedText>
    </Screen>
  );
}

function AiSettings({
  hasKey,
  model,
  auto,
  onChanged,
}: {
  hasKey: boolean;
  model: AiModel;
  auto: boolean;
  onChanged: () => void;
}) {
  const db = useSQLiteContext();
  const theme = useTheme();
  const [key, setKey] = useState('');

  const saveKey = async () => {
    const trimmed = key.trim();
    if (!trimmed.startsWith('sk-ant-')) {
      Alert.alert('Clave inválida', 'Las API keys de Anthropic empiezan con "sk-ant-".');
      return;
    }
    await setApiKey(trimmed);
    setKey('');
    onChanged();
  };

  return (
    <Card>
      <ThemedText type="small" themeColor="textSecondary">
        Al terminar un entrenamiento, Claude compara tu rendimiento con la vez anterior del mismo tipo y te da consejos para la
        semana. Cada resumen es una sola consulta corta.
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Las apps no pueden usar una suscripción de claude.ai: hace falta una API key de Anthropic (se paga por uso, aparte de la
        suscripción). La clave queda guardada sin cifrar en este navegador: no la cargues en una computadora compartida.
      </ThemedText>
      <Button
        title="Crear una API key en console.anthropic.com"
        small
        variant="ghost"
        onPress={() => Linking.openURL('https://console.anthropic.com/settings/keys')}
      />

      {hasKey ? (
        <Row style={{ justifyContent: 'space-between' }}>
          <ThemedText style={{ color: theme.success, fontWeight: 700 }}>✓ API key guardada</ThemedText>
          <Button
            title="Quitar"
            small
            variant="ghost"
            onPress={async () => {
              await setApiKey(null);
              onChanged();
            }}
          />
        </Row>
      ) : (
        <>
          <Input
            value={key}
            onChangeText={setKey}
            placeholder="sk-ant-..."
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
          />
          <Button title="Guardar API key" small onPress={saveKey} disabled={!key.trim()} />
        </>
      )}

      <ThemedText type="small" themeColor="textSecondary">
        Modelo
      </ThemedText>
      <Segmented<AiModel>
        options={AI_MODELS.map((m) => ({ value: m.value, label: m.label }))}
        value={model}
        onChange={async (m) => {
          await setSetting(db, 'aiModel', m);
          onChanged();
        }}
      />
      <ThemedText type="small" themeColor="textSecondary">
        {AI_MODELS.find((m) => m.value === model)?.hint}
      </ThemedText>

      <Row style={{ justifyContent: 'space-between' }}>
        <ThemedText style={{ flex: 1 }}>Generar el resumen automáticamente al terminar</ThemedText>
        <Switch
          value={auto}
          onValueChange={async (on) => {
            await setSetting(db, 'aiAuto', on ? '1' : '0');
            onChanged();
          }}
        />
      </Row>
    </Card>
  );
}
