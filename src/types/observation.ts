export interface Observation {
    icao24: string;
    timestamp: number;
    latitude: number;
    longitude: number;
    altitude: number | null;
    velocity: number | null;
    heading: number | null;
}

export interface TrackedObservations {
    [icao24: string]: Observation[];
}

export interface Coordinates {
    latitude: number;
    longitude: number;
}


export type InsertionDecision =
    | { status: "accepted"; insertAt: number }
    | { status: "flagged"; reason: "implausible-speed" };