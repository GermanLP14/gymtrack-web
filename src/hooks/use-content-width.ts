import { useWindowDimensions } from 'react-native';

import { MaxContentWidth } from '@/constants/theme';

/** Width of the centered page column: the window, capped on wide screens. */
export function useContentWidth() {
  const { width } = useWindowDimensions();
  return Math.min(width, MaxContentWidth);
}
