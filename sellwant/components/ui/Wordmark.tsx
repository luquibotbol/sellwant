import React from 'react';
import Text, { TextProps } from '@/components/ui/Text';

type Size = 'display' | 'title';

/**
 * The SellWant wordmark.
 *
 * The two halves are the two listing types: `sell` in the sell colour, `want`
 * in the buy colour. So the brand is not decoration over the palette -- it is
 * the palette's legend, naming the same red/green split the feed, the cards and
 * the deal header all use. Read the logo and you have read the colour scheme.
 */
interface Props {
  size?: Size;
  style?: TextProps['style'];
  /**
   * Web-only. Accepted here so callers can pass it unconditionally; the reveal
   * needs animated clip paths, which react-native-web's Text cannot express,
   * so it lives in Wordmark.web.tsx and native simply renders static.
   */
  animate?: boolean;
}

export function Wordmark({ size = 'title', style }: Props) {
  return (
    <Text variant={size} style={style}>
      <Text variant={size} tone="sell">
        Sell
      </Text>
      <Text variant={size} tone="want">
        Want
      </Text>
    </Text>
  );
}

export default Wordmark;
