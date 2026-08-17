import React, { useEffect, useRef, useState } from 'react';
import Text, { TextProps } from '@/components/ui/Text';
import { colors, type as typeScale } from '@/constants/theme';

type Size = 'display' | 'title';

/**
 * The SellWant wordmark, web build.
 *
 * Identical to the native version unless `animate` is set. The animated form
 * has to be SVG: it wipes each half into view behind a moving clip edge, and
 * clip-path animation does not survive react-native-web's Text. Native keeps
 * the plain version, which is why this is a .web.tsx rather than a prop on the
 * shared component.
 *
 * The motion states the brand: "Sell" is written downward, then "Want" upward,
 * the two halves arriving from opposite directions the way the two sides of a
 * trade do. Each half also drifts a few pixels into place as it reveals, so it
 * lands with some weight instead of merely appearing.
 */

/** Half a second each way, deliberately unhurried -- this plays once, on a
 *  screen where the person has just arrived and has nothing to wait for. */
const SELL_MS = 920;
const WANT_MS = 920;
const GAP_MS = 600;

/**
 * Measured: Geist Bold at the display tracking renders "SellWant" at 4.27x its
 * font size. Used only as the first-paint viewBox so the layout does not jump
 * before the webfont resolves; the real width is measured on mount and
 * replaces it. Tracking differs slightly per size, so this is approximate by
 * design -- it only has to be close enough to avoid a visible reflow.
 */
const RATIO = 4.27;
const HEIGHT_RATIO = 1.16;
const BASELINE_RATIO = 0.78;

const CSS = `
@keyframes sw-down { to { transform: scaleY(1) } }
@keyframes sw-up   { to { transform: scaleY(1) } }
@keyframes sw-settle-down { to { transform: translateY(0); opacity: 1 } }
@keyframes sw-settle-up   { to { transform: translateY(0); opacity: 1 } }

.sw-clip-sell rect, .sw-clip-want rect { transform-box: fill-box; transform: scaleY(0) }
.sw-clip-sell rect { transform-origin: top }
.sw-clip-want rect { transform-origin: bottom }

.sw-go .sw-clip-sell rect {
  animation: sw-down ${SELL_MS}ms cubic-bezier(.5,0,.2,1) forwards;
}
.sw-go .sw-clip-want rect {
  animation: sw-up ${WANT_MS}ms cubic-bezier(.5,0,.2,1) ${GAP_MS}ms forwards;
}

.sw-g-sell { transform: translateY(-7px); opacity: .6 }
.sw-g-want { transform: translateY(7px);  opacity: .6 }
.sw-go .sw-g-sell {
  animation: sw-settle-down ${SELL_MS}ms cubic-bezier(.3,1.1,.4,1) forwards;
}
.sw-go .sw-g-want {
  animation: sw-settle-up ${WANT_MS}ms cubic-bezier(.3,1.1,.4,1) ${GAP_MS}ms forwards;
}

/* Motion here is decoration, not information -- the wordmark reads the same
   without it, so honour the preference completely rather than shortening it. */
@media (prefers-reduced-motion: reduce) {
  .sw-clip-sell rect, .sw-clip-want rect { transform: scaleY(1) !important; animation: none !important }
  .sw-g-sell, .sw-g-want { transform: none !important; opacity: 1 !important; animation: none !important }
}
`;

let injected = false;
function useStyleOnce() {
  useEffect(() => {
    if (injected || typeof document === 'undefined') return;
    injected = true;
    const el = document.createElement('style');
    el.textContent = CSS;
    document.head.appendChild(el);
  }, []);
}

interface Props {
  size?: Size;
  style?: TextProps['style'];
  /** Play the reveal on mount. Off everywhere except the sign-in screen. */
  animate?: boolean;
}

export function Wordmark({ size = 'title', style, animate = false }: Props) {
  useStyleOnce();
  const fontSize = typeScale[size].fontSize;
  const svgRef = useRef<SVGSVGElement | null>(null);
  const sellRef = useRef<SVGTextElement | null>(null);
  const [width, setWidth] = useState(fontSize * RATIO);
  const [go, setGo] = useState(false);

  const height = fontSize * HEIGHT_RATIO;
  const baseline = fontSize * BASELINE_RATIO;

  // Measure once the webfont is actually resolved. Before that the fallback
  // metrics are wrong, and a viewBox set from them makes the mark jump.
  useEffect(() => {
    if (!animate) return;
    let dead = false;
    const measure = () => {
      const t = sellRef.current;
      if (dead || !t) return;
      try {
        const total = (t.parentNode as SVGGElement).getBBox().width;
        if (total > 0) setWidth(total);
      } catch {
        /* getBBox throws if the node is not rendered yet; the ratio holds. */
      }
      setGo(true);
    };
    const fonts = (document as unknown as { fonts?: FontFaceSet }).fonts;
    if (fonts?.ready) fonts.ready.then(measure);
    else measure();
    return () => {
      dead = true;
    };
  }, [animate]);

  if (!animate) {
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

  // Both halves are the same two <tspan>s with one side made transparent, so
  // they share a single text layout and cannot drift out of alignment. That
  // also removes any need to know where "Sell" ends.
  const textProps = {
    x: 0,
    y: baseline,
    fontFamily: typeScale[size].fontFamily,
    fontSize,
    letterSpacing: typeScale[size].letterSpacing,
  } as const;

  return (
    <div style={{ lineHeight: 0 }}>
      <svg
        ref={svgRef}
        className={go ? 'sw-go' : undefined}
        height={height}
        width={width}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="SellWant"
        style={{ overflow: 'visible', display: 'block' }}
      >
        <defs>
          <clipPath className="sw-clip-sell" id="sw-cs">
            <rect x={0} y={0} width={width} height={height} />
          </clipPath>
          <clipPath className="sw-clip-want" id="sw-cw">
            <rect x={0} y={0} width={width} height={height} />
          </clipPath>
        </defs>

        <g className="sw-g-sell" clipPath="url(#sw-cs)">
          <text {...textProps} ref={sellRef}>
            <tspan fill={colors.sell}>Sell</tspan>
            <tspan fill="transparent">Want</tspan>
          </text>
        </g>

        <g className="sw-g-want" clipPath="url(#sw-cw)">
          <text {...textProps}>
            <tspan fill="transparent">Sell</tspan>
            <tspan fill={colors.want}>Want</tspan>
          </text>
        </g>
      </svg>
    </div>
  );
}

export default Wordmark;
