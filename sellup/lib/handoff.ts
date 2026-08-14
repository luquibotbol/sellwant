import type { LockInState } from '@/services/data';

/**
 * The handoff, as data.
 *
 *              BUYER                          SELLER
 * pending  │ pay them, then mark paid   │ waiting to be paid
 * paid     │ confirm you got the ticket │ they say they paid
 * confirmed│ done                       │ done
 * cancelled│ called off                 │ called off
 *
 * Kept as a table rather than nested conditionals so all eight cells are
 * visible at once and testable without rendering anything. A missing or
 * wrong-role action is then a diff you can see, not a bug you click into.
 *
 * WORDING RULE: these states record what someone SAID, never what SellUp
 * verified. Money moves off-platform and we never see it, so copy says
 * "marked as paid", never "paid" as a fact, and never implies we are holding
 * anything or vouching for anyone.
 */

export type Role = 'buyer' | 'seller';
export type HandoffState = Exclude<LockInState, 'code_released'>;

export interface StepAction {
  /** Target state for advance_deal. */
  to: HandoffState;
  label: string;
  variant: 'want' | 'outline' | 'destructive';
  /** Shown before firing, when the action is hard to walk back. */
  confirm?: string;
}

export interface Step {
  title: string;
  body: string;
  /** Whether this side is the one who acts now. */
  waiting: boolean;
  primary?: StepAction;
  secondary?: StepAction;
  /** Show the counterparty's payment handles on this step. */
  showPayment?: boolean;
}

const CANCEL: StepAction = {
  to: 'cancelled',
  label: 'Cancel this deal',
  variant: 'destructive',
  confirm: 'Cancel the deal? The ticket goes back on sale and the other person is told.',
};

export const HANDOFF: Record<HandoffState, Record<Role, Step>> = {
  pending_payment: {
    buyer: {
      title: 'Pay the seller',
      body:
        'Send the money using one of their handles below, then come back and mark it. ' +
        'SellUp never sees the payment — we only record what you tell us.',
      waiting: false,
      showPayment: true,
      primary: { to: 'paid', label: "I've sent the money", variant: 'want' },
      secondary: CANCEL,
    },
    seller: {
      title: 'Waiting on payment',
      body:
        "The buyer has your payment details. They'll mark it here once they've sent it — " +
        'check your own payment app to be sure, since we can\'t verify it for you.',
      waiting: true,
      secondary: CANCEL,
    },
  },

  paid: {
    buyer: {
      title: 'Get your ticket',
      body:
        'Meet the seller, or have them send it over. Once you have it and it scans, confirm below. ' +
        'Confirming is what records the handoff for both of you.',
      waiting: false,
      primary: { to: 'confirmed', label: 'I got the ticket', variant: 'want' },
      secondary: CANCEL,
    },
    seller: {
      title: 'They marked it paid',
      body:
        'The buyer says they sent the money. Check your payment app first, then hand the ticket over. ' +
        'They confirm at their end once they have it.',
      waiting: true,
      secondary: CANCEL,
    },
  },

  confirmed: {
    buyer: {
      title: 'Done',
      body: 'You confirmed you got the ticket. Both of you got credit for the handoff.',
      waiting: false,
    },
    seller: {
      title: 'Done',
      body: 'The buyer confirmed they got the ticket. Both of you got credit for the handoff.',
      waiting: false,
    },
  },

  cancelled: {
    buyer: {
      title: 'Cancelled',
      body: 'This deal was called off. The ticket is back on sale if you still want it.',
      waiting: false,
    },
    seller: {
      title: 'Cancelled',
      body: 'This deal was called off. Your listing is back on the feed.',
      waiting: false,
    },
  },
};

export function stepFor(state: HandoffState, role: Role): Step {
  return HANDOFF[state][role];
}

/** Progress markers for the header. Cancelled is off-path, so it has none. */
export const PROGRESS: HandoffState[] = ['pending_payment', 'paid', 'confirmed'];
