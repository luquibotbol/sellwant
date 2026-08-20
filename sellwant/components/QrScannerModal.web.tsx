import React from 'react';

interface Props {
  visible: boolean;
  onClose: () => void;
  onScanned: (payload: string) => void;
}

/**
 * The scanner does not exist on web.
 *
 * TicketCodeField already refuses to render it here -- web uploads a
 * screenshot and decodes it instead -- but a static import is enough to pull
 * expo-camera into the bundle whether or not the component is ever mounted,
 * and that is 52 KB of camera code shipped to a browser that will never open a
 * camera. Metro resolves this file on web, so the real module and its
 * dependency stay out of the graph entirely.
 *
 * Same mechanism as DateField.web.tsx. It renders nothing on purpose.
 */
export function QrScannerModal(_: Props) {
  return null;
}

export default QrScannerModal;
