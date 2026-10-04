import type { BuildType, Rules } from '../types';

export interface TypeSpec {
  label: string;
  w: number; // default footprint along the long axis
  d: number;
  storeyHeight: number;
  eave1: number; // eave height for one storey
  roof: 'gable' | 'shed' | 'flat' | 'none';
  roofRise: number; // ridge above eave
  habitable: boolean; // uses dwelling setbacks
  vehicle: boolean; // needs a driveway from the entrance
  defaultZone: 'any' | 'road' | 'forest' | 'center';
}

// Typical sizes for Russian dacha / IZhS construction. Shown to the owner as defaults, never hidden.
export const CATALOG: Record<BuildType, TypeSpec> = {
  house: { label: 'House', w: 10, d: 8, storeyHeight: 3.0, eave1: 3.1, roof: 'gable', roofRise: 3.0, habitable: true, vehicle: false, defaultZone: 'any' },
  guesthouse: { label: 'Guest house', w: 6, d: 6, storeyHeight: 2.9, eave1: 2.9, roof: 'gable', roofRise: 2.4, habitable: true, vehicle: false, defaultZone: 'any' },
  garage: { label: 'Garage', w: 4, d: 6.5, storeyHeight: 2.8, eave1: 2.8, roof: 'gable', roofRise: 1.4, habitable: false, vehicle: true, defaultZone: 'road' },
  carport: { label: 'Carport', w: 3.5, d: 6, storeyHeight: 2.6, eave1: 2.6, roof: 'shed', roofRise: 0.4, habitable: false, vehicle: true, defaultZone: 'road' },
  sauna: { label: 'Sauna (banya)', w: 6, d: 4, storeyHeight: 2.6, eave1: 2.6, roof: 'gable', roofRise: 1.8, habitable: false, vehicle: false, defaultZone: 'any' },
  shed: { label: 'Utility shed', w: 4, d: 3, storeyHeight: 2.3, eave1: 2.3, roof: 'shed', roofRise: 0.6, habitable: false, vehicle: false, defaultZone: 'any' },
  workshop: { label: 'Workshop', w: 6, d: 4, storeyHeight: 2.8, eave1: 2.8, roof: 'gable', roofRise: 1.6, habitable: false, vehicle: false, defaultZone: 'any' },
  greenhouse: { label: 'Greenhouse', w: 6, d: 3, storeyHeight: 2.1, eave1: 1.3, roof: 'none', roofRise: 0.8, habitable: false, vehicle: false, defaultZone: 'center' },
  gazebo: { label: 'Gazebo', w: 4, d: 3, storeyHeight: 2.3, eave1: 2.3, roof: 'gable', roofRise: 1.2, habitable: false, vehicle: false, defaultZone: 'any' },
  pool: { label: 'Pool', w: 8, d: 4, storeyHeight: 0, eave1: 0.2, roof: 'none', roofRise: 0, habitable: false, vehicle: false, defaultZone: 'center' },
  garden: { label: 'Vegetable garden', w: 12, d: 10, storeyHeight: 0, eave1: 0.25, roof: 'none', roofRise: 0, habitable: false, vehicle: false, defaultZone: 'any' },
  parking: { label: 'Parking pad', w: 6, d: 6, storeyHeight: 0, eave1: 0.05, roof: 'none', roofRise: 0, habitable: false, vehicle: true, defaultZone: 'road' },
  playground: { label: 'Play area', w: 6, d: 6, storeyHeight: 0, eave1: 0.05, roof: 'none', roofRise: 0, habitable: false, vehicle: false, defaultZone: 'center' },
  terrace: { label: 'Terrace', w: 6, d: 4, storeyHeight: 0, eave1: 0.45, roof: 'none', roofRise: 0, habitable: false, vehicle: false, defaultZone: 'any' },
};

/** Flat items do not count as buildings for setbacks / clearances. */
export const isVolume = (t: BuildType) => CATALOG[t].storeyHeight > 0;

export function heightsFor(type: BuildType, storeys: number) {
  const s = CATALOG[type];
  if (s.storeyHeight === 0) return { height: s.eave1, ridge: s.eave1 };
  const eave = s.eave1 + Math.max(0, storeys - 1) * s.storeyHeight;
  return { height: eave, ridge: eave + s.roofRise };
}

// Typical Russian norms (SP 53.13330.2019 p.6.7-6.8, SP 4.13130.2013 p.4.14). Editable in the UI;
// the owner must verify local PZZ rules before building.
export const DEFAULT_RULES: Rules = {
  houseFromSide: 3,
  houseFromRoad: 5,
  outbuildingFromSide: 1,
  outbuildingFromRoad: 1,
  houseToSauna: 8,
  betweenBuildings: 2,
  forestBuffer: 15,
  respectForestBuffer: false,
};
