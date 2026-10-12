import { describe, expect, it } from 'vitest';
import { scheduleReview } from './srs.js';

describe('SRS schedule rules', () => {
  it('restarts failed cards immediately',()=>expect(scheduleReview(0,4,20,2.5).intervalDays).toBe(0));
  it('sets the first successful review to one day',()=>expect(scheduleReview(2,0,0,2.5).intervalDays).toBe(1));
  it('sets the second successful review to six days',()=>expect(scheduleReview(3,1,1,2.5).intervalDays).toBe(6));
  it('never lets ease fall below 1.3',()=>expect(scheduleReview(0,0,0,1.3).easeFactor).toBe(1.3));
  it('rejects ratings outside the supported buttons',()=>expect(()=>scheduleReview(4,0,0,2.5)).toThrow(RangeError));
});
