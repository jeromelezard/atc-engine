import type { Coordinates, FlightStatuses, InsertionDecision, Observation, TrackedObservations } from "../types/observation";

const MAX_SPEED_THRESHOLD = 350;
export const STALE_THRESHOLD = 60;

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

export function evaluateInsertion(history: readonly Observation[], observation: Observation): InsertionDecision {
    if (history.length == 0) return { status: "accepted", insertAt: 0 };

    const insertAt = history.findIndex((flight) => observation.timestamp < flight.timestamp);

    const index = insertAt == -1 ? history.length : insertAt;

    const previous = history[index - 1];
    const next = history[index];
    const validFromPrevious = !previous || validateFlightMovementWithNeighbour(previous, observation);

    const validToNext = !next || validateFlightMovementWithNeighbour(observation, next);
    if (validFromPrevious && validToNext) {
        return { status: "accepted", insertAt: insertAt == -1 ? index : insertAt };
    } else {
        return { status: "flagged", reason: "implausible-speed" };
    }
}

export function track(
    observation: Observation,
    history: Observation[],
    flaggedObservations: TrackedObservations,
    insertionStatus: InsertionDecision,
): void {
    const flaggedHistory = (flaggedObservations[observation.icao24] ??= []);

    if (insertionStatus.status == "accepted") history.splice(insertionStatus.insertAt, 0, observation);
    if (insertionStatus.status == "flagged") flaggedHistory.push(observation);

    return;
}

export function validateFlightMovementWithNeighbour(neighbourObservation: Observation | undefined, observation: Observation) {
    if (!neighbourObservation) return true;

    const observationDistance = haversineFormula(
        { latitude: neighbourObservation.latitude, longitude: neighbourObservation.longitude },
        { latitude: observation.latitude, longitude: observation.longitude },
    );

    const observationTimeDifference = observation.timestamp - neighbourObservation.timestamp;

    if (observationTimeDifference <= 0) return false;

    const velocity = observationDistance / observationTimeDifference;

    if (velocity > MAX_SPEED_THRESHOLD) return false;

    return true;
}

export function haversineFormula(pointA: Coordinates, pointB: Coordinates) {
    const r = 6371;

    const distance =
        2 *
        r *
        Math.asin(
            Math.sqrt(
                Math.sin(degToRad((pointB.latitude - pointA.latitude) / 2)) ** 2 +
                    Math.cos(degToRad(pointA.latitude)) *
                        Math.cos(degToRad(pointB.latitude)) *
                        Math.sin(degToRad((pointB.longitude - pointA.longitude) / 2)) ** 2,
            ),
        );

    return Math.round(distance * 1000);
}

function degToRad(deg: number) {
    return deg * (Math.PI / 180);
}

export function trackStatuses(trackedFlights: TrackedObservations, processingTime: number): FlightStatuses {
    const flightStatuses: FlightStatuses = {};
    for (const flight of Object.values(trackedFlights)) {
        const latestFlight = flight[flight.length - 1];
        if (flight.length == 0 || !latestFlight) continue;

        const staleTimeDifference = processingTime - latestFlight.timestamp > STALE_THRESHOLD;

        flightStatuses[latestFlight.icao24] = staleTimeDifference ? "STALE" : "ACTIVE";
    }

    return flightStatuses;
}
