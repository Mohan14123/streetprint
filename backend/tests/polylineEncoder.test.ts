import { encodePolyline, decodePolyline, requiresPolylineEncoding, encodePreview } from '../src/utils/polylineEncoder';

describe('Polyline Encoder', () => {
  const coords: [number, number][] = [
    [77.5946, 12.9716],
    [77.595, 12.972]
  ];

  it('should encode coordinates into a polyline string', () => {
    const result = encodePolyline(coords);
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('should decode a polyline string back to coordinates', () => {
    const encodedStr = encodePolyline(coords);
    const result = decodePolyline(encodedStr);
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(2);
    expect(result[0][0]).toBeCloseTo(coords[0][0]);
    expect(result[0][1]).toBeCloseTo(coords[0][1]);
  });

  it('should handle empty arrays and strings', () => {
    expect(encodePolyline([])).toBe('');
    expect(decodePolyline('')).toEqual([]);
  });

  it('should check if encoding is required', () => {
    const largeArray = Array(501).fill([77, 12]);
    expect(requiresPolylineEncoding(largeArray)).toBe(true);
    expect(requiresPolylineEncoding(coords)).toBe(false);
  });

  it('should encode preview of coordinates', () => {
    const manyCoords = Array(30).fill([77.5946, 12.9716]);
    const preview = encodePreview(manyCoords, 20);
    const decoded = decodePolyline(preview);
    expect(decoded.length).toBe(20);
  });
});
