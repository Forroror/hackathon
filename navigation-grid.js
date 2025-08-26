// ============================================================
// NAVIGATION GRID MODULE (navigation-grid.js)
// This module is responsible for creating and managing the
// navigation grid data.
// ============================================================

const turf = require('@turf/turf');

class NavigationGrid {
    constructor(gridData) {
        this.grid = gridData.grid;
        this.bounds = gridData.bounds;
        this.resolution = gridData.resolution;
        this.cols = this.grid.length;
        this.rows = this.grid[0].length;
    }

    latLngToGrid(latlng) {
        const x = Math.floor((latlng.lng - this.bounds.west) / this.resolution);
        const y = Math.floor((latlng.lat - this.bounds.south) / this.resolution);
        return { x, y };
    }

    gridToLatLng(x, y) {
        const lng = x * this.resolution + this.bounds.west;
        const lat = y * this.resolution + this.bounds.south;
        return { lat, lng };
    }
}

module.exports = NavigationGrid;
