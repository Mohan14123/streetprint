import { savePlace, markPlaceVisited, deletePlace, updatePlace } from '../src/services/place.service';
import Place from '../src/models/Place';

jest.mock('../src/models/Place');
jest.mock('../src/routes/events.routes', () => ({ pushToUser: jest.fn() }));
jest.mock('../src/events/producer', () => ({ emitEvent: jest.fn(), STREAMS: { PLACE_EVENTS: 'place:events' } }));

describe('Place Service - Error Cases', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('savePlace', () => {
    it('should throw GPS_INVALID if coordinates are invalid', async () => {
      await expect(savePlace('user123', 'Test', 200, 200)).rejects.toThrow('Invalid WGS84 coordinates');
    });
  });

  describe('markPlaceVisited', () => {
    it('should throw PLACE_NOT_FOUND if place does not exist', async () => {
      (Place.findOneAndUpdate as jest.Mock).mockResolvedValueOnce(null);
      await expect(markPlaceVisited('user123', 'place123')).rejects.toThrow('Place not found or does not belong to user');
    });
  });

  describe('deletePlace', () => {
    it('should throw PLACE_NOT_FOUND if place does not exist', async () => {
      (Place.findOneAndDelete as jest.Mock).mockResolvedValueOnce(null);
      await expect(deletePlace('user123', 'place123')).rejects.toThrow('Place not found or does not belong to user');
    });
  });

  describe('updatePlace', () => {
    it('should throw VALIDATION_ERROR if no fields to update', async () => {
      await expect(updatePlace('user123', 'place123', {})).rejects.toThrow('No valid fields to update');
    });

    it('should throw GPS_INVALID if coordinates are invalid', async () => {
      await expect(updatePlace('user123', 'place123', { lat: 200, lng: 200 })).rejects.toThrow('Invalid WGS84 coordinates');
    });

    it('should throw PLACE_NOT_FOUND if place does not exist', async () => {
      (Place.findOneAndUpdate as jest.Mock).mockResolvedValueOnce(null);
      await expect(updatePlace('user123', 'place123', { label: 'New Label' })).rejects.toThrow('Place not found or does not belong to user');
    });
  });
});
