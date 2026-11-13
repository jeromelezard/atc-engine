import type { JournalRecord } from "../types/persist";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export function serializeJournalRecord(record: JournalRecord): string {
    return JSON.stringify(record);
}

export async function writeJournalRecord(record: JournalRecord): Promise<void> {
    const jsonl = serializeJournalRecord(record);
    // Resolve from the project directory (the cwd used by `npm run run`).
    const outputFilePath = resolve(process.cwd(), "output", "trackedObservations.jsonl");

    // Ensure the parent exists, then append one complete JSON value per line.
    await mkdir(dirname(outputFilePath), { recursive: true });
    await appendFile(outputFilePath, `${jsonl}\n`, "utf8");
}

export function parseJournalRecord(line: string): JournalRecord {
    const value: unknown = JSON.parse(line);

    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("Journal record must be a JSON object");
    }

    const record = value as Record<string, unknown>;

    if (
        record.version !== 1 ||
        typeof record.processingTime !== "number" ||
        !Number.isFinite(record.processingTime) ||
        !Array.isArray(record.observations)
    ) {
        throw new Error("Invalid journal record");
    }

    return {
        version: 1,
        processingTime: record.processingTime,
        observations: record.observations,
    };
}
