// ===================================================================================
// environmental-data-cache.js
// -----------------------------------------------------------------------------------
// This module's purpose is to fetch a complete grid of environmental data (like
// wind, currents, and waves) for a specific voyage area from the Python data server.
// It downloads all the data at once and holds it in memory, providing a fast,
// synchronous method for the A* pathfinder to access the conditions at any given
// point on the map.
// ===================================================================================

// Import the 'node-fetch' library, which allows this Node.js server-side file
// to make web requests using the same 'fetch' syntax that browsers use.
const fetch = require('node-fetch');

/**
 * A helper function to efficiently find the index of a value in a sorted array
 * that is closest to a given target. It uses a binary search algorithm, which is
 * much faster than checking every single element one by one.
 * @param {number[]} arr - The sorted array to search in (e.g., an array of latitudes).
 * @param {number} target - The target value to find the closest match for (e.g., a specific latitude).
 * @returns {number} The index of the element in the array closest to the target.
 */
function findClosestIndex(arr, target) {
    let low = 0;
    let high = arr.length - 1;
    while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        if (arr[mid] === target) return mid;
        if (arr[mid] < target) low = mid + 1;
        else high = mid - 1;
    }
    // After the loop, the closest value is either at 'low' or the one before it.
    // This part checks which of the two is the actual closest match.
    if (low > 0 && (low === arr.length || Math.abs(arr[low] - target) > Math.abs(arr[low - 1] - target))) {
        return low - 1;
    }
    return low;
}

/**
 * A class to manage fetching, caching, and accessing environmental data for a voyage.
 */
class EnvironmentalDataCache {
    /**
     * Creates an instance of the cache. This is done for each new route request.
     * @param {object} startLatLng - The starting coordinates { lat, lng }.
     * @param {object} endLatLng - The ending coordinates { lat, lng }.
     * @param {NavigationGrid} landGrid - The main land/water grid.
     * @param {string} voyageDate - The starting date of the voyage in ISO format.
     */
    constructor(startLatLng, endLatLng, landGrid, voyageDate) {
        this.voyageDate = voyageDate;
        // this.data will hold the entire grid of environmental data once it's fetched.
        this.data = null;
        // The URL of the Python data server.
        this.FASTAPI_URL = "http://127.0.0.1:8000/get-data-grid/";

        // A debug counter to prevent logging data for every single node, which would be too slow.
        this.debugCounter = 0;
        this.debugLogInterval = 100; // Log data for one node out of every 500.

        // --- Bounding Box Calculation ---
        // A "padding" in degrees is added around the voyage's direct bounding box.
        // This gives the A* algorithm a larger area to search, allowing it to find
        // better routes that might curve outside the direct path.
        const PADDING = 10.0; // 10 degrees
        this.bounds = {
            min_lat: Math.min(startLatLng.lat, endLatLng.lat) - PADDING,
            max_lat: Math.max(startLatLng.lat, endLatLng.lat) + PADDING,
            min_lon: Math.min(startLatLng.lng, endLatLng.lng) - PADDING,
            max_lon: Math.max(startLatLng.lng, endLatLng.lng) + PADDING,
        };
        
        // Clamp the latitude values to the valid global range of [-90, 90].
        this.bounds.min_lat = Math.max(-90, this.bounds.min_lat);
        this.bounds.max_lat = Math.min(90, this.bounds.max_lat);
    }

    /**
     * Asynchronously fetches and loads the environmental data from the Python server.
     * This is the "all-at-once" method. It must be called and awaited before 'getData' can be used.
     * @returns {Promise<boolean>} A promise that resolves to 'true' if successful, 'false' otherwise.
     */
    async initialize() {
        console.log(`Fetching environmental data grid for bounds:`, this.bounds);
        try {
            // Make a single POST request to the Python server with the calculated bounds.
            const response = await fetch(this.FASTAPI_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...this.bounds, date: this.voyageDate }),
            });

            // If the server responds with an error (e.g., 404 or 500), throw an error.
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`FastAPI server returned an error: ${response.statusText}. Details: ${errorText}`);
            }

            // This is the key step. It waits for the ENTIRE data file to be downloaded,
            // then parses the whole thing into a JavaScript object in one step.
            // This is fast but requires enough memory to hold the entire object.
            this.data = await response.json();

            // Perform a sanity check to make sure the received data is valid and not empty.
            if (this.data.error || !this.data.lats || this.data.lats.length === 0) {
                 throw new Error(`Received invalid data from Python server: ${this.data.error || 'Empty data grid'}`);
            }

            console.log(`Successfully cached environmental data grid (${this.data.lats.length}x${this.data.lons.length}).`);
            return true;

        } catch (error) {
            // If anything goes wrong (network error, memory crash, etc.), log it and return false.
            console.error("--- ENVIRONMENTAL CACHE ERROR ---");
            console.error("Could not fetch or process the data grid.", error);
            console.error("This usually means the Python 'uvicorn data_server:app' is not running or there was an error in the Python script.");
            this.data = null;
            return false;
        }
    }

    /**
     * Synchronously retrieves all environmental data for a specific coordinate point.
     * This is the main function used by the A* pathfinder's cost calculation. Because
     * all data is already in memory, this lookup is extremely fast.
     * @param {number} lat - The latitude of the point.
     * @param {number} lon - The longitude of the point.
     * @returns {object} An object containing all environmental parameters for that point.
     */
    getData(lat, lon) {
        // If data hasn't been initialized, return a default "no data" object.
        if (!this.data) {
            return { depth: null, wind_speed_mps: 0, wind_cardinal: 0, current_speed_mps: 0, current_cardinal: 0, waves_height_m: 0, weekly_precip_mean: 0, ice_conc: 0 };
        }

        // Find the closest grid indices for the given lat/lon.
        const lat_idx = findClosestIndex(this.data.lats, lat);
        const lon_idx = findClosestIndex(this.data.lons, lon);

        // A safe helper function to get a value from a grid. It prevents errors if a grid
        // or a specific cell is missing by returning a default value.
        const getValue = (gridName, defaultVal = -9999) => {
            const grid = this.data[gridName];
            if (grid && grid[lat_idx] !== undefined && grid[lat_idx][lon_idx] !== undefined) {
                return grid[lat_idx][lon_idx];
            }
            return defaultVal;
        };

        // --- Wind Vector Averaging ---
        // Satellites provide two sets of wind data (ascending/descending passes).
        // To get a more accurate result, we average these two wind vectors.
        const speed_asc = getValue('wind_speed_mps_asc');
        const card_asc = getValue('wind_cardinal_asc');
        const speed_dsc = getValue('wind_speed_mps_dsc');
        const card_dsc = getValue('wind_cardinal_dsc');
        
        let final_wind_speed = 0;
        let final_wind_cardinal = 0;

        if (speed_asc > -9999 && speed_dsc > -9999 && (speed_asc > 0 || speed_dsc > 0)) {
            // 1. Convert cardinal direction (0-7) and speed into standard vector components (x, y).
            const angle_asc_rad = (90 - (card_asc * 45)) * (Math.PI / 180);
            const angle_dsc_rad = (90 - (card_dsc * 45)) * (Math.PI / 180);
            const x_asc = speed_asc * Math.cos(angle_asc_rad);
            const y_asc = speed_asc * Math.sin(angle_asc_rad);
            const x_dsc = speed_dsc * Math.cos(angle_dsc_rad);
            const y_dsc = speed_dsc * Math.sin(angle_dsc_rad);
            
            // 2. Average the components.
            const x_avg = (x_asc + x_dsc) / 2;
            const y_avg = (y_asc + y_dsc) / 2;
            
            // 3. Convert the averaged components back to a speed and direction.
            final_wind_speed = Math.sqrt(x_avg**2 + y_avg**2);
            const final_angle_rad = Math.atan2(y_avg, x_avg);
            const final_angle_deg = (final_angle_rad * (180 / Math.PI));
            
            // 4. Convert the final angle back to the nearest cardinal direction (0-7).
            const cardinal_float = (90 - final_angle_deg) / 45.0;
            final_wind_cardinal = Math.round((cardinal_float % 8 + 8) % 8);
        }

        // Get all other environmental values using the safe helper.
        const depth = getValue('depth');
        const current_speed_mps = getValue('current_speed_mps');
        const current_cardinal = Math.round(getValue('current_cardinal'));
        const waves_height_m = getValue('waves_height');
        const weekly_precip_mean = getValue('precipitation');
        const ice_conc = getValue('ice_conc');

        // This debug log will print the data for one node every 500 calls.
        this.debugCounter++;
        if (this.debugCounter % this.debugLogInterval === 0) {
            console.log(`\n--- [Data for Node at Lat: ${lat.toFixed(3)}, Lon: ${lon.toFixed(3)}] ---`);
            console.log(`  > Depth: ${depth > -9999 ? depth.toFixed(1) + 'm' : 'N/A'}`);
            console.log(`  > Wind: ${final_wind_speed.toFixed(2)} m/s, Cardinal: ${final_wind_cardinal}`);
            console.log(`  > Current: ${current_speed_mps > -9999 ? current_speed_mps.toFixed(2) : 'N/A'} m/s, Cardinal: ${current_cardinal}`);
            console.log(`  > Waves: ${waves_height_m > -9999 ? waves_height_m.toFixed(2) : 'N/A'} m`);
            console.log(`  > Precipitation: ${weekly_precip_mean > -9999 ? weekly_precip_mean.toFixed(4) : 'N/A'}`);
            console.log(`  > Ice Concentration: ${ice_conc > -9999 ? ice_conc.toFixed(2) + '%' : 'N/A'}`);
            console.log(`--------------------------------------------------`);
        }

        // Construct and return the final data object for the A* pathfinder.
        // It cleans up the '-9999' default values and converts cardinal directions to degrees.
        return {
            depth: (depth > -9999) ? depth : null,
            wind_speed_mps: (final_wind_speed > -9999) ? final_wind_speed : 0,
            wind_direction_deg: ((final_wind_cardinal > -9999) ? final_wind_cardinal : 0) * 45,
            current_speed_mps: (current_speed_mps > -9999) ? current_speed_mps : 0,
            current_direction_deg: ((current_cardinal > -9999) ? current_cardinal : 0) * 45,
            waves_height_m: (waves_height_m > -9999) ? waves_height_m : 0,
            weekly_precip_mean: (weekly_precip_mean > -9999) ? weekly_precip_mean : 0,
            ice_conc: (ice_conc > -9999) ? ice_conc : 0
        };
    }
}

// Export the class so that other files (like server.js) can use it.
module.exports = EnvironmentalDataCache;
