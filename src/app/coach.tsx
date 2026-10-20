import { Stack, router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type NativeSyntheticEvent,
  type TextInputKeyPressEventData,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, Chip, EmptyState, Input, Row } from '@/components/ui';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useFocusData } from '@/hooks/use-focus-data';
import { useTheme } from '@/hooks/use-theme';
import { getApiKey } from '@/lib/ai';
import type { RoutineProposal } from '@/lib/coach-agent';
import { answerProposal, resetCoachChat, sendCoachMessage, useCoachChat, type ChatItem, type ProposalStatus } from '@/lib/coach-chat';

const SUGGESTIONS = [
  '¿Cómo vengo con mi progreso?',
  '¿En qué ejercicio estoy estancado?',
  'Revisá mis rutinas y sugerime mejoras',
  'Quiero agregar un ejercicio de espalda',
];

export default function CoachScreen() {
  const db = useSQLiteContext();
  const theme = useTheme();
  const { items, busy } = useCoachChat();
  const [draft, setDraft] = useState('');
  const scroll = useRef<ScrollView>(null);
  const { data: hasKey } = useFocusData(useCallback(async () => !!(await getApiKey()), []));

  useEffect(() => {
    const t = setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 50);
    return () => clearTimeout(t);
  }, [items]);

  const send = (text = draft) => {
    if (!text.trim() || busy) return;
    setDraft('');
    void sendCoachMessage(db, text);
  };

  // On a computer Enter sends and Shift+Enter starts a new line.
  const onKeyPress = (e: NativeSyntheticEvent<TextInputKeyPressEventData & { shiftKey?: boolean }>) => {
    if (Platform.OS === 'web' && e.nativeEvent.key === 'Enter' && !e.nativeEvent.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }} edges={['bottom']}>
      <Stack.Screen
        options={{
          headerRight: () =>
            items.length > 0 ? <Button title="Nueva" small variant="ghost" onPress={resetCoachChat} /> : null,
        }}
      />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={100}>
        <ScrollView ref={scroll} contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
          {hasKey === false ? (
            <EmptyState
              title="Falta tu API key de Anthropic"
              body="El coach usa Claude con tu propia API key. Cargala en Ajustes, en la sección IA · Claude."
              action={<Button title="Ir a Ajustes" small onPress={() => router.push('/settings')} />}
            />
          ) : items.length === 0 ? (
            <Intro onPick={send} disabled={busy || !hasKey} />
          ) : (
            items.map((item) => <ChatRow key={item.id} item={item} />)
          )}
          {busy && !items.some((i) => i.kind === 'activity' || (i.kind === 'proposal' && i.status === 'pending')) ? (
            <Activity text="Pensando…" />
          ) : null}
        </ScrollView>

        <View style={[styles.composerWrap, { borderTopColor: theme.border, backgroundColor: theme.background }]}>
          <Row style={styles.composer}>
            <Input
              value={draft}
              onChangeText={setDraft}
              placeholder={busy ? 'El coach está respondiendo…' : 'Preguntale algo al coach…'}
              multiline
              editable={!!hasKey}
              onKeyPress={onKeyPress}
              style={styles.input}
              accessibilityLabel="Mensaje para el coach"
            />
            <Button title="Enviar" small disabled={busy || !draft.trim() || !hasKey} onPress={() => send()} />
          </Row>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Intro({ onPick, disabled }: { onPick: (text: string) => void; disabled: boolean }) {
  return (
    <View style={{ gap: Spacing.three }}>
      <Card>
        <ThemedText style={{ fontWeight: 700, fontSize: 18 }}>Tu coach con IA</ThemedText>
        <ThemedText themeColor="textSecondary">
          Preguntale sobre tus rutinas, los pesos que levantás y cómo venís progresando. También puede cambiar tus
          rutinas, ya sea por un consejo suyo o porque se lo pedís: antes de guardar cualquier cambio te lo muestra y
          te pide confirmación.
        </ThemedText>
      </Card>
      <Row style={{ flexWrap: 'wrap' }}>
        {SUGGESTIONS.map((s) => (
          <Chip key={s} label={s} onPress={disabled ? undefined : () => onPick(s)} />
        ))}
      </Row>
    </View>
  );
}

function ChatRow({ item }: { item: ChatItem }) {
  const theme = useTheme();
  switch (item.kind) {
    case 'user':
      return (
        <View style={[styles.bubble, styles.userBubble, { backgroundColor: theme.accent }]}>
          <ThemedText style={{ color: theme.accentText }} selectable>
            {item.text}
          </ThemedText>
        </View>
      );
    case 'assistant':
      return (
        <View style={[styles.bubble, styles.botBubble, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
          <ThemedText selectable>{item.text}</ThemedText>
        </View>
      );
    case 'activity':
      return <Activity text={item.text} />;
    case 'error':
      return (
        <View style={[styles.bubble, styles.botBubble, { borderColor: theme.danger, backgroundColor: theme.backgroundElement }]}>
          <ThemedText style={{ color: theme.danger }}>{item.text}</ThemedText>
        </View>
      );
    case 'proposal':
      return <ProposalCard id={item.id} proposal={item.proposal} status={item.status} />;
  }
}

function Activity({ text }: { text: string }) {
  const theme = useTheme();
  return (
    <Row style={{ gap: Spacing.two, paddingHorizontal: Spacing.one }}>
      <ActivityIndicator size="small" color={theme.textSecondary} />
      <ThemedText type="small" themeColor="textSecondary">
        {text}
      </ThemedText>
    </Row>
  );
}

const MARK = { add: '+', remove: '−', change: '~', info: '•' } as const;

function ProposalCard({ id, proposal, status }: { id: number; proposal: RoutineProposal; status: ProposalStatus }) {
  const theme = useTheme();
  const markColor = { add: theme.success, remove: theme.danger, change: theme.accent, info: theme.textSecondary };
  const title = proposal.routineId == null ? `Nueva rutina: ${proposal.name}` : `Cambios en ${proposal.name}`;
  return (
    <Card style={{ borderWidth: 2, borderColor: status === 'pending' ? theme.accent : theme.border }}>
      <ThemedText type="smallBold" themeColor="textSecondary" style={{ textTransform: 'uppercase', letterSpacing: 0.6 }}>
        Propuesta del coach
      </ThemedText>
      <ThemedText style={{ fontWeight: 700, fontSize: 17 }}>{title}</ThemedText>
      {proposal.summary ? <ThemedText themeColor="textSecondary">{proposal.summary}</ThemedText> : null}
      <View style={{ gap: 4, marginTop: Spacing.one }}>
        {proposal.changes.map((c, i) => (
          <Row key={i} style={{ alignItems: 'flex-start' }}>
            <ThemedText style={{ color: markColor[c.kind], fontWeight: 800, width: 16, fontSize: 17, lineHeight: 20 }}>{MARK[c.kind]}</ThemedText>
            <ThemedText type="small" style={{ flex: 1 }}>
              {c.text}
            </ThemedText>
          </Row>
        ))}
      </View>
      {status === 'pending' ? (
        <Row style={{ justifyContent: 'flex-end', marginTop: Spacing.two }}>
          <Button title="Rechazar" small variant="secondary" onPress={() => answerProposal(id, false)} />
          <Button title="Confirmar cambios" small onPress={() => answerProposal(id, true)} />
        </Row>
      ) : (
        <Row style={{ justifyContent: 'space-between', marginTop: Spacing.one }}>
          <ThemedText
            type="smallBold"
            style={{ color: status === 'applied' ? theme.success : theme.textSecondary }}>
            {status === 'applied' ? '✓ Cambios guardados' : status === 'declined' ? '✗ Rechazado' : 'Sin respuesta'}
          </ThemedText>
          {status === 'applied' ? (
            <Pressable onPress={() => router.push('/routines')} accessibilityRole="link">
              <ThemedText type="smallBold" style={{ color: theme.accent }}>
                Ver rutinas
              </ThemedText>
            </Pressable>
          ) : null}
        </Row>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  list: {
    padding: Spacing.three,
    gap: Spacing.two + Spacing.one,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  bubble: { maxWidth: '85%', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10 },
  userBubble: { alignSelf: 'flex-end', borderBottomRightRadius: 6 },
  botBubble: { alignSelf: 'flex-start', borderBottomLeftRadius: 6, borderWidth: 1 },
  composerWrap: { borderTopWidth: 1 },
  composer: {
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    padding: Spacing.three,
    paddingVertical: Spacing.two + Spacing.one,
    alignItems: 'flex-end',
  },
  input: { flex: 1, maxHeight: 140 },
});
