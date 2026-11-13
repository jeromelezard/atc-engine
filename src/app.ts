import { observations } from "./tests/fixtures/sampleObservations";
import type { FlightStatuses, TrackedObservations } from "./types/observation";
import { detectDuplicate, evaluateInsertion, parseObservation, insertObservation, trackStatuses } from "./utils/observations";
import { writeJournalRecord } from "./utils/persist";

const defaultProcessingTime = 1000;

export function trackObservations(rawObservations: unknown, processingTime: number) {
    const trackedFlights: TrackedObservations = {};
    const invalidObservations: unknown[] = [];
    const duplicateObservations: TrackedObservations = {};
    const conflictingObservations: TrackedObservations = {};
    const flaggedObservations: TrackedObservations = {};
    let flightStatuses: FlightStatuses = {};

    if (!Array.isArray(rawObservations)) {
        return { trackedFlights, invalidObservations, duplicateObservations, conflictingObservations, flaggedObservations, flightStatuses };
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

        const history = (trackedFlights[observation.icao24] ??= []);

        const insertionStatus = evaluateInsertion(history, observation);

        insertObservation(observation, history, flaggedObservations, insertionStatus);
    }

    flightStatuses = trackStatuses(trackedFlights, processingTime);

    return { trackedFlights, invalidObservations, duplicateObservations, conflictingObservations, flaggedObservations, flightStatuses };
}

async function main() {
    const result = trackObservations(observations, defaultProcessingTime);

    await writeJournalRecord({
        version: 1,
        processingTime: defaultProcessingTime,
        observations,
    });
    console.log("Journal batch saved to output/trackedObservations.jsonl");

    console.log("Tracked Flights:", result.trackedFlights["40621D"]?.length ?? 0);
    console.log("Invalid Observations:", result.invalidObservations.length);
    console.log("Duplicate Observations:", result.duplicateObservations["40621D"]?.length ?? 0);
    console.log("Conflicting Observations:", result.conflictingObservations["40621D"]?.length ?? 0);
    console.log("Flagged Observations:", result.flaggedObservations["40621D"]?.length ?? 0);
    console.log("Flight statuses:", result.flightStatuses);
}

void main();
