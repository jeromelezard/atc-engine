export interface TrackAnalysis {
    icao24: string;
    elapsedTime: number;
    distance: number;
    bearing: number | null;
    groundSpeed: number;
}
