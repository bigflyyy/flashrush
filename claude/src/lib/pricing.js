/* Courier pricing — distance + parcel size, times surge.
   All knobs live here (and are overridable via settings) so pricing is easy to tune. */

export const PRICING = {
  baseFee: 4.99,        // flat pickup fee
  perMile: 1.25,        // distance rate
  serviceRate: 0.10,    // platform service fee on the subtotal
  sizeMultipliers: {    // parcel size factor
    small: 1.0,         // fits in a hand / envelope
    medium: 1.3,        // shoebox
    large: 1.7,         // carry-on
    xl: 2.2,            // bulky / two-handed
  },
};

export const SIZES = Object.keys(PRICING.sizeMultipliers);

// Haversine distance in miles between two lat/lng points.
export function distanceMiles(a, b) {
  if (!a || !b) return 0;
  const R = 3958.8;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(h));
}

/* Compute a full price breakdown.
   miles: number, size: one of SIZES, surge: multiplier, tip: number */
export function quote({ miles, size = 'small', surge = 1.0, tip = 0 }) {
  const sizeMult = PRICING.sizeMultipliers[size] ?? 1.0;
  const distanceCost = miles * PRICING.perMile;
  const subtotal = (PRICING.baseFee + distanceCost) * sizeMult;
  const serviceFee = subtotal * PRICING.serviceRate;
  const surged = (subtotal + serviceFee) * surge;
  const total = surged + Number(tip || 0);
  const round = (n) => Math.round(n * 100) / 100;
  return {
    miles: round(miles),
    size,
    baseFee: PRICING.baseFee,
    distanceCost: round(distanceCost),
    sizeMultiplier: sizeMult,
    subtotal: round(subtotal),
    serviceFee: round(serviceFee),
    surge,
    tip: Number(tip || 0),
    total: round(total),
  };
}
