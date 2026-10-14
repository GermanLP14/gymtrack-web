/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import '@/global.css';

import { Platform } from 'react-native';

export const Colors = {
  light: {
    text: '#0F1222',
    background: '#F4F5F9',
    backgroundElement: '#FFFFFF',
    backgroundSelected: '#EBEDF3',
    textSecondary: '#5E6478',
    border: '#E3E6EE',
    accent: '#4F46E5',
    accentText: '#ffffff',
    accentSoft: 'rgba(79, 70, 229, 0.10)',
    /** Accent for text and icons on plain or soft-accent backgrounds. */
    tint: '#4F46E5',
    success: '#16A34A',
    warning: '#C77700',
    danger: '#DC2626',
    shadow: '0 1px 2px rgba(15, 18, 34, 0.04), 0 4px 16px rgba(15, 18, 34, 0.05)',
  },
  dark: {
    text: '#F2F3F7',
    background: '#0B0C10',
    backgroundElement: '#15171E',
    backgroundSelected: '#22252F',
    textSecondary: '#9CA1B2',
    border: '#262935',
    accent: '#6366F1',
    accentText: '#ffffff',
    accentSoft: 'rgba(129, 140, 248, 0.16)',
    tint: '#A5B4FC',
    success: '#3DD68C',
    warning: '#F5A524',
    danger: '#FF6166',
    shadow: '0 1px 2px rgba(0, 0, 0, 0.4), 0 8px 24px rgba(0, 0, 0, 0.25)',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

/**
 * Identity colors for routines (validated categorical palette, fixed order).
 * Routines store a slot index so each theme uses its own stepped shade.
 */
export const RoutineColors = {
  light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'],
  dark: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'],
} as const;

export const ROUTINE_COLOR_COUNT = RoutineColors.light.length;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const MaxContentWidth = 960;

/** Window width from which the tabs become a sidebar instead of a bottom bar. */
export const SidebarBreakpoint = 900;
export const SidebarWidth = 240;
