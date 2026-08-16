import { Linking, Platform } from 'react-native';
import type { PayAction } from '@/lib/payments';

/**
 * The platform half of payments, kept apart from the URL-building logic so
 * that logic stays testable without pulling react-native into the test runner.
 */
export async function openPayment(action: PayAction): Promise<void> {
  if (action.kind !== 'link') return;
  if (Platform.OS === 'web') {
    // _blank + noopener: the payment app should not get a handle on our window.
    window.open(action.url, '_blank', 'noopener');
    return;
  }
  await Linking.openURL(action.url);
}
