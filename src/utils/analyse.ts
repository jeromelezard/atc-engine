import type { Coordinates, Observation } from "../types/observation";
import type { TrackAnalysis } from "../types/trackAnalysis";
import { haversineFormula } from "./observations";

export function analyseTrack(flightTrack: Observation[]): TrackAnalysis[] {
    const trackAnalysis: TrackAnalysis[] = [];
    if (flightTrack.length <= 1) return trackAnalysis;

    for (let i = 0; i < flightTrack.length; i++) {
        const observation = flightTrack[i];
        const nextObservation = flightTrack[i + 1];

        if (!nextObservation || !observation) break;

        const elapsedTime = nextObservation.timestamp - observation.timestamp;
        const distance = getDistance(observation, nextObservation);
        const bearing = getBearing(
            { latitude: observation.latitude, longitude: observation.longitude },
            { latitude: nextObservation.latitude, longitude: nextObservation.longitude },
        );

        const groundSpeed = getGroundSpeed(elapsedTime, distance);

        trackAnalysis.push({
            icao24: observation.icao24,
            elapsedTime,
            bearing,
            distance,
            groundSpeed,
        });
    }

    return trackAnalysis;
}

function getGroundSpeed(elapsedTime: number, distanceTravelled: number) {
    return distanceTravelled / elapsedTime;
}

function getDistance(observation: Observation, nextObservation: Observation) {
    return haversineFormula(
        { latitude: observation.latitude, longitude: observation.longitude },
        { latitude: nextObservation.latitude, longitude: nextObservation.longitude },
    );
}

export function getBearing(pointA: Coordinates, pointB: Coordinates): number | null {
    if (pointA.latitude == pointB.latitude && pointA.longitude == pointB.longitude) return null;
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const toDeg = (rad: number) => (rad * 180) / Math.PI;

    const φ1 = toRad(pointA.latitude),
        φ2 = toRad(pointB.latitude);
    const Δλ = toRad(pointB.longitude - pointA.longitude);

    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);

    const brng = toDeg(Math.atan2(y, x));
    return (brng + 360) % 360;
}
