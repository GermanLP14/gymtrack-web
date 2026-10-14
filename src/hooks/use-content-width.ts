import { useWindowDimensions } from 'react-native';

import { MaxContentWidth, SidebarBreakpoint, SidebarWidth } from '@/constants/theme';

/** Width of the centered page column: the window beside the sidebar (if shown), capped on wide screens. */
export function useContentWidth() {
  const { width } = useWindowDimensions();
  const available = width >= SidebarBreakpoint ? width - SidebarWidth : width;
  return Math.min(available, MaxContentWidth);
}
