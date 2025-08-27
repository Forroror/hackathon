// environmental-data-cache.js
// Fetches a grid of environmental data and provides fast, synchronous access.

const fetch = require('node-fetch');

// Helper to find the index of the closest value in a sorted array
function findClosestIndex(arr, target) {
    let low = 0;
    let high = arr.length - 1;
    while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        if (arr[mid] === target) return mid;
        if (arr[mid] < target) low = mid + 1;
        else high = mid - 1;
    }
    if (low > 0 && (low === arr.length || Math.abs(arr[low] - target) > Math.abs(arr[low - 1] - target))) {
        return low - 1;
    }
    return low;
}

class EnvironmentalDataCache {
    constructor(startLatLng, endLatLng, landGrid, voyageDate) {
        this.voyageDate = voyageDate;
        this.data = null;
        this.FASTAPI_URL = "http://127.0.0.1:8000/get-data-grid/";
        this.debugCounter = 0;
        this.debugLogInterval = 500; // Log every 500 calls

        const PADDING = 5.0; // degrees
        this.bounds = {
            min_lat: Math.min(startLatLng.lat, endLatLng.lat) - PADDING,
            max_lat: Math.max(startLatLng.lat, endLatLng.lat) + PADDING,
            min_lon: Math.min(startLatLng.lng, endLatLng.lng) - PADDING,
            max_lon: Math.max(startLatLng.lng, endLatLng.lng) + PADDING,
        };
        
        this.bounds.min_lat = Math.max(-90, this.bounds.min_lat);
        this.bounds.max_lat = Math.min(90, this.bounds.max_lat);
    }

    async initialize() {
        console.log(`Fetching environmental data grid for bounds:`, this.bounds);
        try {
            const response = await fetch(this.FASTAPI_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...this.bounds, date: this.voyageDate }),
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`FastAPI server returned an error: ${response.statusText}. Details: ${errorText}`);
            }

            this.data = await response.json();
            if (this.data.error || !this.data.lats || this.data.lats.length === 0) {
                 throw new Error(`Received invalid data from Python server: ${this.data.error || 'Empty data grid'}`);
            }
            console.log(`Successfully cached environmental data grid (${this.data.lats.length}x${this.data.lons.length}).`);
            return true;

        } catch (error) {
            console.error("--- ENVIRONMENTAL CACHE ERROR ---");
            console.error("Could not fetch or process the data grid.", error);
            console.error("This usually means the Python 'uvicorn data_server:app' is not running or there was an error in the Python script.");
            this.data = null;
            return false;
        }
    }

    getData(lat, lon) {
        if (!this.data) {
            return { depth: null, wind_speed_mps: 0, wind_cardinal: 0, current_speed_mps: 0, current_cardinal: 0, waves_height_m: 0, weekly_precip_mean: 0, ice_conc: 0 };
        }

        const lat_idx = findClosestIndex(this.data.lats, lat);
        const lon_idx = findClosestIndex(this.data.lons, lon);

        // Helper function to safely get a value from a potentially missing grid
        const getValue = (gridName, defaultVal = -9999) => {
            const grid = this.data[gridName];
            // Check if the grid, the row, and the cell all exist
            if (grid && grid[lat_idx] !== undefined && grid[lat_idx][lon_idx] !== undefined) {
                return grid[lat_idx][lon_idx];
            }
            return defaultVal; // Return default if any part is missing
        };

        const speed_asc = getValue('wind_speed_mps_asc');
        const card_asc = getValue('wind_cardinal_asc');
        const speed_dsc = getValue('wind_speed_mps_dsc');
        const card_dsc = getValue('wind_cardinal_dsc');
        
        let final_wind_speed = 0;
        let final_wind_cardinal = 0;

        if (speed_asc > -9999 && speed_dsc > -9999 && (speed_asc > 0 || speed_dsc > 0)) {
            const angle_asc_rad = (90 - (card_asc * 45)) * (Math.PI / 180);
            const angle_dsc_rad = (90 - (card_dsc * 45)) * (Math.PI / 180);
            const x_asc = speed_asc * Math.cos(angle_asc_rad);
            const y_asc = speed_asc * Math.sin(angle_asc_rad);
            const x_dsc = speed_dsc * Math.cos(angle_dsc_rad);
            const y_dsc = speed_dsc * Math.sin(angle_dsc_rad);
            const x_avg = (x_asc + x_dsc) / 2;
            const y_avg = (y_asc + y_dsc) / 2;
            final_wind_speed = Math.sqrt(x_avg**2 + y_avg**2);
            const final_angle_rad = Math.atan2(y_avg, x_avg);
            const final_angle_deg = (final_angle_rad * (180 / Math.PI));
            const cardinal_float = (90 - final_angle_deg) / 45.0;
            final_wind_cardinal = Math.round((cardinal_float % 8 + 8) % 8);
        }

        const depth = getValue('depth');
        const current_speed_mps = getValue('current_speed_mps');
        const current_cardinal = Math.round(getValue('current_cardinal'));
        const waves_height_m = getValue('waves_height');
        const weekly_precip_mean = getValue('precipitation');
        const ice_conc = getValue('ice_conc');

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

        return {
            depth: (depth > -9999) ? depth : null,
            wind_speed_mps: (final_wind_speed > -9999) ? final_wind_speed : 0,
            wind_direction_deg: ((final_wind_cardinal > -9999) ? final_wind_cardinal : 0) * 45, // Converted to degrees
            current_speed_mps: (current_speed_mps > -9999) ? current_speed_mps : 0,
            current_direction_deg: ((current_cardinal > -9999) ? current_cardinal : 0) * 45, // Converted to degrees
            waves_height_m: (waves_height_m > -9999) ? waves_height_m : 0,
            weekly_precip_mean: (weekly_precip_mean > -9999) ? weekly_precip_mean : 0,
            ice_conc: (ice_conc > -9999) ? ice_conc : 0
        };
    }
}

module.exports = EnvironmentalDataCache;
