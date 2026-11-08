import { observations } from "./utils/observations";
import type { TrackedObservations } from "./types/observation";
import { detectDuplicate, parseObservation, track } from "./utils";

export function trackObservations(rawObservations: unknown) {
    const trackedFlights: TrackedObservations = {};
    const invalidObservations: unknown[] = [];
    const duplicateObservations: TrackedObservations = {};
    const conflictingObservations: TrackedObservations = {};

    if (!Array.isArray(rawObservations)) {
        return { trackedFlights, invalidObservations, duplicateObservations, conflictingObservations };
    }
    for (const raw of rawObservations) {
        const observation = parseObservation(raw);
        if (!observation) {
            invalidObservations.push(raw);
            continue;
        }

        if (detectDuplicate(observation, trackedFlights)) {
            (duplicateObservations[observation.icao24] ??= []).push(observation);
            continue;
        }

        if (trackedFlights[observation.icao24]?.some((f) => f.timestamp === observation.timestamp)) {
            (conflictingObservations[observation.icao24] ??= []).push(observation);
            continue;
        }

        track(observation, trackedFlights);
    }
    return { trackedFlights, invalidObservations, duplicateObservations, conflictingObservations };
}

const result = trackObservations(observations);
if (result) {
    console.log("Tracked Flights:", result.trackedFlights["40621D"]?.length ?? 0);
    console.log("Invalid Observations:", result.invalidObservations.length ?? 0);
    console.log("Duplicate Observations:", result.duplicateObservations["40621D"]?.length ?? 0);
    console.log("Conflicting Observations:", result.conflictingObservations["40621D"]?.length ?? 0);
} else {
    console.log("Invalid input");
}
