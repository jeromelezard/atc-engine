import type { Observation } from "../../types/observation";

export function makeObservation(overrides: Partial<Observation> = {}): Observation {
    return {
        icao24: "40621D",
        timestamp: 100,
        latitude: 51.47,
        longitude: -0.45,
        altitude: 10000,
        velocity: 230,
        heading: 90,
        ...overrides,
    };
}
