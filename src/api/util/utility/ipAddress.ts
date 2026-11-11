type Location = { latitude: number; longitude: number };
export function distanceBetweenLocations(loc1: Location, loc2: Location): number {
    return distanceBetweenCoords(loc1.latitude, loc1.longitude, loc2.latitude, loc2.longitude);
}

//Haversine function
function distanceBetweenCoords(lat1: number, lon1: number, lat2: number, lon2: number) {
    const p = 0.017453292519943295; // Math.PI / 180
    const c = Math.cos;
    const a = 0.5 - c((lat2 - lat1) * p) / 2 + (c(lat1 * p) * c(lat2 * p) * (1 - c((lon2 - lon1) * p))) / 2;

    return 12742 * Math.asin(Math.sqrt(a)); // 2 * R; R = 6371 km
}
