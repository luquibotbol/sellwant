/**
 * Deep links for peer-to-peer payment apps.
 *
 * SellWant never moves money. These build a URL that opens someone else's app
 * with the fields pre-filled; whether the payment happens is between the two
 * students.
 *
 * Deliberately free of any react-native import so the logic stays pure and
 * testable — opening the link lives in lib/open-payment.ts.
 *
 * Coverage is uneven and that has to be handled honestly rather than papered
 * over with a button that does nothing:
 *   venmo   - real deep link, amount and note prefill
 *   cashapp - web link to the cashtag, amount in the path
 *   paypal  - paypal.me link, amount in the path
 *   zelle   - NO deep link exists. Zelle is inside your bank's own app and is
 *             addressed by phone/email, so the only honest affordance is
 *             copy-to-clipboard.
 */

/** Structurally what this module needs; the full type lives in services/data. */
export interface PayableHandle {
  kind: string;
  value: string;
  label?: string;
}

export type PayAction =
  | { kind: 'link'; label: string; url: string }
  | { kind: 'copy'; label: string; value: string; hint: string };

const cashtag = (v: string) => v.trim().replace(/^\$/, '');
const at = (v: string) => v.trim().replace(/^@/, '');

/**
 * What a Venmo, Cash App or PayPal.me username can actually contain.
 *
 * The handle is typed by the person being paid and read back by the person
 * paying, so it is the payee's text inside the payer's link. Interpolated raw,
 * a handle like `maya?txn=pay&amount=450.00#` moved the real amount into the
 * fragment and prefilled ten times the agreed price. A handle outside this
 * shape gets the copy affordance instead of a link: still usable, but the
 * payer types the amount themselves.
 */
const USERNAME = /^[A-Za-z0-9_.-]{1,40}$/;

function unlinkable(handle: PayableHandle, label: string): PayAction {
  return {
    kind: 'copy',
    label,
    value: handle.value,
    hint: 'Check this handle in the app and enter the amount yourself.',
  };
}

export function payAction(
  handle: PayableHandle,
  amountCents: number,
  note: string
): PayAction {
  const amount = (amountCents / 100).toFixed(2);

  switch (handle.kind) {
    case 'venmo':
      if (!USERNAME.test(at(handle.value))) return unlinkable(handle, 'Copy Venmo handle');
      return {
        kind: 'link',
        label: 'Pay with Venmo',
        // The web link works on desktop and hands off to the app on mobile,
        // where the venmo:// scheme fails silently if it isn't installed.
        url:
          `https://venmo.com/${encodeURIComponent(at(handle.value))}` +
          `?txn=pay&amount=${amount}&note=${encodeURIComponent(note)}`,
      };

    case 'cashapp':
      if (!USERNAME.test(cashtag(handle.value))) return unlinkable(handle, 'Copy Cash App handle');
      return {
        kind: 'link',
        label: 'Pay with Cash App',
        url: `https://cash.app/$${encodeURIComponent(cashtag(handle.value))}/${amount}`,
      };

    case 'paypal':
      if (!USERNAME.test(at(handle.value))) return unlinkable(handle, 'Copy PayPal handle');
      return {
        kind: 'link',
        label: 'Pay with PayPal',
        url: `https://paypal.me/${encodeURIComponent(at(handle.value))}/${amount}`,
      };

    case 'zelle':
      return {
        kind: 'copy',
        label: 'Copy Zelle details',
        value: handle.value,
        hint: 'Zelle lives inside your bank app — paste this there.',
      };

    default:
      return {
        kind: 'copy',
        label: `Copy ${handle.label || 'payment'} details`,
        value: handle.value,
        hint: 'Send it however you normally would.',
      };
  }
}
