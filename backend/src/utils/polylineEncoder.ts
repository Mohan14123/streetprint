/**
 * src/utils/polylineEncoder.ts
 * Google Polyline Algorithm encode/decode — pure, no side effects.
 * Rule 5.5: Routes > 500 coordinate pairs must be encoded before storage.
 *           isPolylineEncoded flag is set to true on the Route document.
 *           Decoding is transparent on read — consumers always receive GeoJSON.
 * Rule 5.3: This encoder/decoder MUST NOT simplify or drop any coordinates.
 *           Every input point must appear in the output.
 * Rule 11: All utility functions must be pure.
 */

/** GeoJSON [longitude, latitude] coordinate pair */
export type LngLat = [number, number];

// ────────────────────────────────────────────────────────────────
// Encoding
// ────────────────────────────────────────────────────────────────

/**
 * Encode a single signed integer value using the Google Polyline Algorithm.
 * Steps: left-shift 1, invert if negative, split into 5-bit chunks (LSB first),
 *        OR with 0x20 on all but last chunk, add 63, convert to char.
 */
function encodeValue(value: number): string {
  let v = Math.round(value * 1e5);
  v = v < 0 ? ~(v << 1) : v << 1;

  let result = '';
  while (v >= 0x20) {
    result += String.fromCharCode(((0x20 | (v & 0x1f)) + 63));
    v >>= 5;
  }
  result += String.fromCharCode(v + 63);
  return result;
}

/**
 * Encode an array of [longitude, latitude] coordinate pairs into a Google Polyline string.
 *
 * IMPORTANT: Google Polyline encodes [latitude, longitude] (reversed from GeoJSON).
 * This function handles the swap internally so the caller always works in GeoJSON order.
 *
 * Rule 5.3: Every input coordinate is encoded — no simplification.
 *
 * @param coordinates - Array of [lng, lat] GeoJSON coordinate pairs
 * @returns Encoded polyline string
 */
export function encodePolyline(coordinates: LngLat[]): string {
  if (coordinates.length === 0) return '';

  let prevLat = 0;
  let prevLng = 0;
  let result = '';

  for (const [lng, lat] of coordinates) {
    // Google Polyline uses lat, lng order — swap from GeoJSON
    result += encodeValue(lat - prevLat);
    result += encodeValue(lng - prevLng);
    prevLat = lat;
    prevLng = lng;
  }

  return result;
}

// ────────────────────────────────────────────────────────────────
// Decoding
// ────────────────────────────────────────────────────────────────

/**
 * Decode a single signed integer value from a polyline string starting at `index`.
 * Mutates `index` in place (via the returned wrapper).
 */
function decodeValue(polyline: string, index: number): { value: number; nextIndex: number } {
  let result = 0;
  let shift = 0;
  let byte: number;
  let i = index;

  do {
    byte = polyline.charCodeAt(i++) - 63;
    result |= (byte & 0x1f) << shift;
    shift += 5;
  } while (byte >= 0x20);

  const value = result & 1 ? ~(result >> 1) : result >> 1;
  return { value, nextIndex: i };
}

/**
 * Decode a Google Polyline string back into an array of [longitude, latitude] GeoJSON pairs.
 *
 * IMPORTANT: Google Polyline stores [lat, lng] — this function swaps back to GeoJSON [lng, lat].
 *
 * Rule 5.5: Decode transparently on read so consumers always receive GeoJSON coordinates.
 *
 * @param polyline - Encoded polyline string
 * @returns Array of [lng, lat] GeoJSON coordinate pairs
 */
export function decodePolyline(polyline: string): LngLat[] {
  if (!polyline || polyline.length === 0) return [];

  const coordinates: LngLat[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < polyline.length) {
    const latResult = decodeValue(polyline, index);
    lat += latResult.value / 1e5;
    index = latResult.nextIndex;

    const lngResult = decodeValue(polyline, index);
    lng += lngResult.value / 1e5;
    index = lngResult.nextIndex;

    // Swap from Google's [lat, lng] back to GeoJSON [lng, lat]
    coordinates.push([
      parseFloat(lng.toFixed(6)),
      parseFloat(lat.toFixed(6)),
    ]);
  }

  return coordinates;
}

// ────────────────────────────────────────────────────────────────
// Threshold Check
// ────────────────────────────────────────────────────────────────

/**
 * The minimum number of coordinate pairs that triggers polyline encoding.
 * Rule 5.5: Routes with > 500 coordinate pairs must be encoded.
 */
export const POLYLINE_ENCODING_THRESHOLD = 500;

/**
 * Returns true if the coordinate array exceeds the threshold requiring polyline encoding.
 */
export function requiresPolylineEncoding(coordinates: LngLat[]): boolean {
  return coordinates.length > POLYLINE_ENCODING_THRESHOLD;
}

// ────────────────────────────────────────────────────────────────
// Preview Extraction
// ────────────────────────────────────────────────────────────────

/**
 * Extract the first N coordinate pairs from a coordinates array as a polyline string.
 * Used by suggestion.service.ts to generate `previewPolyline` (first 20 points)
 * without decoding the full route.
 *
 * @param coordinates - Full [lng, lat] coordinate array
 * @param count - Number of leading points to encode (default: 20)
 * @returns Encoded polyline string of the first `count` points
 */
export function encodePreview(coordinates: LngLat[], count = 20): string {
  return encodePolyline(coordinates.slice(0, count));
}
