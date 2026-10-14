import { useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  useWindowDimensions,
  type PressableProps,
  type PressableStateCallbackType,
  type ScrollViewProps,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Fonts, MaxContentWidth, SidebarBreakpoint, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** react-native-web also reports mouse hover to Pressable's style/children callbacks. */
type PressState = PressableStateCallbackType & { hovered?: boolean };

/** Scrollable page body, a centered column on wide screens. `tabs` marks a tab's root screen. */
export function Screen({ children, tabs, style, ...rest }: ScrollViewProps & { children: ReactNode; tabs?: boolean }) {
  const theme = useTheme();
  const wide = useWindowDimensions().width >= SidebarBreakpoint;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }} edges={tabs ? ['top'] : []}>
      <ScrollView
        contentContainerStyle={[
          styles.screen,
          wide && styles.screenWide,
          tabs && { paddingBottom: Spacing.five },
          style,
        ]}
        keyboardShouldPersistTaps="handled"
        {...rest}>
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: theme.backgroundElement, borderColor: theme.border, boxShadow: theme.shadow },
        style,
      ]}>
      {children}
    </View>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <View style={styles.sectionTitle}>
      <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionLabel}>
        {children}
      </ThemedText>
      {action}
    </View>
  );
}

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

export function Button({
  title,
  variant = 'primary',
  loading,
  small,
  style,
  disabled,
  ...rest
}: PressableProps & {
  title: string;
  variant?: ButtonVariant;
  loading?: boolean;
  small?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const bg = {
    primary: theme.accent,
    secondary: theme.backgroundElement,
    danger: theme.danger,
    ghost: 'transparent',
  }[variant];
  const hoverBg = {
    primary: theme.accent,
    secondary: theme.backgroundSelected,
    danger: theme.danger,
    ghost: theme.accentSoft,
  }[variant];
  const fg = variant === 'primary' || variant === 'danger' ? theme.accentText : variant === 'ghost' ? theme.tint : theme.text;
  const solid = variant === 'primary' || variant === 'danger';
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || loading}
      style={(state) => {
        const { pressed, hovered } = state as PressState;
        const active = hovered && !disabled;
        return [
          styles.button,
          small && styles.buttonSmall,
          variant === 'secondary' && { borderWidth: 1, borderColor: theme.border },
          {
            backgroundColor: active ? hoverBg : bg,
            opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
            transform: [{ scale: pressed && !disabled ? 0.98 : 1 }],
          },
          solid && active && { filter: 'brightness(1.08)' },
          solid && !disabled && { boxShadow: `0 4px 14px ${variant === 'primary' ? theme.accentSoft : 'transparent'}` },
          style,
        ];
      }}
      {...rest}>
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <ThemedText type={small ? 'smallBold' : 'default'} style={{ color: fg, fontWeight: 700 }}>
          {title}
        </ThemedText>
      )}
    </Pressable>
  );
}

export function Chip({ label, selected, onPress }: { label: string; selected?: boolean; onPress?: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={(state) => [
        styles.chip,
        {
          backgroundColor: selected
            ? theme.accent
            : (state as PressState).hovered && onPress
              ? theme.backgroundSelected
              : theme.backgroundElement,
          borderColor: selected ? theme.accent : theme.border,
        },
      ]}>
      <ThemedText type="smallBold" style={{ color: selected ? theme.accentText : theme.text }}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.segmented, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            style={(state) => [
              styles.segment,
              selected
                ? { backgroundColor: theme.accentSoft }
                : (state as PressState).hovered && { backgroundColor: theme.backgroundSelected },
            ]}>
            <ThemedText type="smallBold" style={{ color: selected ? theme.tint : theme.textSecondary }} numberOfLines={1}>
              {o.label}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Input(props: TextInputProps) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <TextInput
      placeholderTextColor={theme.textSecondary}
      {...props}
      onFocus={(e) => {
        setFocused(true);
        props.onFocus?.(e);
      }}
      onBlur={(e) => {
        setFocused(false);
        props.onBlur?.(e);
      }}
      style={[
        styles.input,
        {
          backgroundColor: theme.background,
          color: theme.text,
          borderColor: focused ? theme.accent : theme.border,
          boxShadow: focused ? `0 0 0 3px ${theme.accentSoft}` : 'none',
        },
        props.style,
      ]}
    />
  );
}

export type SelectOption<T extends string> = { value: T; label: string; hint?: string };

/**
 * Dropdown drawn by the app instead of the browser's native <select>, so it follows
 * the app theme (the native list ignores dark mode) and can be searched.
 */
export function Select<T extends string>({
  options,
  value,
  onChange,
  placeholder = 'Elegir…',
  title,
  searchPlaceholder = 'Buscar…',
  accessibilityLabel,
}: {
  options: SelectOption<T>[];
  value: T | null;
  onChange: (v: T) => void;
  placeholder?: string;
  title?: string;
  searchPlaceholder?: string;
  accessibilityLabel?: string;
}) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const current = options.find((o) => o.value === value);
  const q = query.trim().toLowerCase();
  const visible = q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;

  const close = () => {
    setOpen(false);
    setQuery('');
  };
  const choose = (v: T) => {
    onChange(v);
    close();
  };

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        style={(state) => [
          styles.selectTrigger,
          {
            backgroundColor: (state as PressState).hovered ? theme.backgroundSelected : theme.backgroundElement,
            borderColor: open ? theme.accent : theme.border,
            boxShadow: theme.shadow,
          },
        ]}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <ThemedText style={{ fontWeight: 600 }} themeColor={current ? 'text' : 'textSecondary'} numberOfLines={1}>
            {current?.label ?? placeholder}
          </ThemedText>
        </View>
        {current?.hint ? (
          <View style={[styles.badge, { backgroundColor: theme.accentSoft }]}>
            <ThemedText type="smallBold" style={{ color: theme.tint }}>
              {current.hint}
            </ThemedText>
          </View>
        ) : null}
        <ThemedText themeColor="textSecondary" style={styles.chevron}>
          ▾
        </ThemedText>
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={close}>
        <Pressable style={styles.backdrop} onPress={close} accessibilityLabel="Cerrar">
          <Pressable
            style={[
              styles.selectPanel,
              { backgroundColor: theme.backgroundElement, borderColor: theme.border, boxShadow: theme.shadow },
            ]}>
            {title ? (
              <ThemedText style={{ fontWeight: 700, fontSize: 18, paddingHorizontal: Spacing.one }}>{title}</ThemedText>
            ) : null}
            <Input value={query} onChangeText={setQuery} placeholder={searchPlaceholder} autoFocus />
            <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ gap: 2 }} keyboardShouldPersistTaps="handled">
              {visible.length === 0 ? (
                <ThemedText themeColor="textSecondary" style={{ textAlign: 'center', paddingVertical: Spacing.four }}>
                  Sin resultados
                </ThemedText>
              ) : (
                visible.map((o) => {
                  const selected = o.value === value;
                  return (
                    <Pressable
                      key={o.value}
                      onPress={() => choose(o.value)}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      style={(state) => [
                        styles.selectOption,
                        {
                          backgroundColor: selected
                            ? theme.accentSoft
                            : (state as PressState).hovered
                              ? theme.backgroundSelected
                              : 'transparent',
                        },
                      ]}>
                      <ThemedText
                        numberOfLines={1}
                        style={{ flex: 1, color: selected ? theme.tint : theme.text, fontWeight: selected ? 700 : 500 }}>
                        {o.label}
                      </ThemedText>
                      {o.hint ? (
                        <ThemedText type="small" themeColor="textSecondary">
                          {o.hint}
                        </ThemedText>
                      ) : null}
                      <ThemedText style={{ width: 18, color: theme.tint, fontWeight: 700 }}>{selected ? '✓' : ''}</ThemedText>
                    </Pressable>
                  );
                })
              )}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

export function StatTile({ label, value, hint, hintColor }: { label: string; value: string; hint?: string; hintColor?: string }) {
  return (
    <Card style={styles.tile}>
      <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
        {label}
      </ThemedText>
      <ThemedText style={styles.tileValue} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </ThemedText>
      {hint ? (
        <ThemedText
          type="small"
          style={hintColor ? { color: hintColor } : undefined}
          themeColor="textSecondary"
          numberOfLines={1}>
          {hint}
        </ThemedText>
      ) : null}
    </Card>
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <Card style={{ alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.five, borderStyle: 'dashed' }}>
      <ThemedText type="default" style={{ fontWeight: 700, textAlign: 'center' }}>
        {title}
      </ThemedText>
      {body ? (
        <ThemedText type="small" themeColor="textSecondary" style={{ textAlign: 'center', maxWidth: 420 }}>
          {body}
        </ThemedText>
      ) : null}
      {action}
    </Card>
  );
}

export function Row({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two }, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  screen: { padding: Spacing.three, gap: Spacing.three, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  screenWide: { paddingTop: Spacing.five, gap: Spacing.three + Spacing.one },
  card: { borderRadius: 18, borderWidth: 1, padding: Spacing.three, gap: Spacing.two },
  sectionTitle: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: Spacing.three },
  sectionLabel: { textTransform: 'uppercase', letterSpacing: 0.8, fontSize: 12 },
  button: {
    borderRadius: 12,
    paddingVertical: 13,
    paddingHorizontal: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonSmall: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 10 },
  chip: { borderRadius: 999, borderWidth: 1, paddingVertical: 6, paddingHorizontal: 14 },
  segmented: { flexDirection: 'row', borderRadius: 14, borderWidth: 1, padding: 4, gap: 4 },
  segment: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 10 },
  input: {
    minWidth: 0,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    fontFamily: Fonts?.sans,
  },
  selectTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: Spacing.three,
    paddingVertical: 12,
  },
  chevron: { fontSize: 14 },
  badge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 2 },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(5, 6, 10, 0.55)',
    backdropFilter: 'blur(4px)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.three,
  },
  selectPanel: {
    width: '100%',
    maxWidth: 480,
    maxHeight: '75%',
    borderRadius: 20,
    borderWidth: 1,
    padding: Spacing.three,
    gap: Spacing.two,
    cursor: 'auto',
  },
  selectOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
  },
  tile: { flex: 1, alignSelf: 'stretch', gap: 2, padding: 14 },
  tileValue: { fontSize: 24, lineHeight: 30, fontWeight: 800, letterSpacing: -0.4 },
});
