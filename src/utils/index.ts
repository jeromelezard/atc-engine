import type { Observation, TrackedObservations } from "../types/observation";

export function parseObservation(input: unknown): Observation | null {
    if (input === null || typeof input !== "object" || Array.isArray(input)) {
        return null;
    }

    const raw = input as Record<string, unknown>;

    if (
        "icao24" in raw &&
        typeof raw.icao24 === "string" &&
        raw.icao24.trim() !== "" &&
        "timestamp" in raw &&
        typeof raw.timestamp === "number" &&
        Number.isFinite(raw.timestamp) &&
        "latitude" in raw &&
        typeof raw.latitude === "number" &&
        Number.isFinite(raw.latitude) &&
        "longitude" in raw &&
        typeof raw.longitude === "number" &&
        Number.isFinite(raw.longitude) &&
        validLatitude(raw.latitude) &&
        validLongitude(raw.longitude) &&
        isNullableOrUndefinedFiniteNumber(raw.altitude) &&
        isNullableOrUndefinedFiniteNumber(raw.velocity) &&
        isNullableOrUndefinedFiniteNumber(raw.heading)
    ) {
        return {
            icao24: raw.icao24,
            timestamp: raw.timestamp,
            latitude: raw.latitude,
            longitude: raw.longitude,
            altitude: raw.altitude ?? null,
            velocity: raw.velocity ?? null,
            heading: raw.heading ?? null,
        };
    }

    return null;
}
function isNullableOrUndefinedFiniteNumber(value: unknown): value is number | null | undefined {
    return value === null || value === undefined || (typeof value === "number" && Number.isFinite(value));
}

export function validateCoords(observation: Observation) {
    return observation.latitude >= -90 && observation.latitude <= 90 && observation.longitude >= -180 && observation.longitude <= 180;
}

function validLatitude(latitude: number) {
    return latitude >= -90 && latitude <= 90;
}
function validLongitude(longitude: number) {
    return longitude >= -180 && longitude <= 180;
}

export function detectDuplicate(observation: Observation, trackedFlights: TrackedObservations) {
    const { icao24, ...data } = observation;
    const currentFlight = (trackedFlights[icao24] ??= []);

    const isDuplicate = currentFlight.some(
        (obs) =>
            obs.timestamp === data.timestamp &&
            obs.latitude === data.latitude &&
            obs.longitude === data.longitude &&
            obs.altitude === data.altitude &&
            obs.velocity === data.velocity &&
            obs.heading === data.heading,
    );

    return isDuplicate;
}

export function track(observation: Observation, trackedFlights: TrackedObservations): void {
    const history = (trackedFlights[observation.icao24] ??= []);
    const insertAt = history.findIndex((flight) => observation.timestamp < flight.timestamp);

    if (insertAt === -1) {
        history.push(observation);
    } else {
        history.splice(insertAt, 0, observation);
    }
}
