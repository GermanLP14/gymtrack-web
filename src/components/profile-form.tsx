import { useState } from 'react';
import { View } from 'react-native';

import { Alert } from '@/components/dialog';
import { ThemedText } from '@/components/themed-text';
import { Button, Input, Row, Segmented } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { isValidProfile, type Profile, type Sex } from '@/lib/calories';

function Field({ label, value, onChange, unit }: { label: string; value: string; onChange: (v: string) => void; unit: string }) {
  return (
    <View style={{ flex: 1, gap: 2 }}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <Row style={{ gap: 4 }}>
        <Input value={value} onChangeText={onChange} keyboardType="decimal-pad" style={{ flex: 1, textAlign: 'center' }} />
        <ThemedText type="small" themeColor="textSecondary">
          {unit}
        </ThemedText>
      </Row>
    </View>
  );
}

const num = (s: string) => Number(s.replace(',', '.'));

/** Sex, age, height and weight: what the calorie estimates need. */
export function ProfileForm({
  initial,
  submitLabel,
  onSubmit,
}: {
  initial: Profile | null;
  submitLabel: string;
  onSubmit: (p: Profile) => Promise<void>;
}) {
  const [sex, setSex] = useState<Sex>(initial?.sex ?? 'male');
  const [age, setAge] = useState(initial ? String(initial.age) : '');
  const [height, setHeight] = useState(initial ? String(initial.heightCm) : '');
  const [weight, setWeight] = useState(initial ? String(initial.weightKg) : '');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const p = { sex, age: Math.round(num(age)), heightCm: num(height), weightKg: num(weight) };
    if (!isValidProfile(p)) {
      Alert.alert('Revisá los datos', 'Edad entre 10 y 100 años, altura entre 100 y 250 cm y peso entre 30 y 300 kg.');
      return;
    }
    setSaving(true);
    try {
      await onSubmit(p);
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={{ gap: Spacing.three }}>
      <View style={{ gap: 2 }}>
        <ThemedText type="small" themeColor="textSecondary">
          Sexo (para la fórmula del metabolismo basal)
        </ThemedText>
        <Segmented
          options={[
            { value: 'male', label: 'Hombre' },
            { value: 'female', label: 'Mujer' },
          ]}
          value={sex}
          onChange={setSex}
        />
      </View>
      <Row style={{ alignItems: 'flex-start' }}>
        <Field label="Edad" value={age} onChange={setAge} unit="años" />
        <Field label="Altura" value={height} onChange={setHeight} unit="cm" />
        <Field label="Peso" value={weight} onChange={setWeight} unit="kg" />
      </Row>
      <Button title={submitLabel} onPress={submit} loading={saving} />
    </View>
  );
}
