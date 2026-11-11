import { describe, it, expect } from "vitest";
import {
    evaluateInsertion,
    haversineFormula,
    parseObservation,
    STALE_THRESHOLD,
    trackStatuses,
    validateFlightMovementWithNeighbour,
} from "../utils/observations";
import { trackObservations } from "../app";
import { makeObservation } from "./helpers/makeObservation";
import { observations } from "./fixtures/sampleObservations";
import type { Coordinates } from "../types/observation";
import { analyseTrack, getBearing } from "../utils/analyse";

const TEST_PROCESSING_TIME = 1_800_000_000;
const trackAtTestTime = (input: unknown) => trackObservations(input, TEST_PROCESSING_TIME);

export const sampleObservations = [
    makeObservation({ timestamp: 100 }),
    makeObservation({ timestamp: 200 }),
    makeObservation({ timestamp: 300 }),
    makeObservation({ timestamp: 200 }), // Duplicate
    makeObservation({ timestamp: 400 }),
    makeObservation({ timestamp: 350 }), // Out of order
    makeObservation({ timestamp: 500, latitude: 91 }), // Invalid
    makeObservation({ timestamp: 100, latitude: 57.2, longitude: 140.2 }), // Conflicting
];

describe("Validate coordinate tests", () => {
    it.each([
        ["latitude below minimum", { latitude: -91 }],
        ["latitude above maximum", { latitude: 91 }],
        ["longitude below minimum", { longitude: -181 }],
        ["longitude above maximum", { longitude: 181 }],
    ])("should reject %s", (_case, coordinates) => {
        expect(parseObservation(makeObservation(coordinates))).toBeNull();
    });
    it.each([
        { latitude: -90, longitude: -180 },
        { latitude: 90, longitude: 180 },
        { latitude: 0, longitude: 0 },
    ])("should accept boundary coordinates: $latitude, $longitude", (coordinates) => {
        expect(parseObservation(makeObservation(coordinates))).toMatchObject(coordinates);
    });
});

describe("Parsing observation tests", () => {
    it.each([
        ["null latitude", { icao24: "40621D", timestamp: 300, latitude: null, longitude: -0.45 }],
        ["null longitude", { icao24: "40621D", timestamp: 300, latitude: 12, longitude: null }],
        ["Infinity latitude", { icao24: "40621D", timestamp: 300, latitude: Infinity, longitude: -0.45 }],
        ["Infinity longitude", { icao24: "40621D", timestamp: 300, latitude: 56, longitude: Infinity }],
        ["NaN latitude", { icao24: "40621D", timestamp: 300, latitude: NaN, longitude: -0.45 }],
        ["NaN longitude", { icao24: "40621D", timestamp: 300, latitude: 56, longitude: NaN }],
    ])("should reject %s", (_case, coordinates) => {
        expect(parseObservation(coordinates)).toBeNull();
    });

    it.each([
        ["missing latitude", { icao24: "40621D", timestamp: 300, longitude: -0.45 }],
        ["missing longitude", { icao24: "40621D", timestamp: 300, latitude: 23 }],
    ])("Should reject %s", (_case, coordinates) => {
        expect(parseObservation(coordinates)).toBeNull();
    });

    it("make sure observations with null altitude, velocity and heading is accepted", () => {
        const observations = [
            makeObservation({ timestamp: 100, altitude: null }),
            makeObservation({ timestamp: 150 }),
            makeObservation({ timestamp: 200, velocity: null }),
            makeObservation({ timestamp: 300, heading: null }),
            makeObservation({ timestamp: 400, heading: null, altitude: null, velocity: null }),
        ];

        const trackedObservations = trackAtTestTime(observations);
        expect(trackedObservations.trackedFlights["40621D"]?.length).toBe(5);
    });

    it("should parse undefined nullable fields as null", () => {
        const trackedObservations = parseObservation({ icao24: "test", timestamp: 300, latitude: 51.47, longitude: -0.45 });
        expect(trackedObservations?.altitude).toBe(null);
        expect(trackedObservations?.velocity).toBe(null);
        expect(trackedObservations?.heading).toBe(null);
    });

    it.each([
        ["null", null],
        ["empty, array", []],
        ["integer", 10],
        ["boolean", false],
        ["string", "test"],
    ])("Should reject %s", (_case, value) => {
        expect(parseObservation(value)).toBeNull();
    });

    it("should return zeroes for empty input and not throw", () => {
        const trackedObservations = trackAtTestTime([]);
        expect(trackedObservations.trackedFlights).toMatchObject({});
        expect(trackedObservations.conflictingObservations).toMatchObject({});
        expect(trackedObservations.duplicateObservations).toMatchObject({});
        expect(trackedObservations.invalidObservations.length).toBe(0);
    });

    it("should allow observations with missing altitude, velocity and/or heading and incorrect types", () => {
        const observations = [
            { icao24: "test", timestamp: 300, latitude: 51.47, longitude: -0.45 },
            { icao24: "test", timestamp: 100, latitude: 51.47, longitude: -0.45 },
            { icao24: "test", timestamp: 200, latitude: "hello", longitude: -0.45 },
            { icao24: "test", timestamp: 400, latitude: 51.47, longitude: null },
            { icao24: "test", timestamp: 600, latitude: 51.47, longitude: -0.45, altitude: "string" },
            { icao24: "test", timestamp: 700, latitude: 51.47, longitude: -0.45, velocity: [], altitude: {}, heading: 4 },
            { icao24: "", timestamp: 800, latitude: 51.47, longitude: -0.45 },
            { icao24: 123, timestamp: 900, latitude: 51.47, longitude: -0.45 },
        ];
        const trackedObservations = trackAtTestTime(observations);
        expect(trackedObservations.trackedFlights["test"]?.length).toBe(2);

        const timestamps = trackedObservations.trackedFlights["test"]?.map((observation) => observation.timestamp);
        expect(timestamps).toEqual([100, 300]);

        expect(trackedObservations.invalidObservations.length).toBe(6);
    });

    it("should reject array of malformed inputs", () => {
        const invalidObservations = trackAtTestTime([null, [], 10, false, "test"]).invalidObservations;
        expect(invalidObservations).toEqual([null, [], 10, false, "test"]);
    });
});

describe("Out of order observation tests", () => {
    it("valid observations should be in chronological order", () => {
        const trackedFlights = trackAtTestTime(observations).trackedFlights;
        expect(trackedFlights["40621D"]?.length).toBeGreaterThan(1);
        for (const flight of Object.values(trackedFlights)) {
            for (let i = 1; i < flight.length; i++) {
                expect(flight[i]?.timestamp).toBeGreaterThan(flight[i - 1]!.timestamp);
            }
        }
    });

    it("should ensure out-of-order observation are actually retained", () => {
        const observations = [makeObservation({ timestamp: 100 }), makeObservation({ timestamp: 300 }), makeObservation({ timestamp: 200 })];
        const trackedFlights = trackAtTestTime(observations).trackedFlights;
        expect(trackedFlights["40621D"]?.length).toBe(3);
        const timestamps = trackedFlights["40621D"]?.map((observation) => observation.timestamp);
        expect(timestamps).toEqual([100, 200, 300]);
    });
});

describe("Irregular speed from valid observations tests", () => {
    it("should reject irregular speeds from next neighour", () => {
        const history = [
            makeObservation({ timestamp: 100, latitude: 51.47, longitude: -0.45 }),
            makeObservation({ timestamp: 300, latitude: 51.49, longitude: -0.45 }),
        ];

        const incoming = makeObservation({ timestamp: 299, latitude: 51.47, longitude: -0.45 });

        const trackedFLights = trackAtTestTime([...history, incoming]);

        expect(evaluateInsertion(history, incoming)).toEqual({
            status: "flagged",
            reason: "implausible-speed",
        });

        expect(trackedFLights.trackedFlights["40621D"]).toEqual(history);
    });

    it.each([
        ["zero elapsed time", 200, 200],
        ["negative elapsed time", 300, 200],
    ])("%s is rejected", (_case, neighbourTime, observationTime) => {
        const neighbour = makeObservation({ timestamp: neighbourTime });
        const observation = makeObservation({ timestamp: observationTime });

        expect(validateFlightMovementWithNeighbour(neighbour, observation)).toBe(false);
    });

    it("haversine equation should yield accurate result", () => {
        const haversineDistance = haversineFormula({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 1 });
        expect(haversineDistance).toBe(111195);
    });

    it("flagged observations should not appear in accepted history", () => {
        const observations = [
            makeObservation({ icao24: "40621D", timestamp: 100, latitude: 0, longitude: 0 }),
            makeObservation({ icao24: "40621D", timestamp: 101, latitude: 0, longitude: 1 }),
        ];

        const trackedObservations = trackAtTestTime(observations);

        expect(trackedObservations.trackedFlights["40621D"]).toContainEqual(
            makeObservation({ icao24: "40621D", timestamp: 100, latitude: 0, longitude: 0 }),
        );
        expect(trackedObservations.flaggedObservations["40621D"]).toContainEqual(
            makeObservation({ icao24: "40621D", timestamp: 101, latitude: 0, longitude: 1 }),
        );
    });

    it("should reject irregular speed from previous neighbour", () => {
        const history = [
            makeObservation({ timestamp: 100, latitude: 0, longitude: 0 }),
            makeObservation({ timestamp: 300, latitude: 0, longitude: 1.001 }),
        ];
        const incoming = makeObservation({ timestamp: 200, latitude: 0, longitude: 1 });

        expect(validateFlightMovementWithNeighbour(incoming, history[1]!)).toBe(true);
        expect(evaluateInsertion(history, incoming)).toEqual({
            status: "flagged",
            reason: "implausible-speed",
        });
    });
});

describe("Duplicate and conflicting observation tests", () => {
    it("should detect duplicates", () => {
        const trackedObservations = trackAtTestTime(sampleObservations);
        expect(trackedObservations.duplicateObservations["40621D"]?.length).toBe(1);
        expect(trackedObservations.trackedFlights["40621D"]?.length).toBe(5);
    });

    it("should flag conflicting observations", () => {
        const conflictingObservations = [
            makeObservation({ timestamp: 100 }),
            makeObservation({ timestamp: 200 }),
            makeObservation({ timestamp: 300 }),
            makeObservation({ timestamp: 200, latitude: 51.5, longitude: -0.5 }),
        ];

        const trackedObservations = trackAtTestTime(conflictingObservations);

        expect(trackedObservations.trackedFlights["40621D"]).toContainEqual(makeObservation({ timestamp: 200 }));
        expect(trackedObservations.trackedFlights["40621D"]).not.toContainEqual(makeObservation({ timestamp: 200, latitude: 51.5, longitude: -0.5 }));

        expect(trackedObservations.conflictingObservations["40621D"]).toContainEqual(
            makeObservation({ timestamp: 200, latitude: 51.5, longitude: -0.5 }),
        );
    });
});

describe("Multiple aircrafts observation tests", () => {
    it("should track multiple flights", () => {
        const multiAircraftObservations = [
            // First aircraft — initial observation
            makeObservation({ icao24: "40621D", timestamp: 100, latitude: 51.47, longitude: -0.45 }),

            // Second aircraft — initial observation
            makeObservation({ icao24: "A1B2C3", timestamp: 100, latitude: 40, longitude: -70 }),

            // First aircraft — later observation
            makeObservation({ icao24: "40621D", timestamp: 300, latitude: 51.51, longitude: -0.41 }),

            // Second aircraft — later observation
            makeObservation({ icao24: "A1B2C3", timestamp: 200, latitude: 40.02, longitude: -69.98 }),

            // Delayed observation for the first aircraft
            makeObservation({ icao24: "40621D", timestamp: 200, latitude: 51.49, longitude: -0.43 }),

            // Exact duplicate for the second aircraft
            makeObservation({ icao24: "A1B2C3", timestamp: 200, latitude: 40.02, longitude: -69.98 }),

            // Same-aircraft timestamp conflict
            // Different position, but same timestamp as an accepted observation
            makeObservation({ icao24: "40621D", timestamp: 200, latitude: 51.5, longitude: -0.42 }),

            // Delayed observation for the second aircraft
            makeObservation({ icao24: "A1B2C3", timestamp: 150, latitude: 40.01, longitude: -69.99 }),
        ];
        const trackedObservations = trackAtTestTime(multiAircraftObservations);
        const trackedFObservations = trackedObservations.trackedFlights;
        const duplicateObservations = trackedObservations.duplicateObservations;
        const conflictingObservations = trackedObservations.conflictingObservations;

        const flightOneTimestamps = trackedFObservations["40621D"]?.map((observation) => observation.timestamp);
        expect(flightOneTimestamps).toEqual([100, 200, 300]);
        const flightTwoTimestamps = trackedFObservations["A1B2C3"]?.map((observation) => observation.timestamp);
        expect(flightTwoTimestamps).toEqual([100, 150, 200]);

        const conflictingTimestamps = conflictingObservations["40621D"]?.map((observation) => observation.timestamp);

        const duplicateTimestamps = duplicateObservations["A1B2C3"]?.map((observation) => observation.timestamp);

        expect(conflictingTimestamps).toEqual([200]);
        expect(duplicateTimestamps).toEqual([200]);
    });
});

describe("Track staleness", () => {
    it("should accurately set the status of stale aircrafts", () => {
        const processingTime = 1000;
        const statusCases = [
            makeObservation({ icao24: "40621D", timestamp: 940 }), // age 60
            makeObservation({ icao24: "A1B2C3", timestamp: 939 }), // age 61
            makeObservation({ icao24: "D00D00", timestamp: 939, latitude: 0, longitude: 0 }),
            makeObservation({ icao24: "D00D00", timestamp: 920, latitude: 0, longitude: 0 }), // delayed
        ];

        const tracked = trackObservations(statusCases, processingTime);

        expect(tracked.flightStatuses).toMatchObject({
            "40621D": "ACTIVE",
            A1B2C3: "STALE",
            D00D00: "STALE",
        });
    });

    it("should set active status for recovered input", () => {
        const processingTime = 1000;

        const staleInput = [makeObservation({ icao24: "A1B2C3", timestamp: 939, latitude: 0, longitude: 0 })];

        const recoveredInput = [...staleInput, makeObservation({ icao24: "A1B2C3", timestamp: 960, latitude: 0, longitude: 0 })];

        const tracked = trackObservations(staleInput, processingTime);
        const recoveredTracked = trackObservations(recoveredInput, processingTime);

        expect(tracked.flightStatuses).toMatchObject({ A1B2C3: "STALE" });
        expect(recoveredTracked.flightStatuses).toMatchObject({ A1B2C3: "ACTIVE" });
    });
});

describe("Test bearing", () => {
    it("should calculate bearing correctly from lat and lon coords", () => {
        expect(getBearing({ latitude: 51.5074, longitude: -0.1278 }, { latitude: 48.8566, longitude: 2.3522 })).toBeCloseTo(148.115);
        expect(getBearing({ latitude: 37.7749, longitude: -122.4194 }, { latitude: 34.0522, longitude: -118.2437 })).toBeCloseTo(136.5029);
        expect(getBearing({ latitude: -33.8688, longitude: 151.2093 }, { latitude: -36.8485, longitude: 174.7633 })).toBeCloseTo(105.5757);
        expect(getBearing({ latitude: 12.3456, longitude: 67.8901 }, { latitude: -23.4567, longitude: 145.6789 })).toBeCloseTo(115.6393);
        expect(getBearing({ latitude: 63.2719, longitude: -151.0557 }, { latitude: 19.4326, longitude: -99.1332 })).toBeCloseTo(116.4817);
        expect(getBearing({ latitude: 0, longitude: 0 }, { latitude: 1, longitude: 0 })).toBe(0);
    });

    it("should calculate bearing from uniform coords", () => {
        expect(getBearing({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 1 })).toBe(90);
        expect(getBearing({ latitude: 0, longitude: 0 }, { latitude: -1, longitude: 0 })).toBe(180);
        expect(getBearing({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: -1 })).toBe(270);
        expect(getBearing({ latitude: 0, longitude: 179.9 }, { latitude: 0, longitude: -179.9 })).toBe(90);
    });
});

describe("Track analysis tests", () => {
    it("should accurately track completed flight paths", () => {
        const track = [
            makeObservation({ timestamp: 100, latitude: 0, longitude: 0 }),
            makeObservation({ timestamp: 200, latitude: 0, longitude: 0.01 }),
            makeObservation({ timestamp: 300, latitude: 0.01, longitude: 0.01 }),
        ];
        const trackedObservations = trackAtTestTime(track);
        const analysis = analyseTrack(trackedObservations.trackedFlights["40621D"]!);

        expect(analysis).toEqual([
            {
                icao24: "40621D",
                elapsedTime: 100,
                distance: 1112, // metres; Haversine result rounded to the nearest metre
                bearing: 90, // east
                groundSpeed: 11.12, // metres per second
            },
            {
                icao24: "40621D",
                elapsedTime: 100,
                distance: 1112,
                bearing: 0, // north
                groundSpeed: 11.12,
            },
        ]);
    });

    it("should handle edge cases", () => {
        const analysis = analyseTrack([]);
        const oneElementAnalysis = analyseTrack([makeObservation({ timestamp: 100, latitude: 0, longitude: 0 })]);
        expect(analysis).toEqual([]);
        expect(oneElementAnalysis).toEqual([]);
    });

    it("should handle coincidence coordinates", () => {
        const track = [
            makeObservation({ timestamp: 100, latitude: 0, longitude: 0 }),
            makeObservation({ timestamp: 200, latitude: 0, longitude: 0 }),
        ];
        const analysis = analyseTrack(track);

        expect(analysis[0]?.bearing).toBeNull();
    });
});
