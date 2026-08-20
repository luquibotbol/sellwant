import React, { useRef, useState } from 'react';
import {
  View,
  StyleSheet,
  Image,
  ScrollView,
  Pressable,
  Platform,
  NativeSyntheticEvent,
  NativeScrollEvent,
  LayoutChangeEvent,
} from 'react-native';
import { Text } from '@/components/ui';
import { colors, radius, space } from '@/constants/theme';

/**
 * Every listing photo gets the same frame: 4:3, full width, whole picture.
 *
 * Two decisions, and they pull against each other.
 *
 * The frame is a fixed shape rather than each photo's own, because a page
 * whose height depends on what someone happened to photograph has no rhythm:
 * scroll a feed of them and every listing sits somewhere different. Uniform
 * framing is what makes a set of user photos read as a product rather than an
 * upload folder.
 *
 * Inside that frame the fit is `contain`, never `cover`. Cropping to fill is
 * how a portrait photo of a Gameboy loses the top of the console and the whole
 * d-pad -- 343 of its 900 pixels, measured. Letterboxing costs some empty
 * space; cropping costs the thing the photo was taken to show.
 *
 * 4:3 because it is the shape that wastes least across what people actually
 * post: a 3:4 portrait letterboxes at the sides, a 16:9 at top and bottom, and
 * neither is left with the thin band a 3:2 or wider frame would give a
 * portrait shot.
 */
export const PHOTO_ASPECT = 4 / 3;

interface Props {
  urls: string[];
  /** Creation and edit pass this; the listing page does not. */
  onRemove?: (url: string) => void;
}

export function PhotoCarousel({ urls, onRemove }: Props) {
  const scroller = useRef<ScrollView | null>(null);
  const [width, setWidth] = useState(0);
  const [index, setIndex] = useState(0);

  if (!urls.length) return null;

  const many = urls.length > 1;

  // Slide width is measured rather than assumed: this sits inside a padded
  // column on the listing page and a form on the create screen, so the two
  // are different widths and a hardcoded one would misalign the paging.
  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!width) return;
    const next = Math.round(e.nativeEvent.contentOffset.x / width);
    if (next !== index) setIndex(Math.max(0, Math.min(next, urls.length - 1)));
  };

  const goTo = (next: number) => {
    const clamped = Math.max(0, Math.min(next, urls.length - 1));
    setIndex(clamped);
    scroller.current?.scrollTo({ x: clamped * width, animated: true });
  };

  return (
    <View style={styles.container} onLayout={onLayout}>
      <View style={styles.frame}>
        {/* Paging rather than free scroll: these are whole photos, not a strip
            of thumbnails, so a half-shown one is never a useful resting place. */}
        <ScrollView
          ref={scroller}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onScroll={onScroll}
          scrollEventThrottle={16}
          // Nothing to page through with one photo, and a scroller that moves
          // a few pixels under the thumb reads as broken.
          scrollEnabled={many}
        >
          {urls.map((url) => (
            <View key={url} style={[styles.slide, !!width && { width }]}>
              <Image
                source={{ uri: url }}
                style={styles.image}
                resizeMode="contain"
                accessibilityLabel="Listing photo"
              />
            </View>
          ))}
        </ScrollView>

        {/* Arrows are a pointer affordance. On touch the swipe is the gesture,
            and two tap targets over the photo would just cover it. */}
        {many && Platform.OS === 'web' && (
          <>
            {index > 0 && (
              <Pressable
                onPress={() => goTo(index - 1)}
                style={[styles.arrow, styles.arrowLeft]}
                accessibilityRole="button"
                accessibilityLabel="Previous photo"
              >
                <Text variant="bodyMedium">‹</Text>
              </Pressable>
            )}
            {index < urls.length - 1 && (
              <Pressable
                onPress={() => goTo(index + 1)}
                style={[styles.arrow, styles.arrowRight]}
                accessibilityRole="button"
                accessibilityLabel="Next photo"
              >
                <Text variant="bodyMedium">›</Text>
              </Pressable>
            )}
          </>
        )}

        {onRemove && (
          <Pressable
            onPress={() => {
              // Removing the last slide leaves the scroller past its content,
              // so step back before the list shrinks under it.
              if (index === urls.length - 1 && index > 0) goTo(index - 1);
              onRemove(urls[index]);
            }}
            style={styles.remove}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Remove this photo"
          >
            <Text variant="caption" tone="inverse">
              ✕
            </Text>
          </Pressable>
        )}
      </View>

      {many && (
        <View style={styles.dots}>
          {urls.map((url, i) => (
            <Pressable
              key={url}
              onPress={() => goTo(i)}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel={`Photo ${i + 1} of ${urls.length}`}
            >
              <View style={[styles.dot, i === index && styles.dotOn]} />
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginTop: space[5] },
  frame: {
    position: 'relative',
    width: '100%',
    aspectRatio: PHOTO_ASPECT,
    borderRadius: radius.lg,
    backgroundColor: colors.muted,
    overflow: 'hidden',
  },
  slide: { height: '100%', alignItems: 'center', justifyContent: 'center' },
  image: { width: '100%', height: '100%' },
  arrow: {
    position: 'absolute',
    top: '50%',
    marginTop: -16,
    width: 32,
    height: 32,
    borderRadius: radius.full,
    // Deliberately not the card colour: this sits on top of a photo, and a
    // flat panel colour disappears against a photo that happens to match it.
    backgroundColor: 'rgba(9,9,11,0.72)',
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  arrowLeft: { left: space[3] },
  arrowRight: { right: space[3] },
  remove: {
    position: 'absolute',
    top: space[3],
    right: space[3],
    width: 26,
    height: 26,
    borderRadius: radius.full,
    backgroundColor: 'rgba(9,9,11,0.72)',
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: space[2],
    marginTop: space[3],
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: radius.full,
    backgroundColor: colors.borderStrong,
  },
  dotOn: { backgroundColor: colors.foreground },
});

export default PhotoCarousel;
