import { router } from 'expo-router';

/**
 * `router.back()`, falling back to the home tab. A page opened by a reload or
 * a pasted link is alone in the stack, with nothing to go back to.
 */
export function goBack() {
  if (router.canDismiss()) router.back();
  else router.replace('/');
}
