/**
 * src/app/components/MapController.tsx
 * Auto-fly map to user's latest position during active tracking.
 * Uses react-leaflet's useMap() hook to control the map instance.
 */
import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';

interface MapControllerProps {
  /** Latest position as [lat, lng] (Leaflet order, NOT GeoJSON) */
  position: [number, number] | null;
  /** Only follow when tracking is active */
  isTracking: boolean;
}

export function MapController({ position, isTracking }: MapControllerProps) {
  const map = useMap();
  const isFirstPosition = useRef(true);
  const prevPosition = useRef<[number, number] | null>(null);

  useEffect(() => {
    if (!position) return;

    // Deep compare to prevent infinite flyTo loops from new array references
    if (
      prevPosition.current &&
      prevPosition.current[0] === position[0] &&
      prevPosition.current[1] === position[1]
    ) {
      return;
    }
    prevPosition.current = position;

    if (isFirstPosition.current) {
      // First position — snap immediately (no animation)
      map.setView(position, 16);
      isFirstPosition.current = false;
      return;
    }

    if (isTracking) {
      // Smooth fly during active tracking
      map.flyTo(position, map.getZoom(), {
        duration: 0.8,
        easeLinearity: 0.25,
      });
    }
  }, [position, isTracking, map]);

  // Reset first-position flag when tracking restarts
  useEffect(() => {
    if (!isTracking) {
      isFirstPosition.current = true;
    }
  }, [isTracking]);

  return null;
}
