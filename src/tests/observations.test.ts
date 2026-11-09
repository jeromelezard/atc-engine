import { describe, it, expect } from "vitest";
import { parseObservation } from "../utils";
import { trackObservations } from "../app";
import { observations } from "../utils/observations";
import { makeObservation } from "./helpers/makeObservation";

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

describe("Observation Tests", () => {
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

    it("valid observations should be in chronological order", () => {
        const trackedFlights = trackObservations(observations).trackedFlights;
        expect(trackedFlights["40621D"]?.length).toBeGreaterThan(1);
        for (const flight of Object.values(trackedFlights)) {
            for (let i = 1; i < flight.length; i++) {
                expect(flight[i]?.timestamp).toBeGreaterThan(flight[i - 1]!.timestamp);
            }
        }
    });

    it("should ensure out-of-order observation are actually retained", () => {
        const observations = [makeObservation({ timestamp: 100 }), makeObservation({ timestamp: 300 }), makeObservation({ timestamp: 200 })];
        const trackedFlights = trackObservations(observations).trackedFlights;
        expect(trackedFlights["40621D"]?.length).toBe(3);
        const timestamps = trackedFlights["40621D"]?.map((observation) => observation.timestamp);
        expect(timestamps).toEqual([100, 200, 300]);
    });

    it("should detect duplicates", () => {
        const trackedObservations = trackObservations(sampleObservations);
        expect(trackedObservations.duplicateObservations["40621D"]?.length).toBe(1);
        expect(trackedObservations.trackedFlights["40621D"]?.length).toBe(5);
    });

    it("should flag conflicting observations", () => {
        const conflictingObservations = [
            makeObservation({ timestamp: 100 }),
            makeObservation({ timestamp: 200 }),
            makeObservation({ timestamp: 300 }),
            makeObservation({ timestamp: 200, latitude: 51.5, longitude: -0.5, }),
        ];

        const trackedObservations = trackObservations(conflictingObservations);

        expect(trackedObservations.trackedFlights["40621D"]).toContainEqual(makeObservation({ timestamp: 200 }));
        expect(trackedObservations.trackedFlights["40621D"]).not.toContainEqual(makeObservation({ timestamp: 200, latitude: 51.5, longitude: -0.5 }));

        expect(trackedObservations.conflictingObservations["40621D"]).toContainEqual(
            makeObservation({ timestamp: 200, latitude: 51.5, longitude: -0.5}),
        );
    });

    it("should return zeroes for empty input and not throw", () => {
        const trackedObservations = trackObservations([]);
        expect(trackedObservations.trackedFlights).toMatchObject({});
        expect(trackedObservations.conflictingObservations).toMatchObject({});
        expect(trackedObservations.duplicateObservations).toMatchObject({});
        expect(trackedObservations.invalidObservations.length).toBe(0);
    });

    it("make sure observations with null altitude, velocity and heading is accepted", () => {
        const observations = [
            makeObservation({ timestamp: 100, altitude: null }),
            makeObservation({ timestamp: 150 }),
            makeObservation({ timestamp: 200, velocity: null }),
            makeObservation({ timestamp: 300, heading: null }),
            makeObservation({ timestamp: 400, heading: null, altitude: null, velocity: null }),
        ];

        const trackedObservations = trackObservations(observations);
        expect(trackedObservations.trackedFlights["40621D"]?.length).toBe(5);
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
        const trackedObservations = trackObservations(observations);
        expect(trackedObservations.trackedFlights["test"]?.length).toBe(2);

        const timestamps = trackedObservations.trackedFlights["test"]?.map((observation) => observation.timestamp);
        expect(timestamps).toEqual([100, 300]);

        expect(trackedObservations.invalidObservations.length).toBe(6);
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

    it("should reject array of malformed inputs", () => {
        const invalidObservations = trackObservations([null, [], 10, false, "test"]).invalidObservations;
        expect(invalidObservations).toEqual([null, [], 10, false, "test"]);
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
                makeObservation({ icao24: "40621D", timestamp: 200, latitude: 51.50, longitude: -0.42 }),

                // Delayed observation for the second aircraft
                makeObservation({ icao24: "A1B2C3", timestamp: 150, latitude: 40.01, longitude: -69.99 }),
            ];
        const trackedObservations = trackObservations(multiAircraftObservations);
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
