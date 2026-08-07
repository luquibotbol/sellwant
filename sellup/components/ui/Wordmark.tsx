import React from 'react';
import Text, { TextProps } from '@/components/ui/Text';

type Size = 'display' | 'title';

/**
 * The SellUp wordmark.
 *
 * "Sell" carries the sell colour and "Up" the buy colour, so the brand states
 * the market convention the rest of the UI uses -- red is the sell side, green
 * is the buy side. It is the one place those colours appear as pure decoration,
 * and it earns that by teaching the scheme.
 */
export function Wordmark({ size = 'title', style }: { size?: Size; style?: TextProps['style'] }) {
  return (
    <Text variant={size} style={style}>
      <Text variant={size} tone="sell">
        Sell
      </Text>
      <Text variant={size} tone="want">
        Up
      </Text>
    </Text>
  );
}

export default Wordmark;
